'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const zlib = require('node:zlib');
const { CharacterStore } = require('../src/core/character-store');

function makeSolidPng(width, height, [r, g, b, a]) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const tb = Buffer.from(type, 'ascii');
    const lb = Buffer.alloc(4);
    lb.writeUInt32BE(data.length, 0);
    const cb = Buffer.alloc(4);
    cb.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
    return Buffer.concat([lb, tb, data, cb]);
  };

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * stride + 1 + x * 4;
      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
      raw[idx + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('CharacterStore', () => {
  it('loads starter character dynamically, copies 4 PNGs locally, survives source deletion, and persists settings', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-store-test-'));
    const downloadsDir = path.join(tmpRoot, 'Downloads');
    const userDataDir = path.join(tmpRoot, 'UserData');
    fs.mkdirSync(downloadsDir, { recursive: true });

    try {
      const builtInCharactersDir = path.resolve(__dirname, '..', 'resources', 'characters');
      const store = new CharacterStore({ builtInCharactersDir, userDataDir });

      const initialList = store.listCharacters();
      assert.ok(initialList.length >= 1, 'Örnek karakter dinamik olarak yüklenmeli');
      assert.equal(initialList[0].builtIn, true);

      const srcFiles = {
        idle: path.join(downloadsDir, 'bekleme.png'),
        keyboard: path.join(downloadsDir, 'klavye.png'),
        mouse: path.join(downloadsDir, 'fare.png'),
        both: path.join(downloadsDir, 'ikisi.png'),
      };
      fs.writeFileSync(srcFiles.idle, makeSolidPng(32, 32, [255, 0, 0, 200]));
      fs.writeFileSync(srcFiles.keyboard, makeSolidPng(32, 32, [0, 255, 0, 200]));
      fs.writeFileSync(srcFiles.mouse, makeSolidPng(32, 32, [0, 0, 255, 200]));
      fs.writeFileSync(srcFiles.both, makeSolidPng(32, 32, [255, 255, 0, 200]));

      const created = store.saveCharacter({
        name: '',
        poses: {
          idle: { sourcePath: srcFiles.idle },
          keyboard: { sourcePath: srcFiles.keyboard },
          mouse: { sourcePath: srcFiles.mouse },
          both: { sourcePath: srcFiles.both },
        },
        offsets: {
          idle: { x: 0, y: 0 },
          keyboard: { x: 4, y: -2 },
          mouse: { x: 0, y: 0 },
          both: { x: 4, y: -2 },
        },
      });

      assert.ok(created.id);
      assert.equal(created.name, 'Karakter 1');
      assert.equal(created.hasBlink, false);
      assert.equal(created.poses.blink, null);

      for (const f of Object.values(srcFiles)) {
        fs.unlinkSync(f);
      }

      store.saveSettings({
        selectedCharacterId: created.id,
        overlayVisible: true,
        positionMode: 'custom',
        customX: 380,
        customY: 220,
        size: 310,
        touchReaction: false,
      });

      const reopenedStore = new CharacterStore({ builtInCharactersDir, userDataDir });
      const reopenedSettings = reopenedStore.getSettings();
      assert.equal(reopenedSettings.selectedCharacterId, created.id);
      assert.equal(reopenedSettings.overlayVisible, true);
      assert.equal(reopenedSettings.positionMode, 'custom');
      assert.equal(reopenedSettings.customX, 380);
      assert.equal(reopenedSettings.customY, 220);
      assert.equal(reopenedSettings.size, 310);
      assert.equal(reopenedSettings.touchReaction, false);

      const reloadedChar = reopenedStore.getCharacter(created.id);
      for (const poseKey of ['idle', 'keyboard', 'mouse', 'both']) {
        assert.ok(fs.existsSync(reloadedChar.posePaths[poseKey]));
      }
      assert.deepEqual(reloadedChar.offsets.keyboard, { x: 4, y: -2 });
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('supports legacy v0.1 4-PNG characters, retrofitting a 5th blink PNG later, and saving 5-PNG characters directly', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-legacy-test-'));
    const userDataDir = path.join(tmpRoot, 'UserData');
    const legacyDir = path.join(userDataDir, 'characters', 'eski-tilki');
    fs.mkdirSync(legacyDir, { recursive: true });

    try {
      // Simulate an older v0.1 character folder created before blink/customX existed
      for (const k of ['idle', 'keyboard', 'mouse', 'both']) {
        fs.writeFileSync(path.join(legacyDir, `${k}.png`), makeSolidPng(24, 24, [120, 200, 150, 255]));
      }
      fs.writeFileSync(
        path.join(legacyDir, 'character.json'),
        JSON.stringify({
          id: 'eski-tilki',
          name: 'Eski Dörtlü Tilki',
          poses: {
            idle: 'idle.png',
            keyboard: 'keyboard.png',
            mouse: 'mouse.png',
            both: 'both.png',
          },
        })
      );
      fs.writeFileSync(
        path.join(userDataDir, 'settings.json'),
        JSON.stringify({
          selectedCharacterId: 'eski-tilki',
          overlayVisible: true,
          corner: 'top-right',
          size: 260,
        })
      );

      const builtInCharactersDir = path.resolve(__dirname, '..', 'resources', 'characters');
      const store = new CharacterStore({ builtInCharactersDir, userDataDir });

      // Legacy character & settings load cleanly with defaults
      const legacyChar = store.getCharacter('eski-tilki');
      assert.equal(legacyChar.name, 'Eski Dörtlü Tilki');
      assert.equal(legacyChar.hasBlink, false);
      assert.equal(legacyChar.poses.blink, null);

      const legacySettings = store.getSettings();
      assert.equal(legacySettings.positionMode, 'corner');
      assert.equal(legacySettings.corner, 'top-right');
      assert.equal(legacySettings.touchReaction, true);

      // Retrofit 5th blink PNG onto the existing legacy 4-PNG character!
      const blinkSrc = path.join(tmpRoot, 'gozler-kapali.png');
      fs.writeFileSync(blinkSrc, makeSolidPng(24, 24, [80, 120, 255, 255]));
      const upgraded = store.setCharacterBlink('eski-tilki', { sourcePath: blinkSrc });
      fs.unlinkSync(blinkSrc); // delete original source file

      assert.equal(upgraded.hasBlink, true);
      assert.ok(fs.existsSync(upgraded.posePaths.blink));

      // Also save a brand new 5-PNG character directly
      const pngBuf = makeSolidPng(24, 24, [255, 140, 180, 255]);
      const fiveChar = store.saveCharacter({
        name: 'Beşli Kedi',
        poses: {
          idle: pngBuf,
          keyboard: pngBuf,
          mouse: pngBuf,
          both: pngBuf,
          blink: pngBuf,
        },
      });
      assert.equal(fiveChar.hasBlink, true);
      assert.ok(fs.existsSync(fiveChar.posePaths.blink));
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
