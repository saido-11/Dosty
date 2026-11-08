import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electron = require('electron');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dosty-e2e-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

try {
  for (const phase of [1, 2]) {
    const result = spawnSync(electron, [
      path.join(root, 'test/e2e-electron-verify.js'),
      `--phase=${phase}`, `--user-data=${userData}`,
    ], { cwd: root, env, stdio: 'inherit', timeout: 120_000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Electron phase ${phase} failed (${result.signal || result.status})`);
  }
  console.log('[E2E] All checks passed, including restart after the first process exited.');
} finally {
  // Windows may release renderer file handles shortly after the main process exits.
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
