export type ShieldVisionBackend = 'webgpu' | 'webgl' | 'wasm' | 'cpu';

export type HardwareAccelerationTier = 'gpu' | 'npu' | 'cpu';

export type MaskMode = 'blur' | 'pixelate';

export type SensitiveRegionKind = 'face' | 'license_plate';

export type LicensePlateFallback = 'vehicle' | 'plate-zone' | 'none';

export type WasmBinaryName =
  | 'tfjs-backend-wasm.wasm'
  | 'tfjs-backend-wasm-simd.wasm'
  | 'tfjs-backend-wasm-threaded-simd.wasm';

export type WasmPathMap = Partial<Record<WasmBinaryName, string>>;

export type WasmPaths = string | WasmPathMap;

export type ImageSource =
  | HTMLImageElement
  | HTMLCanvasElement
  | ImageBitmap
  | ImageData
  | Blob
  | File
  | string;

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LicensePlateDetection extends BoundingBox {
  confidence?: number;
  label?: string;
}

export type LicensePlateDetector = (
  source: HTMLCanvasElement
) => LicensePlateDetection[] | Promise<LicensePlateDetection[]>;

export interface SensitiveRegion extends BoundingBox {
  id: string;
  kind: SensitiveRegionKind;
  confidence: number;
  label: string;
  detector: 'blazeface' | 'custom-license-plate' | 'vehicle-conservative' | 'vehicle-heuristic';
  parentLabel?: string;
}

export interface CapabilityReport {
  selectedBackend: ShieldVisionBackend;
  availableBackends: ShieldVisionBackend[];
  acceleration: HardwareAccelerationTier;
  webgpuAvailable: boolean;
  webglAvailable: boolean;
  webnnAvailable: boolean;
  logicalProcessors?: number;
  deviceMemoryGb?: number;
}

export interface ShieldVisionOptions {
  preferredBackend?: ShieldVisionBackend | 'auto';
  maxFaces?: number;
  faceConfidence?: number;
  objectConfidence?: number;
  regionPadding?: number;
  maskMode?: MaskMode;
  blurStrength?: number;
  pixelBlockSize?: number;
  cornerRadius?: number;
  enableFaceMasking?: boolean;
  enableLicensePlateMasking?: boolean;
  licensePlateDetector?: LicensePlateDetector;
  licensePlateFallback?: LicensePlateFallback;
  faceModelUrl?: string;
  objectModelUrl?: string;
  wasmPaths?: WasmPaths;
}

export interface ResolvedShieldVisionOptions
  extends Required<
    Omit<
      ShieldVisionOptions,
      'faceModelUrl' | 'objectModelUrl' | 'wasmPaths' | 'licensePlateDetector'
    >
  > {
  faceModelUrl?: string;
  objectModelUrl?: string;
  wasmPaths?: WasmPaths;
  licensePlateDetector?: LicensePlateDetector;
}

export interface ProcessingMetrics {
  prepareMs: number;
  detectionMs: number;
  maskMs: number;
  totalMs: number;
}

export interface AnalyzeResult {
  width: number;
  height: number;
  backend: ShieldVisionBackend;
  capability: CapabilityReport;
  regions: SensitiveRegion[];
  metrics: ProcessingMetrics;
}

export interface MaskResult extends AnalyzeResult {
  canvas: HTMLCanvasElement;
  toBlob: (type?: string, quality?: number) => Promise<Blob>;
  toDataURL: (type?: string, quality?: number) => string;
}
