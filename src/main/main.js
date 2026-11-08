'use strict';

const fs = require('node:fs');
const { translate } = require('../i18n');
let activeLanguage = 'tr';
const t = (key, params) => translate(activeLanguage, key, params);
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  screen,
  shell,
} = require('electron');

const { AnimationController } = require('../core/animation-controller');
const { CharacterStore } = require('../core/character-store');
const { InputMonitor } = require('./input-monitor');
const { DirectDrag } = require('../core/direct-drag');
const { resolveUserDataPath } = require('../core/user-data-path');

app.setName('Dosty');
const isTestMode = process.env.DOSTY_TEST === '1' || process.env.MASAUSTU_KARAKTER_TEST === '1';
app.setPath('userData', process.env.DOSTY_USER_DATA || process.env.MASAUSTU_KARAKTER_USER_DATA ||
  resolveUserDataPath(app.getPath('appData')));

function getResourcesRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.resolve(__dirname, '..', '..', 'resources');
}

function clampToDisplayArea(x, y, size, displayArea) {
  const minVisible = Math.min(64, size);
  const minX = displayArea.x - size + minVisible;
  const maxX = displayArea.x + displayArea.width - minVisible;
  const minY = displayArea.y;
  const maxY = displayArea.y + displayArea.height - minVisible;
  return {
    x: Math.round(Math.max(minX, Math.min(maxX, x))),
    y: Math.round(Math.max(minY, Math.min(maxY, y))),
  };
}

function computeOverlayBounds(settings) {
  const primary = screen.getPrimaryDisplay();
  const workArea = primary.workArea;
  const clampedSize = Math.min(
    Math.max(120, Math.round(settings.size || 240)),
    Math.min(workArea.width, workArea.height)
  );

  if (
    settings.positionMode === 'custom' &&
    settings.customX !== null &&
    settings.customY !== null &&
    Number.isFinite(settings.customX) &&
    Number.isFinite(settings.customY)
  ) {
    const targetDisplay = screen.getDisplayMatching({
      x: settings.customX,
      y: settings.customY,
      width: clampedSize,
      height: clampedSize,
    });
    const clamped = clampToDisplayArea(
      settings.customX,
      settings.customY,
      clampedSize,
      targetDisplay.workArea
    );
    return {
      x: clamped.x,
      y: clamped.y,
      width: clampedSize,
      height: clampedSize,
    };
  }

  const margin = 16;
  let x = workArea.x + workArea.width - clampedSize - margin;
  let y = workArea.y + workArea.height - clampedSize - margin;

  if (settings.corner === 'bottom-left') {
    x = workArea.x + margin;
    y = workArea.y + workArea.height - clampedSize - margin;
  } else if (settings.corner === 'top-right') {
    x = workArea.x + workArea.width - clampedSize - margin;
    y = workArea.y + margin;
  } else if (settings.corner === 'top-left') {
    x = workArea.x + margin;
    y = workArea.y + margin;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: clampedSize,
    height: clampedSize,
  };
}

let store = null;
let animController = null;
let inputMonitor = null;
let controlWindow = null;
let overlayWindow = null;
let tray = null;
let isQuitting = false;
let overlayClickThroughEnabled = false;
let isMoveMode = false;
let dragInterval = null;
let dragSession = null;
let suppressTouchUntil = 0;
let directDragTimer = null;
const directDrag = new DirectDrag({
  onMove: (bounds) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const display = screen.getDisplayMatching(bounds);
    const point = clampToDisplayArea(bounds.x, bounds.y, bounds.width, display.workArea);
    overlayWindow.setBounds({...bounds, ...point}, false);
    suppressTouchUntil = Date.now() + 250;
  },
  onEnd: () => {
    if (!store || !overlayWindow || overlayWindow.isDestroyed()) return;
    const {x, y} = overlayWindow.getBounds();
    store.saveSettings({positionMode: 'custom', customX: x, customY: y});
    broadcastState();
  },
});

function stopDirectDrag(commit = false) {
  if (directDragTimer !== null) clearInterval(directDragTimer);
  directDragTimer = null;
  if (commit) directDrag.release(); else directDrag.cancel();
}

function onGlobalLeftButton(down) {
  if (!down) {
    // Include the final cursor position even if release precedes the next 16 ms tick.
    if (directDrag.session) directDrag.move(screen.getCursorScreenPoint());
    stopDirectDrag(true);
    return;
  }
  stopDirectDrag();
  if (isMoveMode || !overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return;
  const point = screen.getCursorScreenPoint();
  const bounds = overlayWindow.getBounds();
  if (point.x < bounds.x || point.x >= bounds.x + bounds.width ||
      point.y < bounds.y || point.y >= bounds.y + bounds.height) return;
  const id = directDrag.press(point, bounds);
  overlayWindow.webContents.send('overlay:check-drag', {id, localX: point.x - bounds.x, localY: point.y - bounds.y});
  directDragTimer = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible() || isMoveMode) { stopDirectDrag(); return; }
    directDrag.move(screen.getCursorScreenPoint());
  }, 16);
}

function syncBlinkForActiveCharacter() {
  if (!store || !animController) return;
  const settings = store.getSettings();
  const activeCharacter = store.getCharacter(settings.selectedCharacterId);
  animController.setBlinkEnabled(Boolean(activeCharacter?.poses?.blink));
}

function buildAppState() {
  const characters = store.listCharacters();
  const settings = store.getSettings();
  const activeCharacter = store.getCharacter(settings.selectedCharacterId);
  return {
    platform: process.platform,
    characters,
    settings,
    activeCharacter,
    moveMode: isMoveMode,
    currentPose: animController ? animController.getPose() : 'idle',
    permission: {
      required: process.platform === 'darwin',
      granted: inputMonitor ? inputMonitor.permissionGranted : process.platform !== 'darwin',
    },
  };
}

function broadcastState() {
  activeLanguage = store.getSettings().language;
  rebuildApplicationMenu();
  if (controlWindow && !controlWindow.isDestroyed()) controlWindow.setTitle(t('desktopCharacter'));
  if (tray) tray.setToolTip(t('desktopCharacter'));
  syncBlinkForActiveCharacter();
  const state = buildAppState();
  for (const win of [controlWindow, overlayWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:state-changed', state);
    }
  }
  rebuildTrayMenu(state);
}

function broadcastPose(pose, hands) {
  const payload = { pose, hands };
  for (const win of [overlayWindow, controlWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('overlay:pose-changed', payload);
    }
  }
}

/**
 * Applies macOS Full-Screen Space auxiliary panel traits in the strict order required by Electron:
 * setAlwaysOnTop MUST run BEFORE setVisibleOnAllWorkspaces(..., { visibleOnFullScreen: true }),
 * otherwise Electron's SetAlwaysOnTop resets NSWindow.collectionBehavior on macOS.
 */
function applyOverlayWindowTraits() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  if (process.platform === 'darwin') {
    overlayWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  } else {
    overlayWindow.setVisibleOnAllWorkspaces(true);
  }
}

function syncOverlayMousePassthrough() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (isMoveMode) {
    overlayWindow.setIgnoreMouseEvents(false);
    overlayClickThroughEnabled = false;
  } else {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    overlayClickThroughEnabled = true;
  }
}

function syncOverlayWindow({ preserveCurrentBounds = false } = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const settings = store.getSettings();

  if (!preserveCurrentBounds) {
    const bounds = computeOverlayBounds(settings);
    overlayWindow.setBounds(bounds, false);
  }

  syncOverlayMousePassthrough();
  applyOverlayWindowTraits();

  if (settings.overlayVisible) {
    if (!overlayWindow.isVisible()) {
      overlayWindow.showInactive();
      applyOverlayWindowTraits();
    }
  } else if (overlayWindow.isVisible()) {
    overlayWindow.hide();
  }
}

function stopDragTracking() {
  if (dragInterval !== null) {
    clearInterval(dragInterval);
    dragInterval = null;
  }
  dragSession = null;
}

function setMoveMode(enabled) {
  stopDirectDrag();
  const next = Boolean(enabled);
  stopDragTracking();

  if (next) {
    const settings = store.getSettings();
    if (!settings.overlayVisible) {
      store.saveSettings({ overlayVisible: true });
    }
    isMoveMode = true;
    syncOverlayWindow();
  } else {
    isMoveMode = false;
    suppressTouchUntil = Date.now() + 250;
    syncOverlayWindow();
  }

  broadcastState();
}

function startOverlayDrag() {
  if (!isMoveMode || !overlayWindow || overlayWindow.isDestroyed()) {
    return false;
  }
  stopDragTracking();

  const startCursor = screen.getCursorScreenPoint();
  const startBounds = overlayWindow.getBounds();
  dragSession = { startCursor, startBounds };

  dragInterval = setInterval(() => {
    if (!isMoveMode || !dragSession || !overlayWindow || overlayWindow.isDestroyed()) {
      stopDragTracking();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const rawX = dragSession.startBounds.x + (cursor.x - dragSession.startCursor.x);
    const rawY = dragSession.startBounds.y + (cursor.y - dragSession.startCursor.y);
    const display = screen.getDisplayMatching({
      x: rawX,
      y: rawY,
      width: dragSession.startBounds.width,
      height: dragSession.startBounds.height,
    });
    const clamped = clampToDisplayArea(
      rawX,
      rawY,
      dragSession.startBounds.width,
      display.workArea
    );
    overlayWindow.setBounds(
      {
        x: clamped.x,
        y: clamped.y,
        width: dragSession.startBounds.width,
        height: dragSession.startBounds.height,
      },
      false
    );
  }, 16);

  return true;
}

function finishOverlayDrag({ commit = true, x, y } = {}) {
  const previousSession = dragSession;
  stopDragTracking();

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    isMoveMode = false;
    return buildAppState();
  }

  if (commit) {
    const currentBounds = overlayWindow.getBounds();
    const targetX = Number.isFinite(x) ? Math.round(x) : currentBounds.x;
    const targetY = Number.isFinite(y) ? Math.round(y) : currentBounds.y;
    const display = screen.getDisplayMatching({
      x: targetX,
      y: targetY,
      width: currentBounds.width,
      height: currentBounds.height,
    });
    const clamped = clampToDisplayArea(targetX, targetY, currentBounds.width, display.workArea);
    store.saveSettings({
      positionMode: 'custom',
      customX: clamped.x,
      customY: clamped.y,
    });
  } else if (previousSession?.startBounds) {
    overlayWindow.setBounds(previousSession.startBounds, false);
  }

  isMoveMode = false;
  suppressTouchUntil = Date.now() + 250;
  syncOverlayWindow();
  broadcastState();
  return buildAppState();
}

function triggerTouchCheckAtScreenPoint(point) {
  if (!store || !overlayWindow || overlayWindow.isDestroyed()) return false;
  const settings = store.getSettings();
  if (
    !settings.touchReaction ||
    !settings.overlayVisible ||
    isMoveMode ||
    Date.now() < suppressTouchUntil ||
    !overlayWindow.isVisible()
  ) {
    return false;
  }

  const bounds = overlayWindow.getBounds();
  if (
    point.x < bounds.x ||
    point.x >= bounds.x + bounds.width ||
    point.y < bounds.y ||
    point.y >= bounds.y + bounds.height
  ) {
    return false;
  }

  overlayWindow.webContents.send('overlay:check-touch', {
    localX: point.x - bounds.x,
    localY: point.y - bounds.y,
  });
  return true;
}

function createOverlayWindow() {
  const settings = store.getSettings();
  const bounds = computeOverlayBounds(settings);

  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  syncOverlayMousePassthrough();
  applyOverlayWindowTraits();

  overlayWindow.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'overlay.html'));

  overlayWindow.webContents.on('did-finish-load', () => {
    syncOverlayWindow();
    overlayWindow.webContents.send('app:state-changed', buildAppState());
  });
}

function showControlWindow(openAddModal = false) {
  if (!controlWindow || controlWindow.isDestroyed()) {
    createControlWindow();
  }
  if (controlWindow.isMinimized()) {
    controlWindow.restore();
  }
  if (process.platform === 'darwin' && !isTestMode) {
    app.focus({ steal: true });
  }
  controlWindow.show();
  controlWindow.focus();
  if (openAddModal) {
    if (controlWindow.webContents.isLoading()) {
      controlWindow.webContents.once('did-finish-load', () => {
        controlWindow.webContents.send('ui:open-add-character');
      });
    } else {
      controlWindow.webContents.send('ui:open-add-character');
    }
  }
}

function createControlWindow() {
  const iconPath = path.join(getResourcesRoot(), 'icons', 'app-icon.png');
  controlWindow = new BrowserWindow({
    width: 980,
    height: 740,
    minWidth: 780,
    minHeight: 600,
    title: t('desktopCharacter'),
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#0f1320',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  controlWindow.setMenuBarVisibility(false);
  controlWindow.loadFile(path.join(__dirname, '..', 'renderer', 'control', 'index.html'));

  controlWindow.once('ready-to-show', () => {
    if (!isTestMode) {
      if (process.platform === 'darwin') {
        app.focus({ steal: true });
      }
      controlWindow.show();
      controlWindow.focus();
    }
  });

  controlWindow.on('close', (event) => {
    if (!isQuitting && store.getSettings().overlayVisible) {
      event.preventDefault();
      controlWindow.hide();
    }
  });
}

function rebuildApplicationMenu() {
  const items = [];
  if (process.platform === 'darwin') items.push({label: t('desktopCharacter'), submenu: [
    {label: t('openControlWindow'), click: () => showControlWindow()},
    {type: 'separator'}, {label: t('quit'), role: 'quit'},
  ]});
  items.push({label: t('edit'), submenu: [
    {label: t('undo'), role: 'undo'}, {label: t('redo'), role: 'redo'},
    {type: 'separator'}, {label: t('cut'), role: 'cut'}, {label: t('copy'), role: 'copy'},
    {label: t('paste'), role: 'paste'}, {label: t('selectAll'), role: 'selectAll'},
  ]}, {label: t('window'), submenu: [
    {label: t('openControlWindow'), click: () => showControlWindow()},
    {label: t('minimize'), role: 'minimize'}, {label: t('closeWindow'), role: 'close'},
  ]});
  Menu.setApplicationMenu(Menu.buildFromTemplate(items));
}

function createSystemTray() {
  const iconsDir = path.join(getResourcesRoot(), 'icons');
  let trayImg;

  if (process.platform === 'darwin') {
    const templatePath = path.join(iconsDir, 'trayTemplate.png');
    trayImg = nativeImage.createFromPath(templatePath);
    trayImg.setTemplateImage(true);
  } else {
    const colorPath = path.join(iconsDir, 'tray-color.png');
    trayImg = nativeImage.createFromPath(colorPath);
  }

  tray = new Tray(trayImg);
  tray.setToolTip(t('desktopCharacter'));

  if (process.platform !== 'darwin') {
    tray.on('click', () => {
      showControlWindow(false);
    });
  }

  rebuildTrayMenu(buildAppState());
}

function rebuildTrayMenu(state) {
  if (!tray) return;
  const { characters, settings, permission } = state;

  const cornerLabels = [
    { id: 'bottom-right', label: t('bottomRightCorner') },
    { id: 'bottom-left', label: t('bottomLeftCorner') },
    { id: 'top-right', label: t('topRightCorner') },
    { id: 'top-left', label: t('topLeftCorner') },
  ];

  const sizePresets = [
    { size: 160, label: t('small160Px') },
    { size: 240, label: t('medium240Px') },
    { size: 320, label: t('large320Px') },
    { size: 400, label: t('extraLarge400Px') },
  ];

  const template = [
    {
      label: settings.overlayVisible ? t('hideFromDesktop2') : t('showOnDesktop2'),
      click: () => {
        if (settings.overlayVisible && isMoveMode) {
          isMoveMode = false;
          stopDragTracking();
        }
        store.saveSettings({ overlayVisible: !settings.overlayVisible });
        syncOverlayWindow();
        broadcastState();
      },
    },
    {
      label: isMoveMode ? t('exitMoveMode2') : t('moveCharacter'),
      type: 'checkbox',
      checked: isMoveMode,
      click: () => {
        setMoveMode(!isMoveMode);
      },
    },
    {
      label: t('touchReaction'),
      type: 'checkbox',
      checked: Boolean(settings.touchReaction),
      click: () => {
        store.saveSettings({ touchReaction: !settings.touchReaction });
        broadcastState();
      },
    },
    { type: 'separator' },
    {
      label: t('openControlWindow'),
      click: () => showControlWindow(false),
    },
    {
      label: t('addCharacter3'),
      click: () => showControlWindow(true),
    },
    { type: 'separator' },
    {
      label: t('selectCharacter'),
      submenu: characters.map((char) => ({
        label: char.name,
        type: 'radio',
        checked: char.id === settings.selectedCharacterId,
        click: () => {
          store.saveSettings({ selectedCharacterId: char.id });
          broadcastState();
        },
      })),
    },
    {
      label: t('position'),
      submenu: [
        ...cornerLabels.map((item) => ({
          label: item.label,
          type: 'radio',
          checked: settings.positionMode !== 'custom' && settings.corner === item.id,
          click: () => {
            isMoveMode = false;
            stopDragTracking();
            store.saveSettings({
              positionMode: 'corner',
              corner: item.id,
              customX: null,
              customY: null,
            });
            syncOverlayWindow();
            broadcastState();
          },
        })),
        { type: 'separator' },
        {
          label:
            settings.positionMode === 'custom'
              ? t('freeMenu', {x: settings.customX, y: settings.customY})
              : t('moveCharacter2'),
          type: 'radio',
          checked: settings.positionMode === 'custom',
          click: () => {
            setMoveMode(true);
          },
        },
      ],
    },
    {
      label: t('size'),
      submenu: sizePresets.map((preset) => ({
        label: preset.label,
        type: 'radio',
        checked: Math.abs(settings.size - preset.size) < 20,
        click: () => {
          store.saveSettings({ size: preset.size });
          syncOverlayWindow();
          broadcastState();
        },
      })),
    },
  ];

  template.push({label: t('language'), submenu: ['tr', 'en'].map(language => ({
    label: language === 'tr' ? 'Türkçe' : 'English', type: 'radio', checked: settings.language === language,
    click: () => { store.saveSettings({language}); broadcastState(); },
  }))});

  if (permission.required && !permission.granted) {
    template.push(
      { type: 'separator' },
      {
        label: t('openMacosInputSettings'),
        click: () => {
          openMacInputMonitoringSettings();
        },
      }
    );
  }

  template.push(
    { type: 'separator' },
    {
      label: t('quit'),
      click: () => {
        isQuitting = true;
        app.quit();
      },
    }
  );

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

async function openMacInputMonitoringSettings() {
  if (process.platform !== 'darwin') return { granted: true };
  if (inputMonitor) {
    await inputMonitor.requestPermissionPrompt();
  }
  await shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'
  );
  return { granted: inputMonitor ? inputMonitor.permissionGranted : false };
}

function registerIpcHandlers() {
  ipcMain.on('overlay:drag-hit', (event, {id, hit} = {}) => {
    if (overlayWindow && !overlayWindow.isDestroyed() && event.sender === overlayWindow.webContents) directDrag.confirmHit(id, hit);
  });
  ipcMain.handle('app:get-state', () => buildAppState());

  ipcMain.handle('character:select', (_event, id) => {
    const target = store.getCharacter(id);
    if (target) {
      store.saveSettings({ selectedCharacterId: target.id });
      broadcastState();
    }
    return buildAppState();
  });

  ipcMain.handle('character:save', (_event, payload) => {
    const created = store.saveCharacter({
      name: payload?.name,
      poses: payload?.poses,
      offsets: payload?.offsets,
    });
    const showOnDesktop = payload?.showOnDesktop !== false;
    store.saveSettings({
      selectedCharacterId: created.id,
      ...(showOnDesktop ? { overlayVisible: true } : {}),
    });
    syncOverlayWindow();
    broadcastState();
    return {
      created,
      state: buildAppState(),
    };
  });

  ipcMain.handle('character:set-blink', (_event, { id, blink, offset }) => {
    const updated = store.setCharacterBlink(id, blink, offset);
    broadcastState();
    return {
      updated,
      state: buildAppState(),
    };
  });

  ipcMain.handle('character:remove-blink', (_event, id) => {
    const updated = store.removeCharacterBlink(id);
    broadcastState();
    return {
      updated,
      state: buildAppState(),
    };
  });

  ipcMain.handle('character:update-offsets', (_event, { id, offsets }) => {
    store.updateCharacterOffsets(id, offsets);
    broadcastState();
    return buildAppState();
  });

  ipcMain.handle('character:delete', (_event, id) => {
    store.deleteCharacter(id);
    broadcastState();
    return buildAppState();
  });

  ipcMain.handle('overlay:set-visible', (_event, visible) => {
    if (!visible && isMoveMode) {
      isMoveMode = false;
      stopDragTracking();
    }
    store.saveSettings({ overlayVisible: Boolean(visible) });
    syncOverlayWindow();
    broadcastState();
    return buildAppState();
  });

  ipcMain.handle('overlay:set-move-mode', (_event, enabled) => {
    setMoveMode(Boolean(enabled));
    return buildAppState();
  });

  ipcMain.handle('overlay:drag-start', () => {
    return startOverlayDrag();
  });

  ipcMain.handle('overlay:drag-end', (_event, options) => {
    return finishOverlayDrag(options || { commit: true });
  });

  ipcMain.handle('settings:update', (_event, partial) => {
    const patch = { ...(partial || {}) };
    if (patch.corner && !patch.positionMode) {
      patch.positionMode = 'corner';
      patch.customX = null;
      patch.customY = null;
      isMoveMode = false;
      stopDragTracking();
    }
    store.saveSettings(patch);
    syncOverlayWindow();
    broadcastState();
    return buildAppState();
  });

  ipcMain.handle('dialog:pick-png', async (event, options = {}) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || controlWindow;
    const result = await dialog.showOpenDialog(owner, {
      title: options.title || t('chooseAPngImage'),
      buttonLabel: t('choose'),
      filters: [{ name: t('pngImages'), extensions: ['png'] }],
      properties: options.multiSelections ? ['openFile', 'multiSelections'] : ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) {
      return { canceled: true, files: [] };
    }
    const files = result.filePaths.map((filePath) => ({
      path: filePath,
      name: path.basename(filePath),
      previewUrl: pathToFileURL(filePath).href,
    }));
    return { canceled: false, files };
  });

  ipcMain.handle('permissions:open-mac-settings', async () => {
    const res = await openMacInputMonitoringSettings();
    broadcastState();
    return res;
  });

  ipcMain.handle('permissions:recheck', async () => {
    if (inputMonitor) {
      const granted = await inputMonitor.checkPermission();
      if (granted) {
        inputMonitor.restart();
      }
    }
    broadcastState();
    return buildAppState();
  });
}

async function startApplication() {
  // On macOS, run as an Accessory (UIElement) app so the non-activating NSPanel overlay
  // remains visible above native green-button Full-Screen Spaces (e.g., Discord fullscreen)
  // without stealing keyboard focus.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  const resourcesRoot = getResourcesRoot();
  store = new CharacterStore({
    builtInCharactersDir: path.join(resourcesRoot, 'characters'),
    userDataDir: app.getPath('userData'),
    systemLocale: app.getPreferredSystemLanguages()[0] || app.getLocale(),
  });

  const initialSettings = store.getSettings();
  activeLanguage = initialSettings.language;
  store.saveSettings({language: activeLanguage});
  rebuildApplicationMenu();
  const initialCharacter = store.getCharacter(initialSettings.selectedCharacterId);

  animController = new AnimationController({
    strikeMs: 85,
    reboundMs: 22,
    hasBlinkPose: Boolean(initialCharacter?.poses?.blink),
    onPoseChange: (pose, hands) => {
      broadcastPose(pose, hands);
    },
  });

  inputMonitor = new InputMonitor({
    binDir: path.join(resourcesRoot, 'bin'),
    onKeyboard: () => animController.triggerKeyboard(),
    onMouseButtonChange: onGlobalLeftButton,
    onMouse: () => {
      animController.triggerMouse();
      try {
        triggerTouchCheckAtScreenPoint(screen.getCursorScreenPoint());
      } catch {
        // Ignore if screen API not ready
      }
    },
    onPermissionChange: () => broadcastState(),
  });

  registerIpcHandlers();
  createOverlayWindow();
  createControlWindow();
  createSystemTray();
  inputMonitor.start();

  screen.on('display-metrics-changed', () => {
    syncOverlayWindow();
  });
}

if (!isTestMode) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      showControlWindow(false);
    });
  }
}

app.whenReady().then(() => {
  if (!app.isReady()) return;
  startApplication();

  app.on('activate', () => {
    showControlWindow(false);
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  stopDirectDrag();
  stopDragTracking();
  if (inputMonitor) {
    inputMonitor.stop();
  }
  if (animController) {
    animController.reset();
  }
});

app.on('window-all-closed', () => {
  if (isQuitting) {
    app.quit();
  }
});

module.exports = {
  getTestContext: () => ({
    app,
    store,
    animController,
    inputMonitor,
    getControlWindow: () => controlWindow,
    getOverlayWindow: () => overlayWindow,
    isOverlayClickThroughEnabled: () => overlayClickThroughEnabled,
    isMoveModeActive: () => isMoveMode,
    setMoveMode,
    startOverlayDrag,
    finishOverlayDrag,
    triggerTouchCheckAtScreenPoint,
    directDrag,
    syncOverlayWindow,
    buildAppState,
  }),
};
