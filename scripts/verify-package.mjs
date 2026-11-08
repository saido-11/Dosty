import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const appDir = path.resolve(process.argv[2] || 'dist/mac-arm64/Dosty.app');
const isMac = appDir.endsWith('.app');
const resources = isMac ? path.join(appDir, 'Contents/Resources') : path.join(appDir, 'resources');
const bridge = path.join(resources, 'bin', isMac ? 'input-bridge-macos' : 'input-bridge-win-x64.exe');
assert.ok(fs.existsSync(bridge), `Missing native input bridge: ${bridge}`);
assert.ok(fs.statSync(bridge).size > 0);
const archive = path.join(resources, 'app.asar');
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  assert.deepEqual(asar.extractFile(archive, file), fs.readFileSync(file), `Missing or outdated license notice: ${file}`);
}
for (const file of ['LICENSE.electron.txt', 'LICENSES.chromium.html']) {
  assert.ok(fs.statSync(path.join(isMac ? resources : appDir, file)).size > 0, `Missing bundled dependency notices: ${file}`);
}
const packagedMetadata = JSON.parse(asar.extractFile(archive, 'package.json'));
assert.equal(packagedMetadata.productName, 'Dosty');
assert.equal(packagedMetadata.license, 'GPL-3.0-only');
const files = asar.listPackage(archive).map(f => f.replace(/^\//, ''));
const sourceFiles = fs.readdirSync('src', {recursive: true}).filter(f => fs.statSync(path.join('src', f)).isFile()).map(f => 'src/' + f.replaceAll('\\', '/'));
for (const file of sourceFiles) {
  assert.ok(files.includes(file), `Missing packaged source: ${file}`);
  assert.deepEqual(asar.extractFile(archive, file), fs.readFileSync(file), `Outdated packaged source: ${file}`);
}
assert.ok(!files.some(f => /(?:^|\/)(?:node_modules|test-results|\.env)(?:\/|$)/.test(f)));
for (const pose of ['idle','keyboard','mouse','both','blink']) {
  const rel = `characters/mor-kedi/${pose}.png`;
  assert.deepEqual(fs.readFileSync(path.join(resources, rel)), fs.readFileSync(path.join('resources', rel)));
}
for (const ext of [isMac ? 'icns' : 'ico', 'png']) {
  assert.deepEqual(fs.readFileSync(path.join(resources, `icons/app-icon.${ext}`)), fs.readFileSync(`resources/icons/app-icon.${ext}`));
}
if (isMac && process.platform === 'darwin') execFileSync('codesign', ['--verify','--deep','--strict',appDir], {stdio: 'inherit'});
if (!isMac) {
  const outputs = fs.readdirSync('dist');
  assert.ok(outputs.some(f => f.endsWith('-setup.exe')), 'Missing setup EXE');
  assert.ok(outputs.some(f => f.endsWith('-portable.exe')), 'Missing portable EXE');
}
console.log('Package sources, languages, Purple Cat, icons and native bridge verified.');
