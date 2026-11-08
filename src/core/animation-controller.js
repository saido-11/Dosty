'use strict';

/**
 * Independent two-hand + optional idle-blink animation state machine.
 *
 * Guarantees:
 * - Each new physical key press pulses the keyboard hand for ~85 ms and lifts automatically.
 * - Holding a key down never keeps the hand stuck down (produces only 1 strike).
 * - Pressing a second key while another key is held immediately triggers a new strike.
 * - Rapid typing performs a crisp ~22 ms rebound lift + 85 ms strike without queuing animations.
 * - Left/right mouse click pulses the mouse hand independently; overlapping pulses show 'both'.
 * - If optional blink pose is enabled, blinks every ~3–7 s for ~100–150 ms ONLY while idle.
 * - Any keyboard or mouse strike immediately interrupts an active blink with zero delay.
 * - Stores ONLY momentary boolean/active-key state in memory; never forms or logs text.
 */
class AnimationController {
  /**
   * @param {object} [options]
   * @param {number} [options.strikeMs=85]
   * @param {number} [options.reboundMs=22]
   * @param {number} [options.chordWindowMs=16]
   * @param {number} [options.blinkIntervalMinMs=3000]
   * @param {number} [options.blinkIntervalMaxMs=7000]
   * @param {number} [options.blinkDurationMinMs=100]
   * @param {number} [options.blinkDurationMaxMs=150]
   * @param {boolean} [options.hasBlinkPose=false]
   * @param {() => number} [options.random]
   * @param {(pose: 'idle'|'blink'|'keyboard'|'mouse'|'both', state: {keyboard: boolean, mouse: boolean, blinking: boolean}) => void} [options.onPoseChange]
   * @param {() => number} [options.now]
   */
  constructor(options = {}) {
    this.strikeMs = options.strikeMs ?? 85;
    this.reboundMs = options.reboundMs ?? 22;
    this.chordWindowMs = options.chordWindowMs ?? 16;

    this.blinkIntervalMinMs = options.blinkIntervalMinMs ?? 3000;
    this.blinkIntervalMaxMs = options.blinkIntervalMaxMs ?? 7000;
    this.blinkDurationMinMs = options.blinkDurationMinMs ?? 100;
    this.blinkDurationMaxMs = options.blinkDurationMaxMs ?? 150;
    this.hasBlinkPose = Boolean(options.hasBlinkPose);
    this.random = options.random ?? Math.random;

    this.onPoseChange = options.onPoseChange ?? (() => {});
    this.now = options.now ?? (() => Date.now());

    this.keyboardDown = false;
    this.mouseDown = false;
    this.blinking = false;
    this.lastKeyboardStrikeAt = 0;
    this.lastMouseStrikeAt = 0;

    this._kbReboundTimer = null;
    this._kbLiftTimer = null;
    this._mouseReboundTimer = null;
    this._mouseLiftTimer = null;
    this._blinkWaitTimer = null;
    this._blinkEndTimer = null;

    // Used only for preview/raw key event deduplication (momentary held key IDs only).
    this._heldKeys = new Set();

    this.currentPose = 'idle';
    if (this.hasBlinkPose) {
      this._scheduleNextBlinkIfIdle();
    }
  }

  getPose() {
    if (this.keyboardDown && this.mouseDown) return 'both';
    if (this.keyboardDown) return 'keyboard';
    if (this.mouseDown) return 'mouse';
    if (this.blinking && this.hasBlinkPose) return 'blink';
    return 'idle';
  }

  _randomBetween(min, max) {
    if (max <= min) return min;
    return Math.round(min + this.random() * (max - min));
  }

  _emitIfChanged() {
    const nextPose = this.getPose();
    if (nextPose !== this.currentPose) {
      this.currentPose = nextPose;
      this.onPoseChange(nextPose, {
        keyboard: this.keyboardDown,
        mouse: this.mouseDown,
        blinking: this.blinking,
      });
    }
  }

  _clearKeyboardTimers() {
    if (this._kbReboundTimer !== null) {
      clearTimeout(this._kbReboundTimer);
      this._kbReboundTimer = null;
    }
    if (this._kbLiftTimer !== null) {
      clearTimeout(this._kbLiftTimer);
      this._kbLiftTimer = null;
    }
  }

  _clearMouseTimers() {
    if (this._mouseReboundTimer !== null) {
      clearTimeout(this._mouseReboundTimer);
      this._mouseReboundTimer = null;
    }
    if (this._mouseLiftTimer !== null) {
      clearTimeout(this._mouseLiftTimer);
      this._mouseLiftTimer = null;
    }
  }

  _clearBlinkTimers() {
    if (this._blinkWaitTimer !== null) {
      clearTimeout(this._blinkWaitTimer);
      this._blinkWaitTimer = null;
    }
    if (this._blinkEndTimer !== null) {
      clearTimeout(this._blinkEndTimer);
      this._blinkEndTimer = null;
    }
  }

  _interruptBlink() {
    this._clearBlinkTimers();
    this.blinking = false;
  }

  _scheduleNextBlinkIfIdle() {
    this._clearBlinkTimers();
    if (
      !this.hasBlinkPose ||
      this.keyboardDown ||
      this.mouseDown ||
      this._kbReboundTimer !== null ||
      this._mouseReboundTimer !== null
    ) {
      return;
    }

    const waitMs = this._randomBetween(this.blinkIntervalMinMs, this.blinkIntervalMaxMs);
    this._blinkWaitTimer = setTimeout(() => {
      this._blinkWaitTimer = null;
      if (!this.hasBlinkPose || this.keyboardDown || this.mouseDown) {
        return;
      }
      this.blinking = true;
      this._emitIfChanged();

      const durationMs = this._randomBetween(this.blinkDurationMinMs, this.blinkDurationMaxMs);
      this._blinkEndTimer = setTimeout(() => {
        this._blinkEndTimer = null;
        this.blinking = false;
        this._emitIfChanged();
        this._scheduleNextBlinkIfIdle();
      }, durationMs);
    }, waitMs);
  }

  /**
   * Enables or disables automatic idle blinking based on whether active character has a 5th blink PNG.
   * @param {boolean} enabled
   */
  setBlinkEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.hasBlinkPose === next) {
      if (next && !this._blinkWaitTimer && !this._blinkEndTimer && !this.keyboardDown && !this.mouseDown) {
        this._scheduleNextBlinkIfIdle();
      }
      return;
    }
    this.hasBlinkPose = next;
    if (!next) {
      this._interruptBlink();
      this._emitIfChanged();
    } else {
      this._scheduleNextBlinkIfIdle();
    }
  }

  /**
   * Triggers a single ~85 ms keyboard hand strike without queuing.
   * Immediately interrupts any active blink.
   */
  triggerKeyboard() {
    const ts = this.now();
    this._interruptBlink();
    this._clearKeyboardTimers();

    const elapsedSinceLast = ts - this.lastKeyboardStrikeAt;
    if (this.keyboardDown && elapsedSinceLast >= this.chordWindowMs && this.reboundMs > 0) {
      this.keyboardDown = false;
      this._emitIfChanged();

      this._kbReboundTimer = setTimeout(() => {
        this._kbReboundTimer = null;
        this.keyboardDown = true;
        this.lastKeyboardStrikeAt = this.now();
        this._emitIfChanged();

        this._kbLiftTimer = setTimeout(() => {
          this._kbLiftTimer = null;
          this.keyboardDown = false;
          this._emitIfChanged();
          this._scheduleNextBlinkIfIdle();
        }, this.strikeMs);
      }, this.reboundMs);
      return;
    }

    this.keyboardDown = true;
    this.lastKeyboardStrikeAt = ts;
    this._emitIfChanged();

    this._kbLiftTimer = setTimeout(() => {
      this._kbLiftTimer = null;
      this.keyboardDown = false;
      this._emitIfChanged();
      this._scheduleNextBlinkIfIdle();
    }, this.strikeMs);
  }

  /**
   * Triggers a single ~85 ms mouse hand strike without queuing.
   * Immediately interrupts any active blink.
   */
  triggerMouse() {
    const ts = this.now();
    this._interruptBlink();
    this._clearMouseTimers();

    const elapsedSinceLast = ts - this.lastMouseStrikeAt;
    if (this.mouseDown && elapsedSinceLast >= this.chordWindowMs && this.reboundMs > 0) {
      this.mouseDown = false;
      this._emitIfChanged();

      this._mouseReboundTimer = setTimeout(() => {
        this._mouseReboundTimer = null;
        this.mouseDown = true;
        this.lastMouseStrikeAt = this.now();
        this._emitIfChanged();

        this._mouseLiftTimer = setTimeout(() => {
          this._mouseLiftTimer = null;
          this.mouseDown = false;
          this._emitIfChanged();
          this._scheduleNextBlinkIfIdle();
        }, this.strikeMs);
      }, this.reboundMs);
      return;
    }

    this.mouseDown = true;
    this.lastMouseStrikeAt = ts;
    this._emitIfChanged();

    this._mouseLiftTimer = setTimeout(() => {
      this._mouseLiftTimer = null;
      this.mouseDown = false;
      this._emitIfChanged();
      this._scheduleNextBlinkIfIdle();
    }, this.strikeMs);
  }

  /**
   * Handles physical key-down with auto-repeat suppression.
   * @param {string|number} physicalKeyId
   * @param {boolean} [isRepeat=false]
   */
  handlePhysicalKeyDown(physicalKeyId, isRepeat = false) {
    if (isRepeat || this._heldKeys.has(physicalKeyId)) {
      return false;
    }
    this._heldKeys.add(physicalKeyId);
    this.triggerKeyboard();
    return true;
  }

  /**
   * Releases held physical key state.
   * @param {string|number} physicalKeyId
   */
  handlePhysicalKeyUp(physicalKeyId) {
    this._heldKeys.delete(physicalKeyId);
  }

  /**
   * Handles mouse button press (0 = left, 2 = right). Mouse move is never accepted.
   * @param {number} button
   */
  handleMouseButtonDown(button) {
    if (button === 0 || button === 2) {
      this.triggerMouse();
      return true;
    }
    return false;
  }

  reset() {
    this._clearKeyboardTimers();
    this._clearMouseTimers();
    this._interruptBlink();
    this._heldKeys.clear();
    this.keyboardDown = false;
    this.mouseDown = false;
    this._emitIfChanged();
  }
}

module.exports = { AnimationController };
