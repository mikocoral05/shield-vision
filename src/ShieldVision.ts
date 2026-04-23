import type { BlazeFaceModel } from '@tensorflow-models/blazeface';
import type { ObjectDetection } from '@tensorflow-models/coco-ssd';

import { ensureBestBackend } from './backends';
import { detectSensitiveRegions } from './detect';
import { drawRegionOverlay, renderMaskedCanvas } from './mask';
import type {
  AnalyzeResult,
  CapabilityReport,
  ImageSource,
  MaskResult,
  ResolvedShieldVisionOptions,
  ShieldVisionOptions
} from './types';
import { createCanvas, normalizeSourceToCanvas } from './utils/image';

const DEFAULT_OPTIONS: ResolvedShieldVisionOptions = {
  preferredBackend: 'auto',
  maxFaces: 12,
  faceConfidence: 0.82,
  objectConfidence: 0.55,
  regionPadding: 0.16,
  maskMode: 'blur',
  blurStrength: 18,
  pixelBlockSize: 14,
  cornerRadius: 14,
  enableFaceMasking: true,
  enableLicensePlateMasking: true,
  licensePlateFallback: 'vehicle'
};

type ModelBundle = {
  faceModel: BlazeFaceModel;
  objectModel: ObjectDetection;
};

let blazeFaceModulePromise: Promise<typeof import('@tensorflow-models/blazeface')> | null = null;
let cocoSsdModulePromise: Promise<typeof import('@tensorflow-models/coco-ssd')> | null = null;

export class ShieldVision {
  private options: ResolvedShieldVisionOptions;
  private capabilityPromise: Promise<CapabilityReport> | null = null;
  private modelsPromise: Promise<ModelBundle> | null = null;
  private models: ModelBundle | null = null;

  constructor(options: ShieldVisionOptions = {}) {
    this.options = resolveOptions(options);
  }

  updateOptions(options: Partial<ShieldVisionOptions>): void {
    const previous = this.options;
    this.options = resolveOptions({
      ...this.options,
      ...options
    });

    const backendChanged =
      previous.preferredBackend !== this.options.preferredBackend ||
      previous.wasmPaths !== this.options.wasmPaths;
    const modelShapeChanged =
      previous.maxFaces !== this.options.maxFaces ||
      previous.faceModelUrl !== this.options.faceModelUrl ||
      previous.objectModelUrl !== this.options.objectModelUrl;

    if (backendChanged) {
      this.capabilityPromise = null;
    }

    if (modelShapeChanged) {
      this.dispose();
    }
  }

  async warmup(): Promise<CapabilityReport> {
    const capability = await this.getCapabilities();
    const models = await this.loadModels();
    const warmupCanvas = createCanvas(64, 64);

    try {
      await Promise.all([
        models.faceModel.estimateFaces(warmupCanvas, false, false, false),
        models.objectModel.detect(warmupCanvas, 4, 0.1)
      ]);
    } catch {
      // Model backends can fail the first warmup on unsupported hardware.
      // The actual analyze flow will surface actionable runtime errors if needed.
    }

    return capability;
  }

  async getCapabilities(): Promise<CapabilityReport> {
    if (!this.capabilityPromise) {
      this.capabilityPromise = ensureBestBackend(
        this.options.preferredBackend,
        this.options.wasmPaths
      );
    }

    return this.capabilityPromise;
  }

  async analyze(source: ImageSource): Promise<AnalyzeResult> {
    const startedAt = now();
    const inputCanvas = await normalizeSourceToCanvas(source);
    const prepareMs = now() - startedAt;
    const capability = await this.getCapabilities();
    const models = await this.loadModels();
    const detectionStartedAt = now();
    const regions = await detectSensitiveRegions(inputCanvas, models, this.options);
    const detectionMs = now() - detectionStartedAt;
    const totalMs = now() - startedAt;

    return {
      width: inputCanvas.width,
      height: inputCanvas.height,
      backend: capability.selectedBackend,
      capability,
      regions,
      metrics: {
        prepareMs,
        detectionMs,
        maskMs: 0,
        totalMs
      }
    };
  }

  async mask(source: ImageSource): Promise<MaskResult> {
    const startedAt = now();
    const inputCanvas = await normalizeSourceToCanvas(source);
    const prepareMs = now() - startedAt;
    const capability = await this.getCapabilities();
    const models = await this.loadModels();
    const detectionStartedAt = now();
    const regions = await detectSensitiveRegions(inputCanvas, models, this.options);
    const detectionMs = now() - detectionStartedAt;
    const maskStartedAt = now();
    const outputCanvas = renderMaskedCanvas(inputCanvas, regions, this.options);
    const maskMs = now() - maskStartedAt;
    const totalMs = now() - startedAt;

    return {
      width: inputCanvas.width,
      height: inputCanvas.height,
      backend: capability.selectedBackend,
      capability,
      regions,
      canvas: outputCanvas,
      metrics: {
        prepareMs,
        detectionMs,
        maskMs,
        totalMs
      },
      toBlob: (type?: string, quality?: number) => canvasToBlob(outputCanvas, type, quality),
      toDataURL: (type?: string, quality?: number) => outputCanvas.toDataURL(type, quality)
    };
  }

  async debugOverlay(source: ImageSource): Promise<HTMLCanvasElement> {
    const inputCanvas = await normalizeSourceToCanvas(source);
    const models = await this.loadModels();
    const regions = await detectSensitiveRegions(inputCanvas, models, this.options);
    return drawRegionOverlay(inputCanvas, regions);
  }

  dispose(): void {
    if (this.models) {
      this.models.faceModel.dispose();
      this.models.objectModel.dispose();
    }

    this.models = null;
    this.modelsPromise = null;
  }

  private async loadModels(): Promise<ModelBundle> {
    await this.getCapabilities();

    if (!this.modelsPromise) {
      this.modelsPromise = Promise.all([loadBlazeFaceModule(), loadCocoSsdModule()])
        .then(([blazeFace, cocoSsd]) =>
          Promise.all([
            blazeFace.load({
              maxFaces: this.options.maxFaces,
              scoreThreshold: this.options.faceConfidence,
              modelUrl: this.options.faceModelUrl
            }),
            cocoSsd.load({
              base: 'lite_mobilenet_v2',
              modelUrl: this.options.objectModelUrl
            })
          ])
        )
        .then(([faceModel, objectModel]) => {
          this.models = { faceModel, objectModel };
          return this.models;
        });
    }

    return this.modelsPromise;
  }
}

export function createShieldVision(options: ShieldVisionOptions = {}): ShieldVision {
  return new ShieldVision(options);
}

function resolveOptions(options: ShieldVisionOptions): ResolvedShieldVisionOptions {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...options
  };

  return {
    ...merged,
    maxFaces: clampInteger(merged.maxFaces, 1, 100),
    faceConfidence: clampNumber(merged.faceConfidence, 0, 1),
    objectConfidence: clampNumber(merged.objectConfidence, 0, 1),
    regionPadding: clampNumber(merged.regionPadding, 0, 2),
    blurStrength: clampNumber(merged.blurStrength, 0, 80),
    pixelBlockSize: clampInteger(merged.pixelBlockSize, 1, 256),
    cornerRadius: clampNumber(merged.cornerRadius, 0, 512)
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clampNumber(value, min, max));
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type?: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Unable to export masked image as a blob.'));
        return;
      }

      resolve(blob);
    }, type, quality);
  });
}

async function loadBlazeFaceModule(): Promise<typeof import('@tensorflow-models/blazeface')> {
  if (!blazeFaceModulePromise) {
    blazeFaceModulePromise = import('@tensorflow-models/blazeface');
  }

  return blazeFaceModulePromise;
}

async function loadCocoSsdModule(): Promise<typeof import('@tensorflow-models/coco-ssd')> {
  if (!cocoSsdModulePromise) {
    cocoSsdModulePromise = import('@tensorflow-models/coco-ssd');
  }

  return cocoSsdModulePromise;
}
