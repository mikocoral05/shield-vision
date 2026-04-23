import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import path from 'path';

export default defineConfig(({ command, mode }) => {
  const isLibraryBuild = command === 'build' && mode !== 'demo';

  if (isLibraryBuild) {
    return {
      build: {
        lib: {
          entry: path.resolve(process.cwd(), 'src/index.ts'),
          name: 'ShieldVision',
          fileName: (format) =>
            format === 'es' ? 'shield-vision.es.mjs' : 'shield-vision.umd.cjs'
        },
        rollupOptions: {
          external: [],
          output: {
            globals: {}
          }
        }
      },
      plugins: [
        dts({
          entryRoot: 'src',
          include: ['src/**/*.ts', 'src/**/*.d.ts']
        })
      ]
    };
  }

  return {
    build:
      mode === 'demo'
        ? {
            outDir: 'demo-dist',
            rollupOptions: {
              output: {
                manualChunks(id) {
                  if (id.includes('@tensorflow/tfjs-backend-webgpu')) {
                    return 'tfjs-backend-webgpu';
                  }

                  if (id.includes('@tensorflow/tfjs-backend-webgl')) {
                    return 'tfjs-backend-webgl';
                  }

                  if (id.includes('@tensorflow/tfjs-backend-wasm')) {
                    return 'tfjs-backend-wasm';
                  }

                  if (id.includes('@tensorflow/tfjs-converter')) {
                    return 'tfjs-converter';
                  }

                  if (
                    id.includes('@tensorflow/tfjs-core') ||
                    id.includes('@tensorflow/tfjs') ||
                    id.includes('/tfjs/')
                  ) {
                    return 'tfjs-core';
                  }

                  if (id.includes('@tensorflow-models/blazeface')) {
                    return 'model-blazeface';
                  }

                  if (id.includes('@tensorflow-models/coco-ssd')) {
                    return 'model-coco-ssd';
                  }

                  return undefined;
                }
              }
            }
          }
        : undefined
  };
});
