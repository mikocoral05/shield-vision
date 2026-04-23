import type {
  ResolvedShieldVisionOptions,
  SensitiveRegion
} from './types';
import { createCanvas, getContext } from './utils/image';

export function renderMaskedCanvas(
  source: HTMLCanvasElement,
  regions: SensitiveRegion[],
  options: ResolvedShieldVisionOptions
): HTMLCanvasElement {
  const output = createCanvas(source.width, source.height);
  const context = getContext(output);
  context.drawImage(source, 0, 0);

  for (const region of regions) {
    applyMask(context, source, region, options);
  }

  return output;
}

export function drawRegionOverlay(
  source: HTMLCanvasElement,
  regions: SensitiveRegion[]
): HTMLCanvasElement {
  const overlay = createCanvas(source.width, source.height);
  const context = getContext(overlay);
  context.drawImage(source, 0, 0);

  for (const region of regions) {
    const color = region.kind === 'face' ? '#63f1d7' : '#ffc857';
    context.save();
    context.strokeStyle = color;
    context.lineWidth = Math.max(2, source.width / 480);
    context.fillStyle = `${color}22`;
    roundRect(context, region.x, region.y, region.width, region.height, 12);
    context.fill();
    context.stroke();
    context.fillStyle = '#091119';
    context.font = `600 ${Math.max(12, source.width / 64)}px "IBM Plex Mono", monospace`;
    const label = `${region.label} ${(region.confidence * 100).toFixed(0)}%`;
    const padding = 8;
    const labelWidth = context.measureText(label).width + padding * 2;
    const labelHeight = 24;
    const labelX = region.x;
    const labelY = Math.max(0, region.y - labelHeight - 6);
    context.fillStyle = color;
    roundRect(context, labelX, labelY, labelWidth, labelHeight, 8);
    context.fill();
    context.fillStyle = '#091119';
    context.fillText(label, labelX + padding, labelY + 16);
    context.restore();
  }

  return overlay;
}

function applyMask(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  region: SensitiveRegion,
  options: ResolvedShieldVisionOptions
): void {
  if (options.maskMode === 'pixelate' || !supportsCanvasBlur()) {
    pixelateRegion(context, source, region, options);
    return;
  }

  blurRegion(context, source, region, options);
}

function blurRegion(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  region: SensitiveRegion,
  options: ResolvedShieldVisionOptions
): void {
  const bleed = Math.ceil(options.blurStrength * 1.8);
  const sx = Math.max(0, region.x - bleed);
  const sy = Math.max(0, region.y - bleed);
  const sw = Math.min(source.width - sx, region.width + bleed * 2);
  const sh = Math.min(source.height - sy, region.height + bleed * 2);
  const scratch = createCanvas(region.width, region.height);
  const scratchContext = getContext(scratch);

  scratchContext.filter = `blur(${options.blurStrength}px)`;
  scratchContext.drawImage(
    source,
    sx,
    sy,
    sw,
    sh,
    -(region.x - sx),
    -(region.y - sy),
    sw,
    sh
  );

  context.save();
  clipRoundRect(context, region.x, region.y, region.width, region.height, options.cornerRadius);
  context.drawImage(scratch, region.x, region.y);
  context.restore();
}

function pixelateRegion(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  region: SensitiveRegion,
  options: ResolvedShieldVisionOptions
): void {
  const scaledWidth = Math.max(1, Math.round(region.width / options.pixelBlockSize));
  const scaledHeight = Math.max(1, Math.round(region.height / options.pixelBlockSize));
  const scratch = createCanvas(scaledWidth, scaledHeight);
  const scratchContext = getContext(scratch);
  scratchContext.imageSmoothingEnabled = false;
  scratchContext.drawImage(
    source,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    scaledWidth,
    scaledHeight
  );

  context.save();
  clipRoundRect(context, region.x, region.y, region.width, region.height, options.cornerRadius);
  context.imageSmoothingEnabled = false;
  context.drawImage(
    scratch,
    0,
    0,
    scaledWidth,
    scaledHeight,
    region.x,
    region.y,
    region.width,
    region.height
  );
  context.imageSmoothingEnabled = true;
  context.restore();
}

function supportsCanvasBlur(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  return Boolean(context && 'filter' in context);
}

function clipRoundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  roundRect(context, x, y, width, height, radius);
  context.clip();
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));

  context.beginPath();

  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, width, height, safeRadius);
    return;
  }

  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}
