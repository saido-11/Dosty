'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  getInitialState: () => ipcRenderer.invoke('app:get-state'),
  selectCharacter: (id) => ipcRenderer.invoke('character:select', id),
  saveCharacter: (payload) => ipcRenderer.invoke('character:save', payload),
  setCharacterBlink: (id, blink, offset) =>
    ipcRenderer.invoke('character:set-blink', { id, blink, offset }),
  removeCharacterBlink: (id) => ipcRenderer.invoke('character:remove-blink', id),
  updateCharacterOffsets: (id, offsets) => ipcRenderer.invoke('character:update-offsets', { id, offsets }),
  deleteCharacter: (id) => ipcRenderer.invoke('character:delete', id),
  pickPngFiles: (options) => ipcRenderer.invoke('dialog:pick-png', options),

  setOverlayVisible: (visible) => ipcRenderer.invoke('overlay:set-visible', visible),
  setMoveMode: (enabled) => ipcRenderer.invoke('overlay:set-move-mode', enabled),
  beginOverlayDrag: (offset) => ipcRenderer.invoke('overlay:drag-start', offset),
  finishOverlayDrag: (options) => ipcRenderer.invoke('overlay:drag-end', options),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),

  openMacInputSettings: () => ipcRenderer.invoke('permissions:open-mac-settings'),
  recheckPermissions: () => ipcRenderer.invoke('permissions:recheck'),

  getFilePath: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },

  onStateChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('app:state-changed', handler);
    return () => ipcRenderer.removeListener('app:state-changed', handler);
  },

  onPoseChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('overlay:pose-changed', handler);
    return () => ipcRenderer.removeListener('overlay:pose-changed', handler);
  },

  reportDragHit: (id, hit) => ipcRenderer.send('overlay:drag-hit', {id, hit}),
  onCheckDrag: (callback) => {
    const handler = (_event, request) => callback(request);
    ipcRenderer.on('overlay:check-drag', handler);
    return () => ipcRenderer.removeListener('overlay:check-drag', handler);
  },
  onCheckTouch: (callback) => {
    const handler = (_event, coords) => callback(coords);
    ipcRenderer.on('overlay:check-touch', handler);
    return () => ipcRenderer.removeListener('overlay:check-touch', handler);
  },

  onOpenAddModal: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('ui:open-add-character', handler);
    return () => ipcRenderer.removeListener('ui:open-add-character', handler);
  },
});
