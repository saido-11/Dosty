'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { AnimationController } = require('../src/core/animation-controller');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('AnimationController', () => {
  it('pulses keyboard pose for ~85ms and returns automatically to idle', async () => {
    const history = [];
    const ctrl = new AnimationController({
      strikeMs: 60,
      reboundMs: 15,
      onPoseChange: (pose) => history.push(pose),
    });

    assert.equal(ctrl.getPose(), 'idle');
    ctrl.handlePhysicalKeyDown('KeyF', false);
    assert.equal(ctrl.getPose(), 'keyboard');

    await sleep(90);
    assert.equal(ctrl.getPose(), 'idle');
    ctrl.handlePhysicalKeyUp('KeyF');
    assert.deepEqual(history, ['keyboard', 'idle']);
    ctrl.reset();
  });

  it('holding W produces only one strike and pressing A while W is held triggers a second strike', async () => {
    const history = [];
    const ctrl = new AnimationController({
      strikeMs: 50,
      reboundMs: 15,
      onPoseChange: (pose) => history.push(pose),
    });

    assert.equal(ctrl.handlePhysicalKeyDown('KeyW', false), true);
    assert.equal(ctrl.getPose(), 'keyboard');

    for (let i = 0; i < 8; i++) {
      await sleep(12);
      assert.equal(ctrl.handlePhysicalKeyDown('KeyW', true), false);
      assert.equal(ctrl.handlePhysicalKeyDown('KeyW', false), false);
    }

    assert.equal(ctrl.getPose(), 'idle');

    assert.equal(ctrl.handlePhysicalKeyDown('KeyA', false), true);
    assert.equal(ctrl.getPose(), 'keyboard');

    await sleep(75);
    assert.equal(ctrl.getPose(), 'idle');

    ctrl.handlePhysicalKeyUp('KeyW');
    ctrl.handlePhysicalKeyUp('KeyA');

    assert.deepEqual(history, ['keyboard', 'idle', 'keyboard', 'idle']);
    ctrl.reset();
  });

  it('rapid typing re-strikes visibly without building up an animation queue', async () => {
    const history = [];
    const ctrl = new AnimationController({
      strikeMs: 65,
      reboundMs: 18,
      chordWindowMs: 10,
      onPoseChange: (pose) => history.push(pose),
    });

    const keys = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'];
    for (const code of keys) {
      ctrl.handlePhysicalKeyDown(code, false);
      await sleep(25);
      ctrl.handlePhysicalKeyUp(code);
    }

    await sleep(105);
    assert.equal(ctrl.getPose(), 'idle');
    assert.ok(history.filter((p) => p === 'keyboard').length >= 2);
    ctrl.reset();
  });

  it('manages keyboard and mouse hands independently and shows both on overlap', async () => {
    const history = [];
    const ctrl = new AnimationController({
      strikeMs: 70,
      reboundMs: 15,
      onPoseChange: (pose) => history.push(pose),
    });

    assert.equal(ctrl.handleMouseButtonDown(1), false);
    assert.equal(ctrl.getPose(), 'idle');

    assert.equal(ctrl.handleMouseButtonDown(0), true);
    assert.equal(ctrl.getPose(), 'mouse');

    await sleep(20);
    ctrl.handlePhysicalKeyDown('Space', false);
    assert.equal(ctrl.getPose(), 'both');

    await sleep(110);
    assert.equal(ctrl.getPose(), 'idle');
    assert.ok(history.includes('mouse'));
    assert.ok(history.includes('both'));
    assert.equal(history.at(-1), 'idle');
    ctrl.reset();
  });

  it('does not blink for 4-PNG characters without blink pose, and blinks while idle for 5-PNG characters', async () => {
    const fourPngHistory = [];
    const fourCtrl = new AnimationController({
      hasBlinkPose: false,
      blinkIntervalMinMs: 40,
      blinkIntervalMaxMs: 50,
      blinkDurationMinMs: 30,
      blinkDurationMaxMs: 40,
      onPoseChange: (p) => fourPngHistory.push(p),
    });
    await sleep(120);
    assert.deepEqual(fourPngHistory, []);
    fourCtrl.reset();

    // Check default timing parameters match 3-7s and 100-150ms spec
    const defaultCtrl = new AnimationController();
    assert.equal(defaultCtrl.blinkIntervalMinMs, 3000);
    assert.equal(defaultCtrl.blinkIntervalMaxMs, 7000);
    assert.equal(defaultCtrl.blinkDurationMinMs, 100);
    assert.equal(defaultCtrl.blinkDurationMaxMs, 150);
    defaultCtrl.reset();

    const fivePngHistory = [];
    const fiveCtrl = new AnimationController({
      hasBlinkPose: true,
      blinkIntervalMinMs: 45,
      blinkIntervalMaxMs: 55,
      blinkDurationMinMs: 110,
      blinkDurationMaxMs: 130,
      random: () => 0.5,
      onPoseChange: (p) => fivePngHistory.push(p),
    });

    await sleep(75);
    assert.equal(fiveCtrl.getPose(), 'blink');
    await sleep(140);
    assert.equal(fiveCtrl.getPose(), 'idle');
    assert.deepEqual(fivePngHistory.slice(0, 2), ['blink', 'idle']);
    fiveCtrl.reset();
  });

  it('immediately interrupts an active blink when a key press or mouse click arrives', async () => {
    const history = [];
    const ctrl = new AnimationController({
      strikeMs: 60,
      hasBlinkPose: true,
      blinkIntervalMinMs: 35,
      blinkIntervalMaxMs: 40,
      blinkDurationMinMs: 140,
      blinkDurationMaxMs: 150,
      onPoseChange: (p) => history.push(p),
    });

    // Wait until character is right in the middle of blinking
    await sleep(55);
    assert.equal(ctrl.getPose(), 'blink');

    // Key press arrives MID-BLINK -> must immediately switch to 'keyboard' with 0ms delay!
    ctrl.handlePhysicalKeyDown('KeyE', false);
    assert.equal(ctrl.getPose(), 'keyboard');
    assert.equal(ctrl.blinking, false);

    // Wait for keyboard strike to finish -> returns cleanly to 'idle' (not stuck in 'blink')
    await sleep(85);
    assert.equal(ctrl.getPose(), 'idle');
    ctrl.handlePhysicalKeyUp('KeyE');

    // Wait for next blink, then interrupt mid-blink with a mouse click!
    await sleep(55);
    assert.equal(ctrl.getPose(), 'blink');
    ctrl.handleMouseButtonDown(0);
    assert.equal(ctrl.getPose(), 'mouse');
    assert.equal(ctrl.blinking, false);

    await sleep(85);
    assert.equal(ctrl.getPose(), 'idle');
    assert.deepEqual(history, ['blink', 'keyboard', 'idle', 'blink', 'mouse', 'idle']);
    ctrl.reset();
  });
});
