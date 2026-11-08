'use strict';

(() => {
  let language = 'tr';
  const t = (key, params) => window.characterI18n.translate(language, key, params);
  const REQUIRED_POSE_KEYS = ['idle', 'keyboard', 'mouse', 'both'];
  const ALL_POSE_KEYS = ['idle', 'keyboard', 'mouse', 'both', 'blink'];
  const POSE_LABELS = {
    get idle() { return t('idle'); },
    get keyboard() { return t('keyboard'); },
    get mouse() { return t('mouse'); },
    get both() { return t('keyboardMouse'); },
    get blink() { return t('eyesClosed'); },
  };
  const REFERENCE_CANVAS = 280;

  // Main UI elements
  const btnOpenAdd = document.getElementById('btn-open-add');
  const btnOpenAddInline = document.getElementById('btn-open-add-inline');
  const btnToggleOverlay = document.getElementById('btn-toggle-overlay');
  const overlayStatusPill = document.getElementById('overlay-status-pill');
  const macPermissionBanner = document.getElementById('mac-permission-banner');
  const btnOpenMacSettings = document.getElementById('btn-open-mac-settings');
  const btnRecheckPermission = document.getElementById('btn-recheck-permission');

  const mainPreviewBox = document.getElementById('main-preview-box');
  const mainCanvas = document.getElementById('main-preview-canvas');
  const mainCtx = mainCanvas.getContext('2d');
  const mainPoseLabel = document.getElementById('main-pose-label');

  const positionLabelText = document.getElementById('position-label-text');
  const btnMoveCharacter = document.getElementById('btn-move-character');
  const cornerInputs = Array.from(document.querySelectorAll('input[name="corner"]'));
  const sizeSlider = document.getElementById('size-slider');
  const sizeValue = document.getElementById('size-value');
  const chkTouchReaction = document.getElementById('chk-touch-reaction');

  const characterListEl = document.getElementById('character-list');
  const hiddenExistingBlinkInput = document.getElementById('hidden-existing-blink-input');

  // Dialog elements
  const addDialog = document.getElementById('add-character-dialog');
  const btnCloseDialog = document.getElementById('btn-close-dialog');
  const btnCancelDialog = document.getElementById('btn-cancel-dialog');
  const btnSaveAndShow = document.getElementById('btn-save-and-show');
  const slotsProgress = document.getElementById('slots-progress');
  const dialogError = document.getElementById('dialog-error');
  const nameInput = document.getElementById('character-name-input');

  const poseSlotEls = Array.from(document.querySelectorAll('.pose-slot'));
  const btnClearDraftBlink = document.getElementById('btn-clear-draft-blink');
  const hiddenFileInput = document.getElementById('hidden-file-input');
  const hiddenSheetInput = document.getElementById('hidden-sheet-input');
  const btnPickSheet = document.getElementById('btn-pick-sheet');
  const sheetDropzone = document.getElementById('sheet-dropzone');

  const modalStage = document.getElementById('modal-preview-stage');
  const modalCanvas = document.getElementById('modal-preview-canvas');
  const modalCtx = modalCanvas.getContext('2d');
  const modalPoseBadge = document.getElementById('modal-pose-badge');
  const inspectTabs = Array.from(document.querySelectorAll('.pose-tab'));
  const chkGhostIdle = document.getElementById('chk-ghost-idle');
  const offsetReadout = document.getElementById('offset-readout');
  const btnResetOffset = document.getElementById('btn-reset-offset');

  // State
  let appState = null;
  let mainImages = {};
  let mainLoadToken = 0;
  let activePose = 'idle';
  let pendingExistingBlinkCharId = null;

  const localPulse = createPulseTracker((pose) => {
    if (addDialog.open) {
      draftLivePose = pose === 'idle' ? null : pose;
      renderModalCanvas();
    } else {
      activePose = pose;
      mainPoseLabel.textContent = POSE_LABELS[pose] || pose;
      renderMainCanvas();
    }
  });

  // Draft state inside t('addCharacter2') modal
  let pendingSlotTarget = null;
  let draftInspectPose = 'idle';
  let draftLivePose = null;
  let draftSaving = false;
  let draft = createEmptyDraft();

  function createEmptyDraft() {
    return {
      poses: {
        idle: null,
        keyboard: null,
        mouse: null,
        both: null,
        blink: null,
      },
      images: {
        idle: null,
        keyboard: null,
        mouse: null,
        both: null,
        blink: null,
      },
      offsets: {
        idle: { x: 0, y: 0 },
        keyboard: { x: 0, y: 0 },
        mouse: { x: 0, y: 0 },
        both: { x: 0, y: 0 },
        blink: { x: 0, y: 0 },
      },
    };
  }

  function createPulseTracker(onChange) {
    let kbDown = false;
    let mouseDown = false;
    let kbTimer = null;
    let kbRebound = null;
    let mouseTimer = null;
    let mouseRebound = null;
    let lastKb = 0;
    let lastMouse = 0;
    const heldKeys = new Set();

    function current() {
      if (kbDown && mouseDown) return 'both';
      if (kbDown) return 'keyboard';
      if (mouseDown) return 'mouse';
      return 'idle';
    }

    function notify() {
      onChange(current());
    }

    return {
      keyDown(code, repeat) {
        if (repeat || heldKeys.has(code)) return;
        heldKeys.add(code);
        clearTimeout(kbRebound);
        clearTimeout(kbTimer);
        const now = performance.now();
        if (kbDown && now - lastKb >= 16) {
          kbDown = false;
          notify();
          kbRebound = setTimeout(() => {
            kbDown = true;
            lastKb = performance.now();
            notify();
            kbTimer = setTimeout(() => {
              kbDown = false;
              notify();
            }, 85);
          }, 22);
          return;
        }
        kbDown = true;
        lastKb = now;
        notify();
        kbTimer = setTimeout(() => {
          kbDown = false;
          notify();
        }, 85);
      },
      keyUp(code) {
        heldKeys.delete(code);
      },
      mouseDown(button) {
        if (button !== 0 && button !== 2) return;
        clearTimeout(mouseRebound);
        clearTimeout(mouseTimer);
        const now = performance.now();
        if (mouseDown && now - lastMouse >= 16) {
          mouseDown = false;
          notify();
          mouseRebound = setTimeout(() => {
            mouseDown = true;
            lastMouse = performance.now();
            notify();
            mouseTimer = setTimeout(() => {
              mouseDown = false;
              notify();
            }, 85);
          }, 22);
          return;
        }
        mouseDown = true;
        lastMouse = now;
        notify();
        mouseTimer = setTimeout(() => {
          mouseDown = false;
          notify();
        }, 85);
      },
      reset() {
        clearTimeout(kbRebound);
        clearTimeout(kbTimer);
        clearTimeout(mouseRebound);
        clearTimeout(mouseTimer);
        heldKeys.clear();
        kbDown = false;
        mouseDown = false;
      },
    };
  }

  function loadImageElement(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t('couldNotReadTheImageChooseA')));
      img.src = src;
    });
  }

  async function readPngFileAsPayload(file) {
    const isPng =
      file.type === 'image/png' || String(file.name || '').toLowerCase().endsWith('.png');
    if (!isPng) {
      throw new Error(t('chooseATransparentOrStandardPngPng'));
    }

    const arrayBuf = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    if (
      bytes.length < 24 ||
      bytes[0] !== 137 ||
      bytes[1] !== 80 ||
      bytes[2] !== 78 ||
      bytes[3] !== 71
    ) {
      throw new Error(t('theSelectedFileIsNotAValid'));
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(t('couldNotReadTheFile')));
      reader.readAsDataURL(new Blob([bytes], { type: 'image/png' }));
    });

    const nativePath = window.desktopApi.getFilePath(file);
    return {
      name: file.name || 'gorsel.png',
      sourcePath: nativePath || undefined,
      dataUrl,
    };
  }

  function drawCharacterToCanvas(canvas, ctx, cssSize, img, offset, ghostImg, ghostOffset) {
    const dpr = window.devicePixelRatio || 1;
    const targetPx = Math.round(cssSize * dpr);
    if (canvas.width !== targetPx || canvas.height !== targetPx) {
      canvas.width = targetPx;
      canvas.height = targetPx;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);

    const drawSingle = (image, off, alpha) => {
      if (!image || !image.naturalWidth || !image.naturalHeight) return;
      const pad = Math.round(cssSize * 0.06);
      const avail = Math.max(16, cssSize - pad * 2);
      const scale = Math.min(avail / image.naturalWidth, avail / image.naturalHeight);
      const w = image.naturalWidth * scale;
      const h = image.naturalHeight * scale;
      const factor = cssSize / REFERENCE_CANVAS;
      const dx = (cssSize - w) / 2 + (Number(off?.x) || 0) * factor;
      const dy = (cssSize - h) / 2 + (Number(off?.y) || 0) * factor;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, dx, dy, w, h);
      ctx.restore();
    };

    if (ghostImg) {
      drawSingle(ghostImg, ghostOffset, 0.28);
    }
    drawSingle(img, offset, 1);
  }

  async function preloadMainCharacter(character) {
    if (!character) {
      mainImages = {};
      renderMainCanvas();
      return;
    }
    const token = ++mainLoadToken;
    const loaded = await Promise.all(
      ALL_POSE_KEYS.map(async (key) => {
        const rawSrc = character.poses?.[key];
        if (!rawSrc) return [key, null];
        try {
          const url = `${rawSrc}?v=${encodeURIComponent(character.createdAt || 'builtin')}`;
          const img = await loadImageElement(url);
          return [key, img];
        } catch {
          return [key, null];
        }
      })
    );
    if (token !== mainLoadToken) return;
    mainImages = Object.fromEntries(loaded);
    renderMainCanvas();
  }

  function renderMainCanvas() {
    const char = appState?.activeCharacter;
    const img = mainImages[activePose] || mainImages.idle || null;
    const offset = char?.offsets?.[activePose] || char?.offsets?.idle || { x: 0, y: 0 };
    drawCharacterToCanvas(mainCanvas, mainCtx, 260, img, offset, null, null);
  }

  function renderCharacterGallery() {
    characterListEl.innerHTML = '';
    const chars = appState?.characters || [];
    const selectedId = appState?.settings?.selectedCharacterId;

    for (const char of chars) {
      const card = document.createElement('div');
      card.className = `char-card${char.id === selectedId ? ' is-selected' : ''}`;
      card.setAttribute('role', 'listitem');
      card.tabIndex = 0;

      const thumb = document.createElement('div');
      thumb.className = 'char-card-thumb checkerboard';
      const img = document.createElement('img');
      img.src = `${char.poses.idle}?v=${encodeURIComponent(char.createdAt || 'builtin')}`;
      img.alt = char.name;
      thumb.appendChild(img);

      const footer = document.createElement('div');
      footer.className = 'char-card-footer';

      const title = document.createElement('span');
      title.className = 'char-card-name';
      title.textContent = char.name;
      footer.appendChild(title);

      const actions = document.createElement('div');
      actions.className = 'char-card-actions';

      const blinkBtn = document.createElement('button');
      blinkBtn.type = 'button';
      blinkBtn.className = `char-blink-btn${char.hasBlink ? ' has-blink' : ''}`;
      blinkBtn.textContent = char.hasBlink ? t('blink2') : t('addBlink');
      blinkBtn.title = char.hasBlink
        ? t('replaceTheEyesClosedBlinkPng')
        : t('addAnEyesClosedBlinkPngTo');
      blinkBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        pendingExistingBlinkCharId = char.id;
        hiddenExistingBlinkInput.value = '';
        hiddenExistingBlinkInput.click();
      });
      actions.appendChild(blinkBtn);

      if (!char.builtIn) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'char-delete-btn';
        delBtn.title = t('deleteCharacter');
        delBtn.setAttribute('aria-label', t('deleteNamed', {name: char.name}));
        delBtn.textContent = t('delete');
        delBtn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          await window.desktopApi.deleteCharacter(char.id);
        });
        actions.appendChild(delBtn);
      }

      card.appendChild(thumb);
      card.appendChild(footer);
      card.appendChild(actions);

      const activate = () => window.desktopApi.selectCharacter(char.id);
      card.addEventListener('click', activate);
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          activate();
        }
      });

      characterListEl.appendChild(card);
    }
  }

  function applyAppState(nextState) {
    if (!nextState) return;
    const prevCharId = appState?.activeCharacter?.id;
    const prevCreatedAt = appState?.activeCharacter?.createdAt;
    const languageChanged = language !== nextState.settings.language;
    language = nextState.settings.language || 'tr';
    window.characterI18n.applyDocument(language);
    document.getElementById('language-select').value = language;
    appState = nextState;
    if (languageChanged) { showDialogError(''); syncDraftUI(); }
    mainPoseLabel.textContent = POSE_LABELS[activePose] || POSE_LABELS.idle;

    const { settings, permission, activeCharacter, moveMode } = appState;

    if (settings.overlayVisible) {
      btnToggleOverlay.textContent = t('hideFromDesktop');
      btnToggleOverlay.classList.add('is-active');
      overlayStatusPill.textContent = moveMode ? t('inMoveMode') : t('visibleOnDesktop');
      overlayStatusPill.className = 'status-pill status-on';
    } else {
      btnToggleOverlay.textContent = t('showOnDesktop');
      btnToggleOverlay.classList.remove('is-active');
      overlayStatusPill.textContent = t('hiddenFromDesktop');
      overlayStatusPill.className = 'status-pill status-off';
    }

    macPermissionBanner.hidden = !(permission?.required && !permission?.granted);

    // Position mode & Move button
    if (moveMode) {
      btnMoveCharacter.textContent = t('exitMoveMode');
      positionLabelText.textContent = t('dragTheCharacterOnYourDesktop');
    } else if (settings.positionMode === 'custom') {
      btnMoveCharacter.textContent = t('moveCharacter');
      positionLabelText.textContent = t('freePosition', {x: settings.customX, y: settings.customY});
    } else {
      btnMoveCharacter.textContent = t('moveCharacter');
      positionLabelText.textContent = t('desktopPosition');
    }

    for (const radio of cornerInputs) {
      radio.checked = settings.positionMode !== 'custom' && radio.value === settings.corner;
    }

    sizeSlider.value = String(settings.size);
    sizeValue.textContent = `${settings.size} px`;
    chkTouchReaction.checked = Boolean(settings.touchReaction);

    renderCharacterGallery();
    if (activeCharacter?.id !== prevCharId || activeCharacter?.createdAt !== prevCreatedAt) {
      preloadMainCharacter(activeCharacter);
    } else {
      renderMainCanvas();
    }
  }

  // --- Add Character Modal Logic ---
  function showDialogError(msg) {
    if (!msg) {
      dialogError.hidden = true;
      dialogError.textContent = '';
      return;
    }
    dialogError.textContent = msg;
    dialogError.hidden = false;
  }

  function resetDraft() {
    draft = createEmptyDraft();
    draftInspectPose = 'idle';
    draftLivePose = null;
    draftSaving = false;
    nameInput.value = '';
    showDialogError('');
    syncDraftUI();
  }

  function openAddModal() {
    resetDraft();
    if (!addDialog.open) {
      addDialog.showModal();
    }
  }

  function closeAddModal() {
    localPulse.reset();
    draftLivePose = null;
    if (addDialog.open) {
      addDialog.close();
    }
  }

  function syncDraftUI() {
    let readyRequired = 0;
    for (const key of ALL_POSE_KEYS) {
      const slotEl = document.querySelector(`.pose-slot[data-pose="${key}"]`);
      const thumbImg = document.querySelector(`img[data-thumb="${key}"]`);
      const placeholder = document.querySelector(`[data-placeholder="${key}"]`);
      const tag = document.querySelector(`[data-tag="${key}"]`);
      const entry = draft.poses[key];

      if (entry) {
        if (REQUIRED_POSE_KEYS.includes(key)) readyRequired++;
        slotEl.classList.add('is-loaded');
        thumbImg.src = entry.previewUrl;
        thumbImg.hidden = false;
        placeholder.hidden = true;
        tag.textContent = t('replace');
      } else {
        slotEl.classList.remove('is-loaded');
        thumbImg.removeAttribute('src');
        thumbImg.hidden = true;
        placeholder.hidden = false;
        tag.textContent = key === 'blink' ? t('optional2') : t('upload');
      }
    }

    btnClearDraftBlink.hidden = !draft.poses.blink;

    if (readyRequired === 4) {
      slotsProgress.textContent = draft.poses.blink
        ? t('44RequiredImagesBlinkReady')
        : t('44RequiredImagesReady');
    } else {
      slotsProgress.textContent = t('progress', {count: readyRequired});
    }
    slotsProgress.classList.toggle('all-ready', readyRequired === 4);
    btnSaveAndShow.disabled = readyRequired !== 4 || draftSaving;

    for (const tab of inspectTabs) {
      tab.classList.toggle('active', tab.dataset.inspectPose === draftInspectPose);
    }

    const activeOff = draft.offsets[draftInspectPose] || { x: 0, y: 0 };
    offsetReadout.textContent = t('offset', activeOff);

    renderModalCanvas();
  }

  function renderModalCanvas() {
    const shownPose = draftLivePose && draftLivePose !== 'idle' ? draftLivePose : draftInspectPose;
    modalPoseBadge.textContent = POSE_LABELS[shownPose] || shownPose;

    const img = draft.images[shownPose] || draft.images.idle || null;
    const off = draft.offsets[shownPose] || { x: 0, y: 0 };

    const showGhost =
      chkGhostIdle.checked &&
      shownPose !== 'idle' &&
      !draftLivePose &&
      Boolean(draft.images.idle);

    drawCharacterToCanvas(
      modalCanvas,
      modalCtx,
      240,
      img,
      off,
      showGhost ? draft.images.idle : null,
      draft.offsets.idle
    );
  }

  async function assignPoseFromFileObject(poseKey, file) {
    showDialogError('');
    if (!file) return;
    try {
      const parsed = await readPngFileAsPayload(file);
      const img = await loadImageElement(parsed.dataUrl);

      draft.poses[poseKey] = {
        name: parsed.name,
        sourcePath: parsed.sourcePath,
        dataUrl: parsed.dataUrl,
        previewUrl: parsed.dataUrl,
      };
      draft.images[poseKey] = img;
      draftInspectPose = poseKey;
      syncDraftUI();
    } catch (err) {
      showDialogError(err?.message || t('couldNotLoadTheImage'));
    }
  }

  async function assignPoseFromDataUrl(poseKey, dataUrl, labelName) {
    const img = await loadImageElement(dataUrl);
    draft.poses[poseKey] = {
      name: labelName || `${poseKey}.png`,
      dataUrl,
      previewUrl: dataUrl,
    };
    draft.images[poseKey] = img;
  }

  async function split2x2SheetFromDataUrl(dataUrl) {
    showDialogError('');
    const sheetImg = await loadImageElement(dataUrl);
    if (sheetImg.naturalWidth < 4 || sheetImg.naturalHeight < 4) {
      throw new Error(t('the22ImageIsTooSmall'));
    }

    const halfW = Math.floor(sheetImg.naturalWidth / 2);
    const halfH = Math.floor(sheetImg.naturalHeight / 2);
    const quadrants = [
      { key: 'idle', sx: 0, sy: 0 },
      { key: 'keyboard', sx: halfW, sy: 0 },
      { key: 'mouse', sx: 0, sy: halfH },
      { key: 'both', sx: halfW, sy: halfH },
    ];

    // Splits ONLY the 4 base poses; leaves optional 5th blink slot independently selectable
    for (const q of quadrants) {
      const offCanvas = document.createElement('canvas');
      offCanvas.width = halfW;
      offCanvas.height = halfH;
      const offCtx = offCanvas.getContext('2d');
      offCtx.clearRect(0, 0, halfW, halfH);
      offCtx.drawImage(sheetImg, q.sx, q.sy, halfW, halfH, 0, 0, halfW, halfH);
      const cellDataUrl = offCanvas.toDataURL('image/png');
      await assignPoseFromDataUrl(q.key, cellDataUrl, `${q.key}.png`);
    }

    draftInspectPose = 'idle';
    syncDraftUI();
  }

  async function handleSheetFile(file) {
    if (!file) return;
    try {
      const parsed = await readPngFileAsPayload(file);
      await split2x2SheetFromDataUrl(parsed.dataUrl);
    } catch (err) {
      showDialogError(err?.message || t('couldNotSplitThe22Png'));
    }
  }

  // --- Wire Event Listeners ---
  btnOpenAdd.addEventListener('click', openAddModal);
  btnOpenAddInline.addEventListener('click', openAddModal);
  btnCloseDialog.addEventListener('click', closeAddModal);
  btnCancelDialog.addEventListener('click', closeAddModal);

  btnToggleOverlay.addEventListener('click', async () => {
    const currentVisible = Boolean(appState?.settings?.overlayVisible);
    const next = await window.desktopApi.setOverlayVisible(!currentVisible);
    applyAppState(next);
  });

  btnMoveCharacter.addEventListener('click', async () => {
    const next = await window.desktopApi.setMoveMode(!appState?.moveMode);
    applyAppState(next);
  });

  btnOpenMacSettings.addEventListener('click', async () => {
    await window.desktopApi.openMacInputSettings();
  });

  btnRecheckPermission.addEventListener('click', async () => {
    const next = await window.desktopApi.recheckPermissions();
    applyAppState(next);
  });

  for (const radio of cornerInputs) {
    radio.addEventListener('change', async () => {
      if (radio.checked) {
        const next = await window.desktopApi.updateSettings({
          positionMode: 'corner',
          corner: radio.value,
          customX: null,
          customY: null,
        });
        applyAppState(next);
      }
    });
  }

  sizeSlider.addEventListener('input', () => {
    sizeValue.textContent = `${sizeSlider.value} px`;
  });

  sizeSlider.addEventListener('change', async () => {
    const next = await window.desktopApi.updateSettings({ size: Number(sizeSlider.value) });
    applyAppState(next);
  });

  chkTouchReaction.addEventListener('change', async () => {
    const next = await window.desktopApi.updateSettings({
      touchReaction: chkTouchReaction.checked,
    });
    applyAppState(next);
  });

  // Retrofitting / updating optional 5th blink PNG on an existing character
  hiddenExistingBlinkInput.addEventListener('change', async () => {
    const file = hiddenExistingBlinkInput.files?.[0];
    const targetCharId = pendingExistingBlinkCharId;
    pendingExistingBlinkCharId = null;
    if (!file || !targetCharId) return;

    try {
      const parsed = await readPngFileAsPayload(file);
      const res = await window.desktopApi.setCharacterBlink(targetCharId, {
        sourcePath: parsed.sourcePath,
        dataUrl: parsed.dataUrl,
      });
      applyAppState(res.state);
    } catch (err) {
      alert(err?.message || t('couldNotAddTheBlinkImage'));
    }
  });

  btnClearDraftBlink.addEventListener('click', (ev) => {
    ev.stopPropagation();
    draft.poses.blink = null;
    draft.images.blink = null;
    draft.offsets.blink = { ...draft.offsets.idle };
    if (draftInspectPose === 'blink') {
      draftInspectPose = 'idle';
    }
    syncDraftUI();
  });

  // 4 Required + 1 Optional Pose Slots: 1-click upload/replace + drag & drop
  for (const slotEl of poseSlotEls) {
    const poseKey = slotEl.dataset.pose;

    const triggerSlotPick = () => {
      pendingSlotTarget = poseKey;
      hiddenFileInput.value = '';
      hiddenFileInput.click();
    };

    slotEl.addEventListener('click', triggerSlotPick);
    slotEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        triggerSlotPick();
      }
    });

    slotEl.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      slotEl.classList.add('is-dragover');
    });

    slotEl.addEventListener('dragleave', () => {
      slotEl.classList.remove('is-dragover');
    });

    slotEl.addEventListener('drop', async (ev) => {
      ev.preventDefault();
      slotEl.classList.remove('is-dragover');
      const files = Array.from(ev.dataTransfer?.files || []);
      if (!files.length) return;

      if (files.length >= 4 && REQUIRED_POSE_KEYS.includes(poseKey)) {
        for (let i = 0; i < Math.min(files.length, ALL_POSE_KEYS.length); i++) {
          await assignPoseFromFileObject(ALL_POSE_KEYS[i], files[i]);
        }
      } else {
        await assignPoseFromFileObject(poseKey, files[0]);
      }
    });
  }

  hiddenFileInput.addEventListener('change', async () => {
    const files = Array.from(hiddenFileInput.files || []);
    if (!files.length || !pendingSlotTarget) return;
    await assignPoseFromFileObject(pendingSlotTarget, files[0]);
  });

  // Secondary 2x2 sprite sheet picker & dropzone
  btnPickSheet.addEventListener('click', () => {
    hiddenSheetInput.value = '';
    hiddenSheetInput.click();
  });

  hiddenSheetInput.addEventListener('change', async () => {
    const file = hiddenSheetInput.files?.[0];
    if (file) await handleSheetFile(file);
  });

  sheetDropzone.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    sheetDropzone.classList.add('is-dragover');
  });
  sheetDropzone.addEventListener('dragleave', () => {
    sheetDropzone.classList.remove('is-dragover');
  });
  sheetDropzone.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    sheetDropzone.classList.remove('is-dragover');
    const file = ev.dataTransfer?.files?.[0];
    if (file) await handleSheetFile(file);
  });

  // Pose inspection & alignment controls
  for (const tab of inspectTabs) {
    tab.addEventListener('click', () => {
      draftInspectPose = tab.dataset.inspectPose;
      syncDraftUI();
    });
  }

  chkGhostIdle.addEventListener('change', renderModalCanvas);

  btnResetOffset.addEventListener('click', () => {
    draft.offsets[draftInspectPose] = { x: 0, y: 0 };
    syncDraftUI();
  });

  // Pointer drag alignment on modal stage
  let dragStart = null;
  modalStage.addEventListener('pointerdown', (ev) => {
    if (ev.button === 2) {
      localPulse.mouseDown(2);
      return;
    }
    if (ev.button !== 0) return;

    localPulse.mouseDown(0);
    const currentOff = draft.offsets[draftInspectPose] || { x: 0, y: 0 };
    dragStart = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      origX: currentOff.x,
      origY: currentOff.y,
      moved: false,
    };
    modalStage.setPointerCapture(ev.pointerId);
  });

  modalStage.addEventListener('pointermove', (ev) => {
    if (!dragStart || !modalStage.hasPointerCapture(ev.pointerId)) return;
    const dx = ev.clientX - dragStart.startX;
    const dy = ev.clientY - dragStart.startY;
    if (!dragStart.moved && Math.hypot(dx, dy) < 4) return;

    dragStart.moved = true;
    modalStage.classList.add('dragging');
    const scale = REFERENCE_CANVAS / 240;
    draft.offsets[draftInspectPose] = {
      x: Math.max(-120, Math.min(120, Math.round(dragStart.origX + dx * scale))),
      y: Math.max(-120, Math.min(120, Math.round(dragStart.origY + dy * scale))),
    };
    offsetReadout.textContent = t('offset', draft.offsets[draftInspectPose]);
    renderModalCanvas();
  });

  modalStage.addEventListener('lostpointercapture', () => {
    dragStart = null;
    modalStage.classList.remove('dragging');
  });

  modalStage.addEventListener('contextmenu', (ev) => ev.preventDefault());

  modalStage.addEventListener('keydown', (ev) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.key) && ev.shiftKey) {
      ev.preventDefault();
      const off = draft.offsets[draftInspectPose];
      if (ev.key === 'ArrowLeft') off.x -= 1;
      if (ev.key === 'ArrowRight') off.x += 1;
      if (ev.key === 'ArrowUp') off.y -= 1;
      if (ev.key === 'ArrowDown') off.y += 1;
      syncDraftUI();
    }
  });

  mainPreviewBox.addEventListener('pointerdown', (ev) => {
    if (ev.button === 0 || ev.button === 2) {
      localPulse.mouseDown(ev.button);
    }
  });
  mainPreviewBox.addEventListener('contextmenu', (ev) => ev.preventDefault());

  window.addEventListener('keydown', (ev) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (ev.key === 'Escape') return;
    localPulse.keyDown(ev.code, ev.repeat);
  });

  window.addEventListener('keyup', (ev) => {
    localPulse.keyUp(ev.code);
  });

  document.getElementById('language-select').addEventListener('change', async (event) => {
    applyAppState(await window.desktopApi.updateSettings({language: event.target.value}));
  });

  // Save & Show on Desktop
  btnSaveAndShow.addEventListener('click', async () => {
    if (draftSaving) return;
    for (const key of REQUIRED_POSE_KEYS) {
      if (!draft.poses[key]) {
        showDialogError(t('pleaseUploadAllFourRequiredPoseImages'));
        return;
      }
    }

    draftSaving = true;
    btnSaveAndShow.disabled = true;
    showDialogError('');

    try {
      const posesPayload = {
        idle: {
          sourcePath: draft.poses.idle.sourcePath,
          dataUrl: draft.poses.idle.dataUrl,
        },
        keyboard: {
          sourcePath: draft.poses.keyboard.sourcePath,
          dataUrl: draft.poses.keyboard.dataUrl,
        },
        mouse: {
          sourcePath: draft.poses.mouse.sourcePath,
          dataUrl: draft.poses.mouse.dataUrl,
        },
        both: {
          sourcePath: draft.poses.both.sourcePath,
          dataUrl: draft.poses.both.dataUrl,
        },
      };

      if (draft.poses.blink) {
        posesPayload.blink = {
          sourcePath: draft.poses.blink.sourcePath,
          dataUrl: draft.poses.blink.dataUrl,
        };
      }

      const offsetsPayload = {
        ...draft.offsets,
        blink: draft.poses.blink ? draft.offsets.blink : { ...draft.offsets.idle },
      };

      const result = await window.desktopApi.saveCharacter({
        name: nameInput.value.trim(),
        poses: posesPayload,
        offsets: offsetsPayload,
        showOnDesktop: true,
      });
      applyAppState(result.state);
      closeAddModal();
    } catch (err) {
      showDialogError(err?.message || t('couldNotSaveTheCharacter'));
      draftSaving = false;
      syncDraftUI();
    }
  });

  window.desktopApi.onStateChanged((state) => {
    applyAppState(state);
  });

  window.desktopApi.onPoseChanged(({ pose }) => {
    activePose = pose || 'idle';
    mainPoseLabel.textContent = POSE_LABELS[activePose] || activePose;
    renderMainCanvas();
    if (addDialog.open) {
      draftLivePose = activePose === 'idle' ? null : activePose;
      renderModalCanvas();
    }
  });

  window.desktopApi.onOpenAddModal(() => {
    openAddModal();
  });

  window.desktopApi.getInitialState().then(applyAppState);

  // Test automation hooks for E2E verification
  window.__controlTestHooks = {
    openAddModal,
    isAddModalOpen: () => addDialog.open,
    isSaveButtonDisabled: () => btnSaveAndShow.disabled,
    getProgressText: () => slotsProgress.textContent,
    setDraftName: (val) => {
      nameInput.value = val;
    },
    loadPoseDataUrl: async (poseKey, dataUrl, fileName) => {
      await assignPoseFromDataUrl(poseKey, dataUrl, fileName);
      syncDraftUI();
    },
    load2x2DataUrl: async (dataUrl) => {
      await split2x2SheetFromDataUrl(dataUrl);
    },
    addBlinkToExistingCharacter: async (charId, dataUrl) => {
      const res = await window.desktopApi.setCharacterBlink(charId, { dataUrl });
      applyAppState(res.state);
      return res;
    },
    setPoseOffset: (poseKey, x, y) => {
      draft.offsets[poseKey] = { x, y };
      syncDraftUI();
    },
    clickSaveAndShow: () => {
      btnSaveAndShow.click();
    },
  };
})();
