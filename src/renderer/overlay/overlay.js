'use strict';

(() => {
  const canvas = document.getElementById('character-canvas');
  const ctx = canvas.getContext('2d');
  const moveFrame = document.getElementById('move-frame');

  // Offscreen canvas for exact visible-pixel alpha hit-testing (unaffected by bounce offset)
  const hitCanvas = document.createElement('canvas');
  const hitCtx = hitCanvas.getContext('2d', { willReadFrequently: true });

  const ALL_POSE_KEYS = ['idle', 'keyboard', 'mouse', 'both', 'blink'];
  const REFERENCE_CANVAS = 280;
  const BOUNCE_DURATION_MS = 220;

  let activeCharacter = null;
  let currentPose = 'idle';
  let moveMode = false;
  let loadedImages = {};
  let loadToken = 0;

  // Touch reaction bounce animation state
  let bounceStartAt = null;
  let bounceOffsetY = 0;
  let bounceRafId = null;
  let bounceFallbackId = null;
  let bounceCount = 0;
  let activeDragPointerId = null;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'sync';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function preloadCharacter(character) {
    if (!character || !character.poses) {
      loadedImages = {};
      render();
      return;
    }

    const token = ++loadToken;
    const entries = await Promise.all(
      ALL_POSE_KEYS.map(async (poseKey) => {
        const rawSrc = character.poses[poseKey];
        if (!rawSrc) return [poseKey, null];
        try {
          const url = `${rawSrc}?v=${encodeURIComponent(character.createdAt || 'builtin')}`;
          const img = await loadImage(url);
          return [poseKey, img];
        } catch {
          return [poseKey, null];
        }
      })
    );

    if (token !== loadToken) return;
    loadedImages = Object.fromEntries(entries);
    render();
  }

  function drawPoseToTarget(targetCanvas, targetCtx, cssWidth, cssHeight, dpr, img, rawOffset, extraY) {
    const targetW = Math.round(cssWidth * dpr);
    const targetH = Math.round(cssHeight * dpr);
    if (targetCanvas.width !== targetW || targetCanvas.height !== targetH) {
      targetCanvas.width = targetW;
      targetCanvas.height = targetH;
    }

    targetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    targetCtx.clearRect(0, 0, cssWidth, cssHeight);

    if (!img || !img.naturalWidth || !img.naturalHeight) return;

    // Leave subtle headroom so touch-bounce hop never clips at the top edge
    const pad = Math.round(cssWidth * 0.06);
    const availW = Math.max(16, cssWidth - pad * 2);
    const availH = Math.max(16, cssHeight - pad * 2);
    const scale = Math.min(availW / img.naturalWidth, availH / img.naturalHeight);
    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;

    const offsetScale = cssWidth / REFERENCE_CANVAS;
    const dx = (cssWidth - drawW) / 2 + (Number(rawOffset?.x) || 0) * offsetScale;
    const dy = (cssHeight - drawH) / 2 + (Number(rawOffset?.y) || 0) * offsetScale + extraY;

    targetCtx.imageSmoothingEnabled = true;
    targetCtx.imageSmoothingQuality = 'high';
    targetCtx.drawImage(img, dx, dy, drawW, drawH);
  }

  function render() {
    const cssWidth = window.innerWidth || 240;
    const cssHeight = window.innerHeight || 240;
    const dpr = window.devicePixelRatio || 1;

    const img = loadedImages[currentPose] || loadedImages.idle;
    const rawOffset =
      activeCharacter?.offsets?.[currentPose] ||
      activeCharacter?.offsets?.idle || { x: 0, y: 0 };

    // Update visible canvas (includes live bounceOffsetY)
    drawPoseToTarget(canvas, ctx, cssWidth, cssHeight, dpr, img, rawOffset, bounceOffsetY);

    // Update resting hit-test canvas (0 bounce offset so alpha checks stay accurate mid-hop)
    drawPoseToTarget(hitCanvas, hitCtx, cssWidth, cssHeight, dpr, img, rawOffset, 0);
  }

  // macOS can suspend rAF for non-activating panels in another Space even when
  // backgroundThrottling is disabled. The timer keeps the short bounce from stalling.
  function cancelBounceFrame() {
    if (bounceRafId !== null) window.cancelAnimationFrame(bounceRafId);
    if (bounceFallbackId !== null) window.clearTimeout(bounceFallbackId);
    bounceRafId = null;
    bounceFallbackId = null;
  }

  function scheduleBounceFrame() {
    let fired = false;
    const tick = (now) => {
      if (fired) return;
      fired = true;
      cancelBounceFrame();
      stepBounce(now);
    };
    bounceRafId = window.requestAnimationFrame(tick);
    bounceFallbackId = window.setTimeout(() => tick(performance.now()), 32);
  }

  function stepBounce(now) {
    if (bounceStartAt === null) {
      bounceOffsetY = 0;
      bounceRafId = null;
      render();
      return;
    }

    const elapsed = now - bounceStartAt;
    if (elapsed >= BOUNCE_DURATION_MS) {
      bounceStartAt = null;
      bounceOffsetY = 0;
      bounceRafId = null;
      render();
      return;
    }

    const t = elapsed / BOUNCE_DURATION_MS;
    const cssHeight = window.innerHeight || 240;
    const amplitude = Math.max(7, Math.min(14, Math.round(cssHeight * 0.045)));
    bounceOffsetY = -Math.sin(t * Math.PI) * amplitude;
    render();
    scheduleBounceFrame();
  }

  function triggerBounce() {
    if (moveMode) return false;
    bounceCount += 1;
    bounceStartAt = performance.now();
    if (bounceRafId === null) {
      scheduleBounceFrame();
    }
    return true;
  }

  function isVisiblePixel(localX, localY) {
    const cssWidth = window.innerWidth || 240;
    const cssHeight = window.innerHeight || 240;
    if (localX < 0 || localY < 0 || localX >= cssWidth || localY >= cssHeight) {
      return false;
    }

    const dpr = window.devicePixelRatio || 1;
    const px = Math.min(hitCanvas.width - 1, Math.max(0, Math.round(localX * dpr)));
    const py = Math.min(hitCanvas.height - 1, Math.max(0, Math.round(localY * dpr)));
    if (hitCanvas.width <= 0 || hitCanvas.height <= 0) return false;

    const pixel = hitCtx.getImageData(px, py, 1, 1).data;
    // Trigger bounce ONLY on visible character pixels, never on transparent space
    return pixel[3] > 20;
  }

  function checkTouchAtLocalPoint(localX, localY) {
    return !moveMode && isVisiblePixel(localX, localY) ? triggerBounce() : false;
  }

  function setMoveModeUI(enabled) {
    moveMode = Boolean(enabled);
    document.body.classList.toggle('move-mode', moveMode);
    moveFrame.hidden = !moveMode;

    if (!moveMode) {
      activeDragPointerId = null;
      document.body.classList.remove('is-dragging');
    } else {
      // Cancel any active bounce when entering move mode
      bounceStartAt = null;
      bounceOffsetY = 0;
      if (bounceRafId !== null) {
        cancelBounceFrame();
      }
      render();
    }
  }

  function applyState(state) {
    if (!state) return;
    window.characterI18n.applyDocument(state.settings.language || 'tr');
    setMoveModeUI(state.moveMode);

    const prevId = activeCharacter?.id;
    const prevCreatedAt = activeCharacter?.createdAt;
    activeCharacter = state.activeCharacter || null;
    if (state.currentPose) {
      currentPose = state.currentPose;
    }

    if (activeCharacter?.id !== prevId || activeCharacter?.createdAt !== prevCreatedAt) {
      preloadCharacter(activeCharacter);
    } else {
      render();
    }
  }

  // Free drag interactions when moveMode is active
  window.addEventListener('pointerdown', async (ev) => {
    if (!moveMode || ev.button !== 0) return;
    ev.preventDefault();
    activeDragPointerId = ev.pointerId;
    document.body.classList.add('is-dragging');
    try {
      document.body.setPointerCapture(ev.pointerId);
    } catch {
      // Ignore synthetic events without active pointer id
    }
    await window.desktopApi.beginOverlayDrag();
  });

  async function endActiveDrag(commit) {
    if (!moveMode || activeDragPointerId === null) return;
    const pid = activeDragPointerId;
    activeDragPointerId = null;
    document.body.classList.remove('is-dragging');
    try {
      if (document.body.hasPointerCapture(pid)) {
        document.body.releasePointerCapture(pid);
      }
    } catch {
      // ignore
    }
    await window.desktopApi.finishOverlayDrag({ commit });
  }

  window.addEventListener('pointerup', () => {
    endActiveDrag(true);
  });

  window.addEventListener('pointercancel', () => {
    endActiveDrag(false);
  });

  window.addEventListener('keydown', (ev) => {
    if (moveMode && ev.key === 'Escape') {
      window.desktopApi.setMoveMode(false);
    }
  });

  window.addEventListener('resize', render);

  window.desktopApi.onStateChanged((state) => {
    applyState(state);
  });

  window.desktopApi.onPoseChanged(({ pose }) => {
    if (pose && pose !== currentPose) {
      currentPose = pose;
      render();
    }
  });

  window.desktopApi.onCheckDrag(({id, localX, localY}) => {
    window.desktopApi.reportDragHit(id, !moveMode && isVisiblePixel(localX, localY));
  });

  window.desktopApi.onCheckTouch(({ localX, localY }) => {
    checkTouchAtLocalPoint(localX, localY);
  });

  window.desktopApi.getInitialState().then(applyState);

  // Read-only status & pixel test helpers for automated E2E verification
  window.__overlayStatus = () => ({
    characterId: activeCharacter?.id || null,
    characterName: activeCharacter?.name || null,
    currentPose,
    moveMode,
    bounceCount,
    bounceOffsetY,
    loadedPoses: ALL_POSE_KEYS.filter((k) => Boolean(loadedImages[k])),
  });

  window.__overlayTestCheckTouch = (localX, localY) => checkTouchAtLocalPoint(localX, localY);
})();
