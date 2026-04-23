import './styles.css';

import { createShieldVision, drawRegionOverlay, type CapabilityReport, type MaskMode } from '../src';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Unable to mount Shield Vision demo.');
}

app.innerHTML = `
  <div class="app-shell">
    <header class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Client-Side Privacy Masking</p>
        <h1>Blur faces and license plates before the upload ever happens.</h1>
        <p class="lede">
          Shield Vision runs TensorFlow.js directly in the browser, chooses the fastest available
          backend on the device, and masks sensitive regions locally so your servers never touch the raw image.
        </p>
        <div class="hero-tags">
          <span>GDPR-ready workflow</span>
          <span>WebGPU / WebGL aware</span>
          <span>4K-first pipeline</span>
        </div>
      </div>
      <div class="hero-card">
        <p class="card-label">What makes this premium</p>
        <p class="card-stat" id="backendBadge">Detecting hardware…</p>
        <p class="card-note" id="capabilitySummary">
          Backend selection happens on-device and prefers accelerated paths whenever the browser exposes them.
        </p>
      </div>
    </header>

    <main class="workspace">
      <section class="panel control-panel">
        <div class="section-heading">
          <p class="kicker">Input</p>
          <h2>Local processing only</h2>
        </div>

        <label class="dropzone" id="dropzone" for="imageInput">
          <input id="imageInput" type="file" accept="image/*" />
          <span class="dropzone-title">Drop an image here</span>
          <span class="dropzone-subtitle">or click to choose a local file with people or vehicles</span>
        </label>

        <div class="controls">
          <label class="field">
            <span>Mask style</span>
            <select id="maskMode">
              <option value="blur">Blur</option>
              <option value="pixelate">Pixelate</option>
            </select>
          </label>

          <label class="field">
            <span>Blur strength</span>
            <input id="blurStrength" type="range" min="8" max="36" step="1" value="18" />
            <strong id="blurStrengthValue">18px</strong>
          </label>

          <label class="field">
            <span>Pixel block</span>
            <input id="pixelBlockSize" type="range" min="6" max="30" step="1" value="14" />
            <strong id="pixelBlockSizeValue">14px</strong>
          </label>
        </div>

        <div class="toggles">
          <label class="toggle">
            <input id="maskFaces" type="checkbox" checked />
            <span>Mask faces</span>
          </label>
          <label class="toggle">
            <input id="maskPlates" type="checkbox" checked />
            <span>Mask vehicle plate zones</span>
          </label>
        </div>

        <div class="button-row">
          <button id="primeButton" class="button button-secondary" type="button">Prime models</button>
          <button id="downloadButton" class="button button-primary" type="button" disabled>
            Export masked image
          </button>
        </div>

        <div class="status-block">
          <p class="status-title">Status</p>
          <p class="status-text" id="statusText">
            Waiting for an image. The browser will process everything locally.
          </p>
        </div>

        <div class="metrics-grid">
          <article class="metric">
            <span>Backend</span>
            <strong id="metricBackend">--</strong>
          </article>
          <article class="metric">
            <span>Total time</span>
            <strong id="metricTotal">--</strong>
          </article>
          <article class="metric">
            <span>Detections</span>
            <strong id="metricDetections">--</strong>
          </article>
          <article class="metric">
            <span>Acceleration</span>
            <strong id="metricAcceleration">--</strong>
          </article>
        </div>

        <p class="footnote">
          Face detection is model-based. License plate masking is vehicle-assisted and should be tuned against your fleet imagery before production rollout.
        </p>
      </section>

      <section class="panel preview-panel">
        <div class="section-heading">
          <p class="kicker">Output</p>
          <h2>Original, masked, and detection overlay</h2>
        </div>

        <div class="preview-grid">
          <article class="preview-card">
            <div class="preview-label">Original</div>
            <canvas id="originalCanvas"></canvas>
          </article>
          <article class="preview-card">
            <div class="preview-label">Masked output</div>
            <canvas id="maskedCanvas"></canvas>
          </article>
          <article class="preview-card">
            <div class="preview-label">Detection overlay</div>
            <canvas id="overlayCanvas"></canvas>
          </article>
        </div>
      </section>
    </main>
  </div>
`;

const elements = {
  imageInput: query<HTMLInputElement>('#imageInput'),
  maskMode: query<HTMLSelectElement>('#maskMode'),
  blurStrength: query<HTMLInputElement>('#blurStrength'),
  blurStrengthValue: query<HTMLElement>('#blurStrengthValue'),
  pixelBlockSize: query<HTMLInputElement>('#pixelBlockSize'),
  pixelBlockSizeValue: query<HTMLElement>('#pixelBlockSizeValue'),
  maskFaces: query<HTMLInputElement>('#maskFaces'),
  maskPlates: query<HTMLInputElement>('#maskPlates'),
  statusText: query<HTMLElement>('#statusText'),
  backendBadge: query<HTMLElement>('#backendBadge'),
  capabilitySummary: query<HTMLElement>('#capabilitySummary'),
  metricBackend: query<HTMLElement>('#metricBackend'),
  metricTotal: query<HTMLElement>('#metricTotal'),
  metricDetections: query<HTMLElement>('#metricDetections'),
  metricAcceleration: query<HTMLElement>('#metricAcceleration'),
  originalCanvas: query<HTMLCanvasElement>('#originalCanvas'),
  maskedCanvas: query<HTMLCanvasElement>('#maskedCanvas'),
  overlayCanvas: query<HTMLCanvasElement>('#overlayCanvas'),
  primeButton: query<HTMLButtonElement>('#primeButton'),
  downloadButton: query<HTMLButtonElement>('#downloadButton'),
  dropzone: query<HTMLElement>('#dropzone')
};

const shieldVision = createShieldVision(readOptions());
const state = {
  currentFile: null as File | null,
  lastExportUrl: null as string | null,
  processing: false,
  queued: false
};

updateSliderLabels();
seedCanvases();
attachEvents();
void loadCapabilities();

function attachEvents(): void {
  elements.imageInput.addEventListener('change', () => {
    const file = elements.imageInput.files?.[0];
    if (file) {
      state.currentFile = file;
      void processCurrentFile();
    }
  });

  elements.primeButton.addEventListener('click', async () => {
    shieldVision.updateOptions(readOptions());
    setStatus('Downloading models and priming the selected backend…');
    elements.primeButton.disabled = true;

    try {
      const capability = await shieldVision.warmup();
      renderCapabilities(capability);
      setStatus(`Models are warm on ${capability.selectedBackend.toUpperCase()}. Upload an image to run masking.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to prime the local models.');
    } finally {
      elements.primeButton.disabled = false;
    }
  });

  elements.downloadButton.addEventListener('click', async () => {
    if (!state.currentFile) {
      return;
    }

    shieldVision.updateOptions(readOptions());
    const result = await shieldVision.mask(state.currentFile);
    const blob = await result.toBlob('image/jpeg', 0.92);
    if (state.lastExportUrl) {
      URL.revokeObjectURL(state.lastExportUrl);
    }

    state.lastExportUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = state.lastExportUrl;
    anchor.download = `${stripExtension(state.currentFile.name)}-masked.jpg`;
    anchor.click();
  });

  const interactiveControls = [
    elements.maskMode,
    elements.blurStrength,
    elements.pixelBlockSize,
    elements.maskFaces,
    elements.maskPlates
  ];

  for (const control of interactiveControls) {
    control.addEventListener('input', () => {
      updateSliderLabels();
      shieldVision.updateOptions(readOptions());
      if (state.currentFile) {
        void processCurrentFile();
      }
    });
  }

  elements.dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    elements.dropzone.classList.add('is-dragging');
  });

  elements.dropzone.addEventListener('dragleave', () => {
    elements.dropzone.classList.remove('is-dragging');
  });

  elements.dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove('is-dragging');
    const file = event.dataTransfer?.files?.[0];

    if (file && file.type.startsWith('image/')) {
      state.currentFile = file;
      void processCurrentFile();
    }
  });
}

async function processCurrentFile(): Promise<void> {
  if (!state.currentFile) {
    return;
  }

  if (state.processing) {
    state.queued = true;
    return;
  }

  state.processing = true;
  state.queued = false;
  elements.downloadButton.disabled = true;
  shieldVision.updateOptions(readOptions());
  setStatus('Processing on this device… no raw image leaves the browser.');

  try {
    const [originalCanvas, result] = await Promise.all([
      fileToCanvas(state.currentFile),
      shieldVision.mask(state.currentFile)
    ]);

    const overlayCanvas = drawRegionOverlay(originalCanvas, result.regions);
    paintCanvas(elements.originalCanvas, originalCanvas);
    paintCanvas(elements.maskedCanvas, result.canvas);
    paintCanvas(elements.overlayCanvas, overlayCanvas);
    renderCapabilities(result.capability);
    renderMetrics(result);
    elements.downloadButton.disabled = false;

    const faces = result.regions.filter((region) => region.kind === 'face').length;
    const plates = result.regions.filter((region) => region.kind === 'license_plate').length;
    setStatus(
      `Masked ${result.regions.length} regions in ${formatMs(result.metrics.totalMs)}. Faces: ${faces}. Plate zones: ${plates}.`
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'The image could not be processed locally.');
  } finally {
    state.processing = false;

    if (state.queued) {
      state.queued = false;
      void processCurrentFile();
    }
  }
}

async function loadCapabilities(): Promise<void> {
  shieldVision.updateOptions(readOptions());
  const capability = await shieldVision.getCapabilities();
  renderCapabilities(capability);
}

function renderCapabilities(capability: CapabilityReport): void {
  elements.backendBadge.textContent = capability.selectedBackend.toUpperCase();
  elements.capabilitySummary.textContent = `Acceleration: ${capability.acceleration.toUpperCase()} • Available backends: ${capability.availableBackends.join(', ')}`;
  elements.metricBackend.textContent = capability.selectedBackend.toUpperCase();
  elements.metricAcceleration.textContent = capability.acceleration.toUpperCase();
}

function renderMetrics(result: Awaited<ReturnType<typeof shieldVision.mask>>): void {
  elements.metricTotal.textContent = formatMs(result.metrics.totalMs);
  elements.metricDetections.textContent = String(result.regions.length);
}

function updateSliderLabels(): void {
  elements.blurStrengthValue.textContent = `${elements.blurStrength.value}px`;
  elements.pixelBlockSizeValue.textContent = `${elements.pixelBlockSize.value}px`;
}

function readOptions(): {
  preferredBackend: 'auto';
  maskMode: MaskMode;
  blurStrength: number;
  pixelBlockSize: number;
  enableFaceMasking: boolean;
  enableLicensePlateMasking: boolean;
} {
  return {
    preferredBackend: 'auto',
    maskMode: elements.maskMode.value as MaskMode,
    blurStrength: Number(elements.blurStrength.value),
    pixelBlockSize: Number(elements.pixelBlockSize.value),
    enableFaceMasking: elements.maskFaces.checked,
    enableLicensePlateMasking: elements.maskPlates.checked
  };
}

function seedCanvases(): void {
  const canvases = [elements.originalCanvas, elements.maskedCanvas, elements.overlayCanvas];

  for (const canvas of canvases) {
    canvas.width = 960;
    canvas.height = 540;
    const context = canvas.getContext('2d');
    if (!context) {
      continue;
    }

    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#0b1824');
    gradient.addColorStop(1, '#14263b');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    for (let x = 0; x < canvas.width; x += 40) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
    context.fillStyle = 'rgba(255, 255, 255, 0.72)';
    context.font = '600 22px "Space Grotesk", sans-serif';
    context.fillText('Upload an image to preview local masking.', 32, 52);
  }
}

function paintCanvas(target: HTMLCanvasElement, source: HTMLCanvasElement): void {
  target.width = source.width;
  target.height = source.height;
  const context = target.getContext('2d');

  if (!context) {
    return;
  }

  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0);
}

async function fileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Unable to preview the selected image.'));
      element.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setStatus(message: string): void {
  elements.statusText.textContent = message;
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}

function stripExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot === -1 ? filename : filename.slice(0, lastDot);
}
