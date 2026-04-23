import type { BoundingBox, SensitiveRegion } from '../types';

export function clampBox(
  box: BoundingBox,
  width: number,
  height: number
): BoundingBox {
  const x = clamp(box.x, 0, width);
  const y = clamp(box.y, 0, height);
  const maxWidth = Math.max(0, width - x);
  const maxHeight = Math.max(0, height - y);

  return {
    x,
    y,
    width: clamp(box.width, 0, maxWidth),
    height: clamp(box.height, 0, maxHeight)
  };
}

export function expandBox(
  box: BoundingBox,
  factor: number,
  width: number,
  height: number
): BoundingBox {
  const growX = box.width * factor;
  const growY = box.height * factor;

  return clampBox(
    {
      x: box.x - growX,
      y: box.y - growY,
      width: box.width + growX * 2,
      height: box.height + growY * 2
    },
    width,
    height
  );
}

export function dedupeRegions(regions: SensitiveRegion[]): SensitiveRegion[] {
  const ordered = [...regions].sort((left, right) => right.confidence - left.confidence);
  const kept: SensitiveRegion[] = [];

  for (const region of ordered) {
    const overlap = kept.some((existing) => {
      if (existing.kind !== region.kind) {
        return false;
      }

      return intersectionOverUnion(existing, region) > 0.6;
    });

    if (!overlap) {
      kept.push(region);
    }
  }

  return kept;
}

export function intersectionOverUnion(left: BoundingBox, right: BoundingBox): number {
  const leftEdge = Math.max(left.x, right.x);
  const topEdge = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);

  const width = Math.max(0, rightEdge - leftEdge);
  const height = Math.max(0, bottomEdge - topEdge);
  const intersection = width * height;
  const union = area(left) + area(right) - intersection;

  return union === 0 ? 0 : intersection / union;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function area(box: BoundingBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

