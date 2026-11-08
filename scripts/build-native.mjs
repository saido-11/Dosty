import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const binDir = path.join(rootDir, 'resources', 'bin');
const allowUnsupported = process.argv.includes('--if-supported');

fs.mkdirSync(binDir, { recursive: true });

function buildMacOS() {
  const src = path.join(rootDir, 'native', 'macos', 'input-bridge.swift');
  const out = path.join(binDir, 'input-bridge-macos');
  const moduleCache = path.join(os.tmpdir(), 'dosty-swift-cache');
  fs.mkdirSync(moduleCache, { recursive: true });

  const swiftArgs = ['-module-cache-path', moduleCache, '-O', src, '-o', out];
  if (process.env.MACOS_ARCH === 'arm64' || process.arch === 'arm64') {
    swiftArgs.unshift('-target', 'arm64-apple-macosx12.0');
  }

  execFileSync('swiftc', swiftArgs, { stdio: 'inherit' });
  fs.chmodSync(out, 0o755);
  console.log(`[build:native] macOS giriş köprüsü derlendi: ${out}`);
}

function findWindowsCsc() {
  const windir = process.env.WINDIR || 'C:\Windows';
  const candidates = [
    path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'csc.exe';
}

function buildWindows() {
  const src = path.join(rootDir, 'native', 'windows', 'InputBridge.cs');
  const out = path.join(binDir, 'input-bridge-win-x64.exe');
  const csc = findWindowsCsc();

  execFileSync(
    csc,
    ['/nologo', '/optimize+', '/target:exe', '/platform:x64', `/out:${out}`, src],
    { stdio: 'inherit' }
  );
  console.log(`[build:native] Windows giriş köprüsü derlendi: ${out}`);
}

async function ensureElectronMacExtracted() {
  const electronDir = path.join(rootDir, 'node_modules', 'electron');
  if (!fs.existsSync(electronDir)) return;

  const fwBin = path.join(
    electronDir,
    'dist',
    'Electron.app',
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Electron Framework'
  );
  const pathTxt = path.join(electronDir, 'path.txt');
  if (fs.existsSync(fwBin) && fs.existsSync(pathTxt)) return;

  try {
    const { downloadArtifact } = require('@electron/get');
    const pkg = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'));
    const zipPath = await downloadArtifact({
      version: pkg.version,
      artifactName: 'electron',
      platform: 'darwin',
      arch: process.arch,
    });
    const distDir = path.join(electronDir, 'dist');
    fs.rmSync(distDir, { recursive: true, force: true });
    execFileSync('ditto', ['-x', '-k', zipPath, distDir], { stdio: 'inherit' });
    fs.writeFileSync(pathTxt, 'Electron.app/Contents/MacOS/Electron');
    console.log('[build:native] Electron macOS uygulama paketi doğrulandı.');
  } catch {
    // Skip if offline and not cached
  }
}

if (process.platform === 'darwin') {
  await ensureElectronMacExtracted();
  buildMacOS();
} else if (process.platform === 'win32') {
  buildWindows();
} else if (allowUnsupported) {
  console.log(`[build:native] ${process.platform} için yerel derleme atlandı.`);
} else {
  throw new Error(`Desteklenmeyen platform: ${process.platform}`);
}
