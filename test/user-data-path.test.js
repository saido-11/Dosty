'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveUserDataPath } = require('../src/core/user-data-path');

test('Dosty preserves legacy libraries; fresh installs use Dosty; current data takes priority', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dosty-upgrade-'));
  try {
    const current = path.join(root, 'Dosty');
    const legacy = path.join(root, 'Masaüstü Karakter');
    assert.equal(resolveUserDataPath(root), current);
    fs.mkdirSync(path.join(legacy, 'characters', 'my-pet'), { recursive: true });
    assert.equal(resolveUserDataPath(root), legacy);
    fs.mkdirSync(current); // Electron may create an empty directory before startup.
    assert.equal(resolveUserDataPath(root), legacy);
    fs.writeFileSync(path.join(current, 'settings.json'), '{"language":"en"}');
    assert.equal(resolveUserDataPath(root), current);
    assert.ok(fs.existsSync(path.join(legacy, 'characters', 'my-pet')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
