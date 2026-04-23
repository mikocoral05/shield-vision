import assert from 'node:assert/strict';
import { test } from 'node:test';

class MockCanvas {
  width = 0;
  height = 0;

  constructor() {
    this.context = new MockContext(this);
  }

  getContext(type) {
    return type === '2d' ? this.context : null;
  }

  toBlob(callback, type = 'image/png') {
    callback(new Blob(['mock-canvas'], { type }));
  }

  toDataURL(type = 'image/png') {
    return `data:${type};base64,bW9jaw==`;
  }
}

class MockContext {
  fillStyle = '#000000';
  filter = 'none';
  font = '10px sans-serif';
  imageSmoothingEnabled = true;
  lineWidth = 1;
  strokeStyle = '#000000';

  constructor(canvas) {
    this.canvas = canvas;
    this.calls = [];
  }

  beginPath() {
    this.calls.push(['beginPath']);
  }

  closePath() {
    this.calls.push(['closePath']);
  }

  clip() {
    this.calls.push(['clip']);
  }

  drawImage(...args) {
    this.calls.push(['drawImage', args.length]);
  }

  fill() {
    this.calls.push(['fill']);
  }

  fillText(text) {
    this.calls.push(['fillText', text]);
  }

  lineTo(x, y) {
    this.calls.push(['lineTo', x, y]);
  }

  measureText(text) {
    return { width: String(text).length * 8 };
  }

  moveTo(x, y) {
    this.calls.push(['moveTo', x, y]);
  }

  putImageData() {
    this.calls.push(['putImageData']);
  }

  quadraticCurveTo(...args) {
    this.calls.push(['quadraticCurveTo', args.length]);
  }

  restore() {
    this.calls.push(['restore']);
  }

  roundRect(x, y, width, height, radius) {
    this.calls.push(['roundRect', x, y, width, height, radius]);
  }

  save() {
    this.calls.push(['save']);
  }

  stroke() {
    this.calls.push(['stroke']);
  }
}

function installMockDocument({ nativeRoundRect = true } = {}) {
  const canvases = [];

  globalThis.HTMLCanvasElement = MockCanvas;
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, 'canvas');
      const canvas = new MockCanvas();
      if (!nativeRoundRect) {
        canvas.context.roundRect = undefined;
      }
      canvases.push(canvas);
      return canvas;
    }
  };

  return canvases;
}

function createSourceCanvas(width = 320, height = 180) {
  const canvas = new MockCanvas();
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function createOptions(overrides = {}) {
  return {
    maskMode: 'pixelate',
    blurStrength: 18,
    pixelBlockSize: 12,
    cornerRadius: 10,
    ...overrides
  };
}

function createCapabilityReport() {
  return {
    selectedBackend: 'cpu',
    availableBackends: ['cpu'],
    acceleration: 'cpu',
    webgpuAvailable: false,
    webglAvailable: false,
    webnnAvailable: false
  };
}

function primeModels(shieldVision, objectDetections) {
  shieldVision.capabilityPromise = Promise.resolve(createCapabilityReport());
  shieldVision.modelsPromise = Promise.resolve({
    faceModel: {
      dispose() {},
      estimateFaces: async () => []
    },
    objectModel: {
      dispose() {},
      detect: async () => objectDetections
    }
  });
}

test('renderMaskedCanvas preserves dimensions and applies pixelation', async () => {
  installMockDocument();
  const { renderMaskedCanvas } = await import('../dist/shield-vision.es.mjs');
  const source = createSourceCanvas();
  const output = renderMaskedCanvas(
    source,
    [
      {
        id: 'face-1',
        kind: 'face',
        confidence: 0.95,
        label: 'Face',
        detector: 'blazeface',
        x: 24,
        y: 18,
        width: 96,
        height: 72
      }
    ],
    createOptions()
  );

  assert.equal(output.width, source.width);
  assert.equal(output.height, source.height);
  assert.ok(output.context.calls.some(([name]) => name === 'drawImage'));
  assert.ok(output.context.calls.some(([name]) => name === 'clip'));
});

test('drawRegionOverlay renders labels without requiring native roundRect', async () => {
  installMockDocument({ nativeRoundRect: false });
  const { drawRegionOverlay } = await import('../dist/shield-vision.es.mjs');
  const source = createSourceCanvas();

  const overlay = drawRegionOverlay(source, [
    {
      id: 'plate-1',
      kind: 'license_plate',
      confidence: 0.77,
      label: 'License plate zone',
      detector: 'vehicle-heuristic',
      parentLabel: 'car',
      x: 120,
      y: 90,
      width: 80,
      height: 24
    }
  ]);

  assert.equal(overlay.width, source.width);
  assert.equal(overlay.height, source.height);
  assert.ok(overlay.context.calls.some(([name]) => name === 'fillText'));
  assert.ok(overlay.context.calls.some(([name]) => name === 'quadraticCurveTo'));
});

test('public constructor is import-safe in Node-like environments', async () => {
  delete globalThis.document;
  const { createShieldVision, ShieldVision } = await import('../dist/shield-vision.es.mjs');
  const shieldVision = createShieldVision({
    maxFaces: 0,
    pixelBlockSize: 0,
    blurStrength: Number.POSITIVE_INFINITY
  });

  assert.ok(shieldVision instanceof ShieldVision);
  assert.equal(typeof shieldVision.updateOptions, 'function');
  assert.equal(typeof shieldVision.dispose, 'function');
});

test('license plate masking defaults to conservative vehicle regions', async () => {
  installMockDocument();
  const { createShieldVision } = await import('../dist/shield-vision.es.mjs');
  const shieldVision = createShieldVision({
    enableFaceMasking: false,
    objectConfidence: 0.5
  });
  primeModels(shieldVision, [
    {
      bbox: [50, 40, 100, 80],
      class: 'car',
      score: 0.9
    }
  ]);

  const result = await shieldVision.analyze(createSourceCanvas());
  const [region] = result.regions;

  assert.equal(region.detector, 'vehicle-conservative');
  assert.equal(region.parentLabel, 'car');
  assert.ok(region.width > 100);
  assert.ok(region.height > 80);
});

test('plate-zone fallback remains available as an opt-in tighter heuristic', async () => {
  installMockDocument();
  const { createShieldVision } = await import('../dist/shield-vision.es.mjs');
  const shieldVision = createShieldVision({
    enableFaceMasking: false,
    licensePlateFallback: 'plate-zone',
    objectConfidence: 0.5
  });
  primeModels(shieldVision, [
    {
      bbox: [50, 40, 100, 80],
      class: 'car',
      score: 0.9
    }
  ]);

  const result = await shieldVision.analyze(createSourceCanvas());
  const [region] = result.regions;

  assert.equal(region.detector, 'vehicle-heuristic');
  assert.equal(region.parentLabel, 'car');
  assert.ok(region.width < 60);
  assert.ok(region.height < 20);
});

test('custom license plate detector takes precedence over fallback masking', async () => {
  installMockDocument();
  const { createShieldVision } = await import('../dist/shield-vision.es.mjs');
  let objectDetectorCalls = 0;
  const shieldVision = createShieldVision({
    enableFaceMasking: false,
    licensePlateDetector: async () => [
      {
        x: 96,
        y: 128,
        width: 48,
        height: 18,
        confidence: 0.94
      }
    ],
    objectConfidence: 0.5
  });

  shieldVision.capabilityPromise = Promise.resolve(createCapabilityReport());
  shieldVision.modelsPromise = Promise.resolve({
    faceModel: {
      dispose() {},
      estimateFaces: async () => []
    },
    objectModel: {
      dispose() {},
      detect: async () => {
        objectDetectorCalls += 1;
        return [
          {
            bbox: [50, 40, 100, 80],
            class: 'car',
            score: 0.9
          }
        ];
      }
    }
  });

  const result = await shieldVision.analyze(createSourceCanvas());
  const [region] = result.regions;

  assert.equal(region.detector, 'custom-license-plate');
  assert.equal(objectDetectorCalls, 0);
  assert.ok(region.width >= 48);
});
