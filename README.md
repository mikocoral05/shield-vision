# Shield Vision

Shield Vision is a client-side privacy masking library for browsers. It detects faces with BlazeFace, masks license plate risk areas from vehicle detections, and applies blur or pixelation before an image is uploaded to a server.

The goal is simple: keep the original image on the user's device so backend systems never handle unredacted personal data.

## What it does

- Auto-selects the fastest available TensorFlow.js backend, preferring `webgpu`, then `webgl`, then `wasm`, then `cpu`
- Detects faces locally with BlazeFace
- Detects vehicles locally with COCO-SSD and masks conservative plate-risk regions by default
- Supports custom license plate detectors for teams with a dedicated trained model
- Masks sensitive regions with blur or pixelation on a canvas
- Exposes capability reporting so apps can show whether acceleration is active
- Includes a polished Vite demo for trying the pipeline with local images

## Quick start

```bash
npm install
npm run dev
```

Open the Vite app in a browser, upload an image, and the demo will render:

- the original image
- the masked output
- the detection overlay
- backend and timing metrics

## Library usage

```ts
import { createShieldVision } from 'shield-vision';

const shieldVision = createShieldVision({
  preferredBackend: 'auto',
  maskMode: 'blur',
  blurStrength: 18,
  enableFaceMasking: true,
  enableLicensePlateMasking: true,
  // Production-safe default: mask the full detected vehicle as the plate risk area.
  licensePlateFallback: 'vehicle',
  // Recommended for production: serve model files from infrastructure you control.
  // faceModelUrl: '/models/blazeface/model.json',
  // objectModelUrl: '/models/coco-ssd/model.json',
  // Required only when you want WASM fallback and host the TFJS WASM binaries yourself.
  // wasmPaths: '/vendor/tfjs-backend-wasm/'
});

await shieldVision.warmup();

const result = await shieldVision.mask(file);
console.log(result.backend, result.metrics.totalMs, result.regions);

const blob = await result.toBlob('image/jpeg', 0.92);
```

### License Plate Modes

By default, `licensePlateFallback: 'vehicle'` masks the full detected vehicle region. This favors privacy over preserving vehicle detail, which is the safer production behavior when a dedicated plate detector is not configured.

Use `licensePlateFallback: 'plate-zone'` only when you accept a tighter, vehicle-assisted heuristic. Use `licensePlateFallback: 'none'` with `licensePlateDetector` when your app provides its own dedicated detector.

```ts
const shieldVision = createShieldVision({
  licensePlateDetector: async (canvas) => {
    // Return boxes from your own trained plate detector.
    return [{ x: 120, y: 220, width: 92, height: 28, confidence: 0.96 }];
  },
  licensePlateFallback: 'vehicle'
});
```

## Scripts

- `npm run dev` starts the demo
- `npm run build` builds the distributable SDK into `dist/`
- `npm run build:demo` builds the demo site into `demo-dist/`
- `npm run check` runs TypeScript without emitting files
- `npm test` builds the SDK and runs package/browser smoke tests
- `npm run verify` runs typecheck, tests, demo build, and a production dependency audit
- `npm run preview` previews the built demo or library environment through Vite

## Project structure

- `src/` contains the reusable Shield Vision SDK
- `demo/` contains the browser demo UI
- `dist/` contains the packaged library output
- `demo-dist/` contains the built demo output

## Notes

- Face detection is model-based and fairly direct.
- License plate masking defaults to conservative vehicle-region masking unless a custom detector returns plate boxes.
- For high-risk privacy workflows, keep `licensePlateFallback: 'vehicle'` unless you have validated a dedicated detector against your exact camera angles, regions, and vehicle types.

## Production checklist

- Run `npm run verify` before publishing or deploying.
- Self-host `faceModelUrl` and `objectModelUrl` if your product cannot depend on TensorFlow's public model URLs at runtime.
- If you rely on the WASM backend, serve `tfjs-backend-wasm.wasm`, `tfjs-backend-wasm-simd.wasm`, and `tfjs-backend-wasm-threaded-simd.wasm`, then set `wasmPaths` before calling `warmup()`.
- Keep WebGL or WebGPU enabled for best performance; the CPU fallback is functional but slower on large images.
- Leave `licensePlateFallback: 'vehicle'` enabled for fail-closed plate privacy when a dedicated detector misses or is not configured.
