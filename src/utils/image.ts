import type { ImageSource } from '../types';

export async function normalizeSourceToCanvas(source: ImageSource): Promise<HTMLCanvasElement> {
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    return cloneCanvas(source);
  }

  if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
    const canvas = createCanvas(source.width, source.height);
    const context = getContext(canvas);
    context.putImageData(source, 0, 0);
    return canvas;
  }

  if (typeof source === 'string') {
    const image = await loadImage(source);
    return drawDrawableToCanvas(image, image.naturalWidth || image.width, image.naturalHeight || image.height);
  }

  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    return drawDrawableToCanvas(source, source.width, source.height);
  }

  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(source);
      const canvas = drawDrawableToCanvas(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      return canvas;
    }

    const image = await loadImage(URL.createObjectURL(source), true);
    return drawDrawableToCanvas(image, image.naturalWidth || image.width, image.naturalHeight || image.height);
  }

  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    if ('decode' in source && !source.complete) {
      await source.decode();
    }

    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    return drawDrawableToCanvas(source, width, height);
  }

  throw new Error('Unsupported image source. Expected a browser image-like object, blob, or URL.');
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('Shield Vision requires a browser-like DOM with document.createElement.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  return drawDrawableToCanvas(source, source.width, source.height);
}

export function getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('2D canvas context is not available in this browser.');
  }

  return context;
}

function drawDrawableToCanvas(
  source: CanvasImageSource,
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const context = getContext(canvas);
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function loadImage(source: string, revokeObjectUrl = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (revokeObjectUrl && source.startsWith('blob:')) {
        URL.revokeObjectURL(source);
      }

      resolve(image);
    };
    image.onerror = () => {
      if (revokeObjectUrl && source.startsWith('blob:')) {
        URL.revokeObjectURL(source);
      }

      reject(new Error(`Unable to load image source: ${source}`));
    };
    image.src = source;
  });
}
