import type {
  CapabilityReport,
  HardwareAccelerationTier,
  ShieldVisionBackend,
  WasmPaths
} from './types';

const AUTO_BACKEND_ORDER: ShieldVisionBackend[] = ['webgpu', 'webgl', 'wasm', 'cpu'];
let tfPromise: Promise<typeof import('@tensorflow/tfjs')> | null = null;
const backendRegistrationPromises: Partial<Record<ShieldVisionBackend, Promise<unknown>>> = {};

export async function ensureBestBackend(
  preferred: ShieldVisionBackend | 'auto',
  wasmPaths?: WasmPaths
): Promise<CapabilityReport> {
  const tf = await loadTensorFlow();

  const webgpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const webglAvailable = supportsWebGl();
  const webnnAvailable = typeof navigator !== 'undefined' && 'ml' in navigator;
  const availability: Record<ShieldVisionBackend, boolean> = {
    webgpu: webgpuAvailable,
    webgl: webglAvailable,
    wasm: true,
    cpu: true
  };

  const order =
    preferred === 'auto'
      ? AUTO_BACKEND_ORDER
      : [preferred, ...AUTO_BACKEND_ORDER.filter((backend) => backend !== preferred)];

  let selectedBackend: ShieldVisionBackend = 'cpu';

  for (const backend of order) {
    if (!availability[backend]) {
      continue;
    }

    try {
      await ensureBackendRegistration(backend, wasmPaths);
      const success = await tf.setBackend(backend);
      if (!success) {
        continue;
      }

      await tf.ready();
      selectedBackend = backend;
      break;
    } catch {
      continue;
    }
  }

  const acceleration: HardwareAccelerationTier =
    selectedBackend === 'webgpu' || selectedBackend === 'webgl'
      ? 'gpu'
      : 'cpu';

  return {
    selectedBackend,
    availableBackends: AUTO_BACKEND_ORDER.filter((backend) => availability[backend]),
    acceleration,
    webgpuAvailable,
    webglAvailable,
    webnnAvailable,
    logicalProcessors:
      typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
        ? navigator.hardwareConcurrency
        : undefined,
    deviceMemoryGb:
      typeof navigator !== 'undefined' && typeof navigator.deviceMemory === 'number'
        ? navigator.deviceMemory
        : undefined
  };
}

async function loadTensorFlow(): Promise<typeof import('@tensorflow/tfjs')> {
  if (!tfPromise) {
    tfPromise = import('@tensorflow/tfjs');
  }

  return tfPromise;
}

async function ensureBackendRegistration(
  backend: ShieldVisionBackend,
  wasmPaths?: WasmPaths
): Promise<void> {
  if (backend === 'cpu') {
    return;
  }

  if (!backendRegistrationPromises[backend]) {
    backendRegistrationPromises[backend] =
      backend === 'webgpu'
        ? import('@tensorflow/tfjs-backend-webgpu')
        : backend === 'webgl'
          ? import('@tensorflow/tfjs-backend-webgl')
          : import('@tensorflow/tfjs-backend-wasm');
  }

  const backendModule = await backendRegistrationPromises[backend];

  if (backend === 'wasm' && wasmPaths) {
    (backendModule as typeof import('@tensorflow/tfjs-backend-wasm')).setWasmPaths(wasmPaths);
  }
}

function supportsWebGl(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  const canvas = document.createElement('canvas');
  return Boolean(
    canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
  );
}
