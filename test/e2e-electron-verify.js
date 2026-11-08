'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { app } = require('electron');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeRgbaPng(width, height, pixelFn) {
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
      const [r, g, b, a] = pixelFn(x, y);
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

// Creates a 64x64 PNG that is transparent near corners and opaque in a central circle
function makeCircleCharacterPng(rgba) {
  return makeRgbaPng(64, 64, (x, y) => {
    const dist = Math.hypot(x - 32, y - 32);
    return dist <= 20 ? rgba : [0, 0, 0, 0];
  });
}

const phaseArg = process.argv.find((a) => a.startsWith('--phase=')) || '--phase=1';
const phase = phaseArg.split('=')[1];
const userDataArg = process.argv.find((a) => a.startsWith('--user-data='));
const tmpRoot = userDataArg
  ? userDataArg.slice('--user-data='.length)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'mk-e2e-'));

process.env.DOSTY_TEST = '1';
process.env.DOSTY_USER_DATA = tmpRoot;

const mainModule = require('../src/main/main.js');

async function waitForWindowsReady(ctx) {
  for (let i = 0; i < 60; i++) {
    const cw = ctx.getControlWindow();
    const ow = ctx.getOverlayWindow();
    if (cw && ow && !cw.webContents.isLoading() && !ow.webContents.isLoading()) {
      await sleep(120);
      return { cw, ow };
    }
    await sleep(100);
  }
  throw new Error('Electron pencereleri zamanında yüklenemedi.');
}

async function waitForCondition(fn, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await fn();
    if (val) return val;
    await sleep(30);
  }
  throw new Error('Koşul zaman aşımına uğradı.');
}

async function runPhase1() {
  const ctx = mainModule.getTestContext();
  const { cw, ow } = await waitForWindowsReady(ctx);
  ctx.inputMonitor.stop();
  await cw.webContents.executeJavaScript(`window.desktopApi.updateSettings({language: 'tr'})`);

  console.log('[E2E] 1. Arayüz yapısı (4 zorunlu + 1 isteğe bağlı göz kırpma alanı) doğrulanıyor...');
  const domAudit = await cw.webContents.executeJavaScript(`(() => {
    const bodyText = document.body.innerText;
    return {
      hasAddBtn: Boolean(document.getElementById('btn-open-add')),
      hasShowBtn: Boolean(document.getElementById('btn-toggle-overlay')),
      hasPromptText: bodyText.includes('Çizim promptunu kopyala') || bodyText.includes('karakterini tarif'),
      slotCount: document.querySelectorAll('.pose-slot').length,
      hasOptionalBlinkSlot: Boolean(document.querySelector('.pose-slot[data-pose="blink"]')),
    };
  })()`);

  assert.equal(domAudit.hasAddBtn, true);
  assert.equal(domAudit.hasShowBtn, true);
  assert.equal(domAudit.hasPromptText, false);
  assert.equal(domAudit.slotCount, 5, '4 zorunlu + 1 isteğe bağlı toplam 5 poz alanı olmalı');
  assert.equal(domAudit.hasOptionalBlinkSlot, true);

  console.log('[E2E] 1b. Varsayılan "Mor Kedi" karakteri ve hızlı poz geçişlerinde sıfır titreme kontrolü...');
  const initialDefaultChar = ctx.buildAppState().activeCharacter;
  assert.equal(initialDefaultChar.id, 'mor-kedi');
  assert.equal(initialDefaultChar.name, 'Mor Kedi');
  assert.equal(initialDefaultChar.hasBlink, true);

  await waitForCondition(async () => {
    const st = await ow.webContents.executeJavaScript(`window.__overlayStatus()`);
    return st.characterId === 'mor-kedi' && st.loadedPoses.length === 5;
  });

  // Warm up getImageData so Chromium settles on a single canvas backing store before snapshotting idle
  await ow.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('character-canvas');
    const g = c.getContext('2d');
    g.getImageData(0, 0, 4, 4);
    g.getImageData(0, 0, 4, 4);
    g.getImageData(0, 0, 4, 4);
  })()`);
  ow.webContents.send('overlay:pose-changed', { pose: 'keyboard', hands: {} });
  await sleep(30);
  ow.webContents.send('overlay:pose-changed', { pose: 'idle', hands: {} });
  await sleep(30);

  // Snapshot head & keyboard frame on live canvas in idle, then rapidly cycle keyboard -> mouse -> both -> blink -> idle
  await ow.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('character-canvas');
    const g = c.getContext('2d');
    window.__idleCanvasData = Array.from(g.getImageData(0, 0, c.width, c.height).data);
  })()`);

  for (const testPose of ['keyboard', 'mouse', 'both', 'blink', 'idle']) {
    ow.webContents.send('overlay:pose-changed', { pose: testPose, hands: {} });
    await waitForCondition(async () => {
      const st = await ow.webContents.executeJavaScript(`window.__overlayStatus()`);
      return st.currentPose === testPose;
    });
    const jitterCheck = await ow.webContents.executeJavaScript(`(() => {
      const c = document.getElementById('character-canvas');
      const g = c.getContext('2d');
      const cur = g.getImageData(0, 0, c.width, c.height).data;
      const ref = window.__idleCanvasData;
      const w = c.width, h = c.height;
      let headDiffs = 0, kbFrameDiffs = 0;
      // Upper head/ears/whiskers outside eye band
      for (let y = Math.floor(h * 0.10); y < Math.floor(h * 0.56); y++) {
        for (let x = Math.floor(w * 0.12); x < Math.floor(w * 0.88); x++) {
          if (${JSON.stringify(testPose)} === 'blink' && y >= Math.floor(h * 0.25) && y <= Math.floor(h * 0.52) && x >= Math.floor(w * 0.20) && x <= Math.floor(w * 0.80)) continue;
          const idx = (y * w + x) * 4;
          if (cur[idx] !== ref[idx] || cur[idx+1] !== ref[idx+1] || cur[idx+2] !== ref[idx+2] || cur[idx+3] !== ref[idx+3]) {
            headDiffs++;
          }
        }
      }
      // Keyboard bottom frame
      for (let y = Math.floor(h * 0.86); y < Math.floor(h * 0.94); y++) {
        for (let x = Math.floor(w * 0.12); x < Math.floor(w * 0.58); x++) {
          const idx = (y * w + x) * 4;
          if (cur[idx] !== ref[idx] || cur[idx+1] !== ref[idx+1] || cur[idx+2] !== ref[idx+2] || cur[idx+3] !== ref[idx+3]) {
            kbFrameDiffs++;
          }
        }
      }
      return { headDiffs, kbFrameDiffs };
    })()`);
    assert.equal(jitterCheck.headDiffs, 0, `${testPose} geçişinde baş/gövde titrememeli`);
    assert.equal(jitterCheck.kbFrameDiffs, 0, `${testPose} geçişinde klavye çerçevesi titrememeli`);
  }

  console.log('[E2E] 2. Dört PNG’li (göz kırpmasız) karakter yükleme ve uyumluluk testi...');
  await cw.webContents.executeJavaScript(`window.__controlTestHooks.openAddModal()`);
  assert.equal(
    await cw.webContents.executeJavaScript(`window.__controlTestHooks.isSaveButtonDisabled()`),
    true
  );

  const toCircleUrl = (rgba) =>
    `data:image/png;base64,${makeCircleCharacterPng(rgba).toString('base64')}`;

  const dropPoseInDom = async (poseKey, dataUrlPng, fileName) => {
    const rawB64 = dataUrlPng.replace(/^data:image\/png;base64,/, '');
    await cw.webContents.executeJavaScript(`(async () => {
      const bin = atob(${JSON.stringify(rawB64)});
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], ${JSON.stringify(fileName)}, { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const slot = document.querySelector('.pose-slot[data-pose="${poseKey}"]');
      slot.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    })()`);
  };

  await dropPoseInDom('idle', toCircleUrl([90, 220, 180, 255]), 'bekleme.png');
  await dropPoseInDom('keyboard', toCircleUrl([80, 190, 255, 255]), 'klavye.png');
  await dropPoseInDom('mouse', toCircleUrl([255, 190, 80, 255]), 'fare.png');
  await sleep(80);
  assert.equal(
    await cw.webContents.executeJavaScript(`window.__controlTestHooks.isSaveButtonDisabled()`),
    true,
    '3/4 temel görselde düğme devre dışı kalmalı'
  );

  await dropPoseInDom('both', toCircleUrl([200, 120, 255, 255]), 'ikisi.png');
  await waitForCondition(() =>
    cw.webContents.executeJavaScript(`!window.__controlTestHooks.isSaveButtonDisabled()`)
  );
  assert.equal(
    await cw.webContents.executeJavaScript(`window.__controlTestHooks.getProgressText()`),
    '4 / 4 temel görsel hazır',
    'Beşinci resim olmadan 4 temel resimle düğme etkinleşmeli'
  );

  await cw.webContents.executeJavaScript(`window.__controlTestHooks.setDraftName('Dortlu Karakter')`);
  await cw.webContents.executeJavaScript(`window.__controlTestHooks.clickSaveAndShow()`);
  await waitForCondition(() =>
    cw.webContents.executeJavaScript(`!window.__controlTestHooks.isAddModalOpen()`)
  );

  // Verify 4-PNG character on desktop overlay (no blink loaded)
  const fourPngStatus = await waitForCondition(async () => {
    const st = await ow.webContents.executeJavaScript(`window.__overlayStatus()`);
    return st.loadedPoses.length === 4 ? st : false;
  });
  assert.deepEqual(fourPngStatus.loadedPoses, ['idle', 'keyboard', 'mouse', 'both']);
  assert.equal(ctx.animController.hasBlinkPose, false);
  const fourPngCharId = fourPngStatus.characterId;

  console.log('[E2E] 3. Tam ekran görünürlük pencere bayrakları (visibleOnAllWorkspaces, panel, click-through) kontrolü...');
  assert.equal(ow.isVisible(), true);
  assert.equal(ow.isAlwaysOnTop(), true);
  assert.equal(ow.isFocusable(), false);
  if (process.platform === 'darwin') assert.equal(ow.isVisibleOnAllWorkspaces(), true);
  assert.equal(ctx.isOverlayClickThroughEnabled(), true);

  console.log('[E2E] 4. Mevcut 4 PNG’li karaktere sonradan 5. göz kırpma PNG’si ekleme ve göz kırparken tuş önceliği testi...');
  const blinkDataUrl = toCircleUrl([255, 230, 120, 255]);
  await cw.webContents.executeJavaScript(
    `window.__controlTestHooks.addBlinkToExistingCharacter(${JSON.stringify(fourPngCharId)}, ${JSON.stringify(blinkDataUrl)})`
  );

  await waitForCondition(async () => {
    const st = await ow.webContents.executeJavaScript(`window.__overlayStatus()`);
    return st.loadedPoses.includes('blink');
  });
  assert.equal(ctx.animController.hasBlinkPose, true);

  // Speed up blink interval in test to observe live blink -> immediate key interrupt on overlay!
  ctx.animController.blinkIntervalMinMs = 45;
  ctx.animController.blinkIntervalMaxMs = 55;
  ctx.animController.blinkDurationMinMs = 140;
  ctx.animController.blinkDurationMaxMs = 150;
  ctx.animController._scheduleNextBlinkIfIdle();

  await waitForCondition(async () => {
    const st = await ow.webContents.executeJavaScript(`window.__overlayStatus()`);
    return st.currentPose === 'blink';
  });

  // Press key right in the middle of blinking -> must immediately switch overlay to 'keyboard'!
  ctx.animController.handlePhysicalKeyDown('KeyM', false);
  await waitForCondition(async () => {
    const st = await ow.webContents.executeJavaScript(`window.__overlayStatus()`);
    return st.currentPose === 'keyboard';
  }, 500);
  await sleep(110);
  ctx.animController.handlePhysicalKeyUp('KeyM');

  // Restore standard 3-7s blink interval
  ctx.animController.blinkIntervalMinMs = 3000;
  ctx.animController.blinkIntervalMaxMs = 7000;
  ctx.animController._scheduleNextBlinkIfIdle();

  console.log('[E2E] 5. Dokunma tepkisi: şeffaf alan vs görünür karakter pikseli ve zıplarken poz değişimi testi...');
  const overlayBounds = ow.getBounds();
  // Transparent corner (4, 4) -> must NOT bounce
  ctx.triggerTouchCheckAtScreenPoint({
    x: overlayBounds.x + 4,
    y: overlayBounds.y + 4,
  });
  await sleep(60);
  assert.equal(
    (await ow.webContents.executeJavaScript(`window.__overlayStatus()`)).bounceCount,
    0,
    'Şeffaf boşluğa tıklamak zıplamayı tetiklememeli'
  );

  // Visible character center -> MUST bounce while keeping click-through active!
  ctx.triggerTouchCheckAtScreenPoint({
    x: overlayBounds.x + Math.floor(overlayBounds.width / 2),
    y: overlayBounds.y + Math.floor(overlayBounds.height / 2),
  });
  const midBounce = await waitForCondition(async () => {
    const st = await ow.webContents.executeJavaScript(`window.__overlayStatus()`);
    return st.bounceCount === 1 && st.bounceOffsetY < 0 ? st : false;
  });
  assert.ok(midBounce.bounceOffsetY < 0, 'Görünür piksele tıklayınca yukarı zıplamalı');
  assert.equal(ctx.isOverlayClickThroughEnabled(), true, 'Tıklama alttaki uygulamaya geçmeye devam etmeli');

  // Trigger keyboard + mouse poses DURING bounce!
  ctx.animController.handlePhysicalKeyDown('KeyB', false);
  ctx.animController.handleMouseButtonDown(0);
  await waitForCondition(async () => {
    const st = await ow.webContents.executeJavaScript(`window.__overlayStatus()`);
    return st.currentPose === 'both';
  });
  ctx.animController.handlePhysicalKeyUp('KeyB');

  // Wait for bounce to land back at 0
  await waitForCondition(async () => {
    const st = await ow.webContents.executeJavaScript(`window.__overlayStatus()`);
    return st.bounceOffsetY === 0 && st.currentPose === 'idle';
  });

  console.log('[E2E] 6. 2×2 PNG + ayrı 5. göz kırpma resmi yükleme testi...');
  const sheetPng = makeRgbaPng(128, 128, (x, y) => {
    const cx = (x % 64) - 32;
    const cy = (y % 64) - 32;
    if (Math.hypot(cx, cy) > 22) return [0, 0, 0, 0];
    if (x < 64 && y < 64) return [100, 240, 160, 255];
    if (x >= 64 && y < 64) return [100, 160, 255, 255];
    if (x < 64 && y >= 64) return [255, 160, 100, 255];
    return [240, 100, 240, 255];
  });
  const sheetDataUrl = `data:image/png;base64,${sheetPng.toString('base64')}`;

  await cw.webContents.executeJavaScript(`window.__controlTestHooks.openAddModal()`);
  await cw.webContents.executeJavaScript(`window.__controlTestHooks.setDraftName('Besli 2x2 Karakter')`);
  await cw.webContents.executeJavaScript(
    `window.__controlTestHooks.load2x2DataUrl(${JSON.stringify(sheetDataUrl)})`
  );
  await dropPoseInDom('blink', blinkDataUrl, 'goz-kapali.png');
  await waitForCondition(async () => {
    const txt = await cw.webContents.executeJavaScript(`window.__controlTestHooks.getProgressText()`);
    return txt === '4 / 4 temel görsel + göz kırpma hazır';
  });
  await cw.webContents.executeJavaScript(`window.__controlTestHooks.clickSaveAndShow()`);
  await waitForCondition(() =>
    cw.webContents.executeJavaScript(`!window.__controlTestHooks.isAddModalOpen()`)
  );

  const fivePngCharId = ctx.buildAppState().activeCharacter.id;
  await waitForCondition(async () => {
    const st = await ow.webContents.executeJavaScript(`window.__overlayStatus()`);
    return st.characterId === fivePngCharId && st.loadedPoses.length === 5;
  });

  console.log('[E2E] 7. "Karakteri taşı" serbest sürükleme, taşıma sırasında zıplama engeli ve otomatik çıkış testi...');
  ctx.setMoveMode(true);
  assert.equal(ctx.isMoveModeActive(), true);
  assert.equal(ctx.isOverlayClickThroughEnabled(), false);

  await waitForCondition(async () => {
    const st = await ow.webContents.executeJavaScript(`window.__overlayStatus()`);
    return st.moveMode === true;
  });

  const beforeMoveBounceCount = (
    await ow.webContents.executeJavaScript(`window.__overlayStatus()`)
  ).bounceCount;

  // Clicking during move mode must NOT trigger touch bounce!
  const currentB = ow.getBounds();
  ctx.triggerTouchCheckAtScreenPoint({
    x: currentB.x + Math.floor(currentB.width / 2),
    y: currentB.y + Math.floor(currentB.height / 2),
  });
  await ow.webContents.executeJavaScript(`window.__overlayTestCheckTouch(120, 120)`);
  await sleep(50);
  assert.equal(
    (await ow.webContents.executeJavaScript(`window.__overlayStatus()`)).bounceCount,
    beforeMoveBounceCount,
    'Taşıma sırasında dokunma tepkisi tetiklenmemeli'
  );

  // Drag and drop to custom screen position
  ctx.startOverlayDrag();
  ctx.finishOverlayDrag({ commit: true, x: 268, y: 194 });

  assert.equal(ctx.isMoveModeActive(), false, 'Bırakınca taşıma modundan otomatik çıkmalı');
  assert.equal(ctx.isOverlayClickThroughEnabled(), true, 'Bırakınca click-through geri açılmalı');

  // No move mode: visible-pixel confirmation + global gesture state moves the overlay.
  console.log('[E2E] Direct drag without opening controls or entering move mode...');
  const directBounds = ow.getBounds();
  const pressPoint = {x: directBounds.x + directBounds.width/2, y: directBounds.y + directBounds.height/2};
  const gestureId = ctx.directDrag.press(pressPoint, directBounds);
  ow.webContents.send('overlay:check-drag', {id: gestureId, localX: directBounds.width/2, localY: directBounds.height/2});
  await waitForCondition(() => ctx.directDrag.session?.hit === true);
  ctx.directDrag.move({x: pressPoint.x + 45, y: pressPoint.y + 30});
  ctx.directDrag.release();
  assert.equal(ow.getBounds().x, directBounds.x + 45);
  assert.equal(ow.getBounds().y, directBounds.y + 30);
  assert.equal(ctx.isMoveModeActive(), false);
  assert.equal(ctx.isOverlayClickThroughEnabled(), true);
  const afterDragBounds = ow.getBounds();
  const savedSettings = ctx.buildAppState().settings;
  assert.equal(savedSettings.positionMode, 'custom');
  assert.equal(savedSettings.customX, afterDragBounds.x);
  assert.equal(savedSettings.customY, afterDragBounds.y);

  console.log('[E2E] Language switch, native menus, draft retention and English layout...');
  await cw.webContents.executeJavaScript(`window.__controlTestHooks.openAddModal()`);
  await cw.webContents.executeJavaScript(`window.__controlTestHooks.setDraftName('My unchanged character name')`);
  const switchLanguage = async (value) => {
    await cw.webContents.executeJavaScript(`(() => {
      const select = document.getElementById('language-select'); select.value = ${JSON.stringify(value)};
      select.dispatchEvent(new Event('change', {bubbles: true}));
    })()`);
    await waitForCondition(() => cw.webContents.executeJavaScript(`document.documentElement.lang === ${JSON.stringify(value)}`));
  };
  await switchLanguage('en');
  assert.equal(ctx.store.getSettings().language, 'en');
  const { Menu } = require('electron');
  assert.ok(Menu.getApplicationMenu().items.some(item => item.label === 'Edit'));
  const auditEnglish = async () => cw.webContents.executeJavaScript(`(() => ({
    title: document.title,
    add: document.getElementById('btn-open-add').textContent.trim(),
    draftName: document.getElementById('character-name-input').value,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    buttons: [...document.querySelectorAll('button')].filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 2).map(el => el.id),
    progress: document.getElementById('slots-progress').textContent,
  }))()`);
  let audit = await auditEnglish();
  assert.equal(audit.title, 'Dosty');
  assert.equal(audit.add, '+ Add character');
  assert.equal(audit.draftName, 'My unchanged character name');
  assert.equal(audit.progress, '0 / 4 required images ready');
  for (const [width, height] of [[980, 740], [780, 600]]) {
    cw.setSize(width, height); await sleep(120); audit = await auditEnglish();
    assert.equal(audit.overflow, false, JSON.stringify(audit));
    assert.deepEqual(audit.buttons, [], JSON.stringify(audit));
  }
  await switchLanguage('tr');
  assert.equal((await auditEnglish()).add, '+ Karakter ekle');
  await switchLanguage('en');
  await cw.webContents.executeJavaScript(`document.getElementById('btn-cancel-dialog').click()`);
  cw.setSize(980, 740);
  const screenshotDir = process.env.DOSTY_SCREENSHOTS;
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, {recursive: true});
    await cw.webContents.executeJavaScript(`window.desktopApi.selectCharacter('mor-kedi')`);
    await sleep(180);
    fs.writeFileSync(path.join(screenshotDir, 'english.png'), (await cw.webContents.capturePage()).toPNG());
    await switchLanguage('tr'); await sleep(100);
    fs.writeFileSync(path.join(screenshotDir, 'turkish.png'), (await cw.webContents.capturePage()).toPNG());
    await switchLanguage('en');
    await cw.webContents.executeJavaScript(`window.desktopApi.selectCharacter(${JSON.stringify(fivePngCharId)})`);
  }

  console.log('[E2E] 8. Uygulama yeniden açılarak (Faz 2) serbest konum ve 5 PNG karakter kalıcılığı doğrulanıyor...');
  fs.writeFileSync(
    path.join(tmpRoot, 'expected.json'),
    JSON.stringify({
      charId: fivePngCharId,
      x: afterDragBounds.x,
      y: afterDragBounds.y,
    }),
    'utf8'
  );

  ctx.inputMonitor.stop();

  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const phase2 = spawnSync(
    process.execPath,
    [__filename, '--phase=2', `--user-data=${tmpRoot}`],
    { stdio: 'inherit', env: childEnv }
  );
  assert.equal(phase2.status, 0, 'Faz 2 yeniden açılış doğrulaması başarılı olmalı');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log('[E2E] TÜM UÇTAN UCA TESTLER BAŞARIYLA GEÇTİ!');
  app.exit(0);
}

async function runPhase2() {
  const ctx = mainModule.getTestContext();
  const { ow } = await waitForWindowsReady(ctx);

  const expected = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'expected.json'), 'utf8'));
  const state = ctx.buildAppState();
  const reopenedBounds = ow.getBounds();

  assert.equal(state.settings.language, 'en');
  assert.equal(await ctx.getControlWindow().webContents.executeJavaScript(`document.documentElement.lang`), 'en');
  assert.equal(state.settings.selectedCharacterId, expected.charId);
  assert.equal(state.settings.positionMode, 'custom');
  assert.equal(reopenedBounds.x, expected.x, 'Yeniden açılışta karakter bırakılan X konumunda görünmeli');
  assert.equal(reopenedBounds.y, expected.y, 'Yeniden açılışta karakter bırakılan Y konumunda görünmeli');
  assert.equal(ow.isVisible(), true);
  assert.equal(state.activeCharacter.hasBlink, true);

  await waitForCondition(async () => {
    const st = await ow.webContents.executeJavaScript(`window.__overlayStatus()`);
    return st.loadedPoses.length === 5;
  });

  ctx.inputMonitor.stop();
  console.log('[E2E Faz 2] Serbest sürükleme konumu ve 5 PNG göz kırpma kalıcılığı doğrulandı.');
  app.exit(0);
}

app.whenReady().then(async () => {
  await sleep(150);
  try {
    if (phase === '2') {
      await runPhase2();
    } else {
      await runPhase1();
    }
  } catch (err) {
    console.error('[E2E HATA]', err);
    app.exit(1);
  }
});
