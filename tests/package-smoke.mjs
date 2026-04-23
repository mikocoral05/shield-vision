import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJsonPath = resolve(root, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

function normalizePackagePath(path) {
  return path.replace(/^\.\//, '').replace(/\\/g, '/');
}

function collectEntryPaths() {
  return new Set([
    packageJson.main,
    packageJson.module,
    packageJson.types,
    packageJson.exports['.'].types,
    packageJson.exports['.'].import,
    packageJson.exports['.'].require,
    packageJson.exports['.'].default
  ].map(normalizePackagePath));
}

for (const entryPath of collectEntryPaths()) {
  assert.ok(
    existsSync(resolve(root, entryPath)),
    `Package entry ${entryPath} must exist after build.`
  );
}

const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmArgs = process.env.npm_execpath
  ? [process.env.npm_execpath, 'pack', '--dry-run', '--json']
  : ['pack', '--dry-run', '--json'];
const packOutput = execFileSync(npmCommand, npmArgs, {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});
const [packResult] = JSON.parse(packOutput);
const packedFiles = new Set(packResult.files.map((file) => normalizePackagePath(file.path)));

for (const entryPath of collectEntryPaths()) {
  assert.ok(packedFiles.has(entryPath), `Package entry ${entryPath} must be included in npm pack.`);
}

assert.ok(packedFiles.has('README.md'), 'README.md must be included in the package.');
assert.ok(!packedFiles.has('npm-publish.yml'), 'Root-only workflow files should not be published.');

const moduleUrl = pathToFileURL(resolve(root, normalizePackagePath(packageJson.module))).href;
const publicApi = await import(moduleUrl);
const require = createRequire(import.meta.url);
const commonJsApi = require(resolve(root, normalizePackagePath(packageJson.main)));

for (const exportName of [
  'ShieldVision',
  'createShieldVision',
  'drawRegionOverlay',
  'renderMaskedCanvas'
]) {
  assert.equal(typeof publicApi[exportName], 'function', `${exportName} must be exported.`);
  assert.equal(typeof commonJsApi[exportName], 'function', `${exportName} must be require-able.`);
}
