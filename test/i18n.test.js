'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { translate, normalizeLanguage } = require('../src/i18n');
const tr = require('../src/i18n/tr');
const en = require('../src/i18n/en');
const { CharacterStore } = require('../src/core/character-store');
const builtInCharactersDir = path.resolve(__dirname, '../resources/characters');

test('both language catalogs cover every UI reference and have matching interpolation parameters', () => {
  assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
  for (const key of Object.keys(tr)) {
    assert.ok(tr[key] && en[key], key);
    const params = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(params(tr[key]), params(en[key]), key);
  }
  for (const rel of ['main/main.js', 'core/character-store.js', 'renderer/control/app.js', 'renderer/control/index.html', 'renderer/overlay/overlay.html']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../src', rel), 'utf8');
    const refs = [...source.matchAll(/\bt\('([^']+)'/g), ...source.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)];
    for (const match of refs) assert.ok(en[match[1]], `${rel}: ${match[1]}`);
  }
  assert.equal(translate('en', 'offset', {x: 3, y: -2}), 'Offset: X 3, Y -2');
  assert.equal(translate('xx', 'idle'), 'Idle');
  assert.equal(translate('en', 'unknown.key'), en.somethingWentWrongPleaseTryAgain);
  assert.equal(normalizeLanguage('tr-TR'), 'tr');
  assert.equal(normalizeLanguage('de-DE'), 'en');
});

test('fresh installs follow system language; old settings stay Turkish; explicit selection persists', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-language-'));
  try {
    for (const [locale, expected] of [['tr-TR', 'tr'], ['en-GB', 'en'], ['de-DE', 'en']]) {
      const userDataDir = path.join(temp, locale);
      const store = new CharacterStore({builtInCharactersDir, userDataDir, systemLocale: locale});
      assert.equal(store.getSettings().language, expected);
      store.saveSettings({language: expected === 'en' ? 'tr' : 'en'});
      const reopened = new CharacterStore({builtInCharactersDir, userDataDir, systemLocale: 'de-DE'});
      assert.equal(reopened.getSettings().language, expected === 'en' ? 'tr' : 'en');
      assert.equal(reopened.saveSettings({language: 'invalid'}).language, expected === 'en' ? 'tr' : 'en');
    }
    const userDataDir = path.join(temp, 'legacy');
    fs.mkdirSync(userDataDir);
    fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({overlayVisible: true}));
    const legacy = new CharacterStore({builtInCharactersDir, userDataDir, systemLocale: 'en-US'});
    assert.equal(legacy.getSettings().language, 'tr');
    assert.equal(legacy.getSettings().overlayVisible, true);
    legacy.saveSettings({language: 'en'});
    assert.throws(() => legacy.saveCharacter({poses: {}}), /Missing pose image: Idle/);
    assert.equal(legacy.getCharacter('mor-kedi').name, 'Mor Kedi');
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});
