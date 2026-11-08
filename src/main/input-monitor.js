'use strict';

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

class InputMonitor {
  /**
   * @param {object} options
   * @param {string} options.binDir
   * @param {() => void} options.onKeyboard
   * @param {() => void} options.onMouse
   * @param {(granted: boolean) => void} options.onPermissionChange
   */
  constructor({ binDir, onKeyboard, onMouse, onMouseButtonChange, onPermissionChange }) {
    this.binDir = binDir;
    this.onKeyboard = onKeyboard || (() => {});
    this.onMouse = onMouse || (() => {});
    this.onMouseButtonChange = onMouseButtonChange || (() => {});
    this.onPermissionChange = onPermissionChange || (() => {});

    this.child = null;
    this.permissionGranted = process.platform !== 'darwin';
    this.running = false;
    this._stdoutRemainder = '';
  }

  getBinaryPath() {
    if (process.platform === 'darwin') {
      return path.join(this.binDir, 'input-bridge-macos');
    }
    if (process.platform === 'win32') {
      return path.join(this.binDir, 'input-bridge-win-x64.exe');
    }
    return null;
  }

  start() {
    if (this.running) return;
    const binPath = this.getBinaryPath();
    if (!binPath || !fs.existsSync(binPath)) {
      this.permissionGranted = false;
      this.onPermissionChange(false);
      return;
    }

    this.running = true;
    this._stdoutRemainder = '';

    const child = spawn(binPath, [], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      this._stdoutRemainder += chunk;
      let newlineIdx = this._stdoutRemainder.indexOf('\n');
      while (newlineIdx !== -1) {
        const line = this._stdoutRemainder.slice(0, newlineIdx).trim();
        this._stdoutRemainder = this._stdoutRemainder.slice(newlineIdx + 1);
        this._handleLine(line);
        newlineIdx = this._stdoutRemainder.indexOf('\n');
      }
    });

    child.on('error', () => {
      this.running = false;
      this.child = null;
    });

    child.on('exit', () => {
      this.onMouseButtonChange(false);
      if (this.child === child) {
        this.running = false;
        this.child = null;
      }
    });
  }

  _handleLine(line) {
    if (!line) return;
    if (line === 'L:1' || line === 'L:0') {
      this.onMouseButtonChange(line === 'L:1');
    } else if (line === 'K') {
      this.onKeyboard();
    } else if (line === 'M') {
      this.onMouse();
    } else if (line === 'P:1') {
      this.permissionGranted = true;
      this.onPermissionChange(true);
    } else if (line === 'P:0') {
      this.permissionGranted = false;
      this.onPermissionChange(false);
    }
  }

  checkPermission() {
    return new Promise((resolve) => {
      if (process.platform !== 'darwin') {
        this.permissionGranted = true;
        resolve(true);
        return;
      }
      const binPath = this.getBinaryPath();
      if (!binPath || !fs.existsSync(binPath)) {
        resolve(false);
        return;
      }
      execFile(binPath, ['--check-permission'], { timeout: 3000 }, (err, stdout) => {
        if (err) {
          resolve(this.permissionGranted);
          return;
        }
        const granted = String(stdout).trim().includes('P:1');
        if (granted !== this.permissionGranted) {
          this.permissionGranted = granted;
          this.onPermissionChange(granted);
        }
        resolve(granted);
      });
    });
  }

  requestPermissionPrompt() {
    return new Promise((resolve) => {
      if (process.platform !== 'darwin') {
        resolve(true);
        return;
      }
      const binPath = this.getBinaryPath();
      if (!binPath || !fs.existsSync(binPath)) {
        resolve(false);
        return;
      }
      execFile(binPath, ['--request-permission'], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          resolve(false);
          return;
        }
        const granted = String(stdout).trim().includes('P:1');
        this.permissionGranted = granted;
        this.onPermissionChange(granted);
        resolve(granted);
      });
    });
  }

  restart() {
    this.stop();
    this.start();
  }

  stop() {
    this.running = false;
    if (this.child) {
      try {
        this.child.stdin.end();
      } catch {
        // ignore
      }
      try {
        this.child.kill();
      } catch {
        // ignore
      }
      this.child = null;
    }
  }
}

module.exports = { InputMonitor };
