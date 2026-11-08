import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.platform, 'win32', 'This startup check must run on Windows');
const appDirectory = path.resolve(process.argv[2] || 'dist/win-unpacked');
const appPath = path.join(appDirectory, 'Dosty.exe');
const bridgePath = path.join(appDirectory, 'resources/bin/input-bridge-win-x64.exe');
assert.ok(fs.existsSync(appPath));
assert.ok(fs.existsSync(bridgePath));

// Run the exact packaged native binary: P:1 is emitted only after BOTH Win32
// hook registrations succeed. This does not synthesize or verify physical input.
const probe = spawn(bridgePath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Native hook startup timed out')), 10_000);
    let output = '';
    const finish = error => {
      clearTimeout(timeout);
      error ? reject(error) : resolve();
    };
    probe.once('error', finish);
    probe.once('exit', code => finish(new Error(`Bridge exited before confirmation: ${code}`)));
    probe.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes('P:0')) finish(new Error('Native Win32 hook registration failed'));
      else if (output.includes('P:1')) finish();
    });
  });
  console.log('Packaged native bridge registered keyboard and mouse hooks (P:1).');
} finally {
  probe.stdin.end();
  // The bridge's stdin watcher should terminate it; kill only this probe if needed.
  await Promise.race([
    new Promise(resolve => probe.once('exit', resolve)),
    delay(2_000).then(() => { if (probe.exitCode === null) probe.kill(); }),
  ]);
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dosty-package-'));
const env = { ...process.env, DOSTY_TEST: '1', DOSTY_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const application = spawn(appPath, [], { env, windowsHide: true, stdio: 'inherit' });
let launchError;
application.once('error', error => { launchError = error; });

function bridgeChildren() {
  assert.ok(Number.isInteger(application.pid));
  const script = `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${application.pid}" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress`;
  const output = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { windowsHide: true, encoding: 'utf8', timeout: 15_000 }).trim();
  if (!output) return [];
  const rows = JSON.parse(output);
  return (Array.isArray(rows) ? rows : [rows]).filter(row =>
    row.ExecutablePath?.toLowerCase() === bridgePath.toLowerCase());
}

try {
  let child;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    assert.equal(application.exitCode, null, 'Packaged Dosty quit during startup');
    child = bridgeChildren()[0];
    if (child) break;
    await delay(250);
  }
  assert.ok(child, 'Packaged Dosty did not spawn its bundled native bridge');
  await delay(1_000);
  assert.ok(bridgeChildren().some(row => row.ProcessId === child.ProcessId), 'Native bridge exited after startup');
  assert.ok(fs.existsSync(path.join(userData, 'settings.json')), 'Packaged application did not initialize its isolated settings');
  console.log('Packaged Dosty.exe initialized and kept its bundled bridge running.');
  console.log('Startup smoke passed; physical typing, clicking, dragging and games still need user acceptance.');
} finally {
  // Confined to this disposable test process and its children, never another app.
  if (application.pid && application.exitCode === null) {
    execFileSync('taskkill.exe', ['/PID', String(application.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
