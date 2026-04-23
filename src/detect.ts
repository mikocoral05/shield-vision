import type { BlazeFaceModel, NormalizedFace } from '@tensorflow-models/blazeface';
import type { DetectedObject, ObjectDetection } from '@tensorflow-models/coco-ssd';

import type {
  BoundingBox,
  LicensePlateDetection,
  ResolvedShieldVisionOptions,
  SensitiveRegion
} from './types';
import { clamp, clampBox, dedupeRegions, expandBox } from './utils/geometry';

const VEHICLE_LABELS = new Set(['car', 'bus', 'truck', 'motorcycle']);

export async function detectSensitiveRegions(
  canvas: HTMLCanvasElement,
  models: {
    faceModel: BlazeFaceModel;
    objectModel: ObjectDetection;
  },
  options: ResolvedShieldVisionOptions
): Promise<SensitiveRegion[]> {
  const [faceRegions, plateRegions] = await Promise.all([
    options.enableFaceMasking
      ? detectFaces(canvas, models.faceModel, options)
      : Promise.resolve([]),
    options.enableLicensePlateMasking
      ? detectLicensePlateRegions(canvas, models.objectModel, options)
      : Promise.resolve([])
  ]);

  return dedupeRegions([...faceRegions, ...plateRegions]);
}

async function detectFaces(
  canvas: HTMLCanvasElement,
  model: BlazeFaceModel,
  options: ResolvedShieldVisionOptions
): Promise<SensitiveRegion[]> {
  const faces = await model.estimateFaces(canvas, false, false, true);

  return faces
    .map((face, index) => toFaceRegion(face, canvas, options, index))
    .filter((region): region is SensitiveRegion => Boolean(region));
}

function toFaceRegion(
  face: NormalizedFace,
  canvas: HTMLCanvasElement,
  options: ResolvedShieldVisionOptions,
  index: number
): SensitiveRegion | null {
  const topLeft = pointToTuple(face.topLeft);
  const bottomRight = pointToTuple(face.bottomRight);
  const score = faceProbability(face.probability);

  if (!topLeft || !bottomRight || score < options.faceConfidence) {
    return null;
  }

  const expanded = expandBox(
    {
      x: topLeft[0],
      y: topLeft[1],
      width: bottomRight[0] - topLeft[0],
      height: bottomRight[1] - topLeft[1]
    },
    options.regionPadding,
    canvas.width,
    canvas.height
  );

  return {
    id: `face-${index + 1}`,
    kind: 'face',
    confidence: score,
    label: 'Face',
    detector: 'blazeface',
    ...expanded
  };
}

async function detectLicensePlateRegions(
  canvas: HTMLCanvasElement,
  model: ObjectDetection,
  options: ResolvedShieldVisionOptions
): Promise<SensitiveRegion[]> {
  const customRegions = await detectCustomLicensePlateRegions(canvas, options);

  if (customRegions.length > 0 || options.licensePlateFallback === 'none') {
    return customRegions;
  }

  const detections = await model.detect(canvas, 20, options.objectConfidence);
  const vehicles = detections.filter((detection) => VEHICLE_LABELS.has(detection.class));

  return vehicles
    .map((vehicle, index) =>
      options.licensePlateFallback === 'vehicle'
        ? vehicleToConservativePlateRegion(vehicle, canvas, options, index)
        : vehicleToPlateRegion(vehicle, canvas, options, index)
    )
    .filter((region): region is SensitiveRegion => Boolean(region));
}

async function detectCustomLicensePlateRegions(
  canvas: HTMLCanvasElement,
  options: ResolvedShieldVisionOptions
): Promise<SensitiveRegion[]> {
  if (!options.licensePlateDetector) {
    return [];
  }

  const detections = await options.licensePlateDetector(canvas);

  return detections
    .map((detection, index) => customPlateToRegion(detection, canvas, options, index))
    .filter((region): region is SensitiveRegion => Boolean(region));
}

function customPlateToRegion(
  detection: LicensePlateDetection,
  canvas: HTMLCanvasElement,
  options: ResolvedShieldVisionOptions,
  index: number
): SensitiveRegion | null {
  const region = sanitizeBox(detection, canvas.width, canvas.height);

  if (!region || region.width < 4 || region.height < 4) {
    return null;
  }

  const confidence =
    typeof detection.confidence === 'number' && Number.isFinite(detection.confidence)
      ? clamp(detection.confidence, 0, 1)
      : 1;

  if (confidence < options.objectConfidence) {
    return null;
  }

  return {
    id: `plate-custom-${index + 1}`,
    kind: 'license_plate',
    confidence,
    label: detection.label || 'License plate',
    detector: 'custom-license-plate',
    ...expandBox(region, options.regionPadding * 0.35, canvas.width, canvas.height)
  };
}

function vehicleToConservativePlateRegion(
  vehicle: DetectedObject,
  canvas: HTMLCanvasElement,
  options: ResolvedShieldVisionOptions,
  index: number
): SensitiveRegion | null {
  const [x, y, width, height] = vehicle.bbox;
  const safeScore = Number.isFinite(vehicle.score) ? vehicle.score : 0;

  if (safeScore < options.objectConfidence) {
    return null;
  }

  const region = sanitizeBox({ x, y, width, height }, canvas.width, canvas.height);

  if (!region || region.width < 12 || region.height < 8) {
    return null;
  }

  return {
    id: `plate-vehicle-${index + 1}`,
    kind: 'license_plate',
    confidence: Math.max(0.5, Math.min(0.99, safeScore)),
    label: 'Vehicle plate risk area',
    detector: 'vehicle-conservative',
    parentLabel: vehicle.class,
    ...expandBox(region, options.regionPadding * 0.5, canvas.width, canvas.height)
  };
}

function vehicleToPlateRegion(
  vehicle: DetectedObject,
  canvas: HTMLCanvasElement,
  options: ResolvedShieldVisionOptions,
  index: number
): SensitiveRegion | null {
  const [x, y, width, height] = vehicle.bbox;
  const safeScore = Number.isFinite(vehicle.score) ? vehicle.score : 0;

  if (safeScore < options.objectConfidence) {
    return null;
  }

  const isMotorcycle = vehicle.class === 'motorcycle';
  const plateWidth = width * (isMotorcycle ? 0.34 : 0.42);
  const plateHeight = height * (isMotorcycle ? 0.14 : 0.16);
  const offsetY = height * (isMotorcycle ? 0.72 : 0.68);
  const offsetX = (width - plateWidth) / 2;

  const region = clampBox(
    {
      x: x + offsetX,
      y: y + offsetY,
      width: plateWidth,
      height: plateHeight
    },
    canvas.width,
    canvas.height
  );

  if (region.width < 12 || region.height < 8) {
    return null;
  }

  return {
    id: `plate-${index + 1}`,
    kind: 'license_plate',
    confidence: Math.max(0.45, Math.min(0.98, safeScore * 0.82)),
    label: 'License plate zone',
    detector: 'vehicle-heuristic',
    parentLabel: vehicle.class,
    ...expandBox(region, options.regionPadding * 0.35, canvas.width, canvas.height)
  };
}

function pointToTuple(point: [number, number] | unknown): [number, number] | null {
  if (Array.isArray(point) && point.length >= 2) {
    return [Number(point[0]), Number(point[1])];
  }

  return null;
}

function faceProbability(probability: number | unknown): number {
  if (typeof probability === 'number') {
    return probability;
  }

  if (Array.isArray(probability) && probability.length > 0) {
    return Number(probability[0]) || 0;
  }

  return 0;
}

function sanitizeBox(box: BoundingBox, width: number, height: number): BoundingBox | null {
  const x = Number(box.x);
  const y = Number(box.y);
  const boxWidth = Number(box.width);
  const boxHeight = Number(box.height);

  if (![x, y, boxWidth, boxHeight].every(Number.isFinite)) {
    return null;
  }

  return clampBox({ x, y, width: boxWidth, height: boxHeight }, width, height);
}
