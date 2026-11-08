'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {DirectDrag} = require('../src/core/direct-drag');

test('direct drag requires a visible-pixel hit and movement; commits only on release', () => {
  const moved=[];let saved=0;
  const d=new DirectDrag({onMove:b=>moved.push(b),onEnd:()=>saved++});
  const bounds={x:100,y:200,width:240,height:240};
  let id=d.press({x:140,y:240},bounds);
  d.confirmHit(id,true);d.move({x:142,y:242});d.release();
  assert.equal(moved.length,0);assert.equal(saved,0);
  id=d.press({x:140,y:240},bounds);d.confirmHit(id,false);
  d.move({x:300,y:400});d.release();assert.equal(saved,0);
  id=d.press({x:140,y:240},bounds);d.confirmHit(id,true);
  d.move({x:240,y:300});assert.deepEqual(moved.at(-1),{...bounds,x:200,y:260});
  assert.equal(saved,0);d.release();assert.equal(saved,1);
  // A delayed hit-test reply after mouse-up must not latch a future drag.
  d.confirmHit(id,true);d.move({x:900,y:900});assert.equal(moved.length,1);
  id=d.press({x:140,y:240},bounds);d.confirmHit(id-1,true);
  d.move({x:900,y:900});d.release();assert.equal(saved,1);
});

test('input bridge left-button protocol is separate from ordinary mouse strikes', () => {
  const {InputMonitor}=require('../src/main/input-monitor');
  const buttons=[];let strikes=0;
  const monitor=new InputMonitor({binDir:'',onMouse:()=>strikes++,onMouseButtonChange:down=>buttons.push(down)});
  for(const line of ['L:1','M','L:0','M']) monitor._handleLine(line);
  assert.deepEqual(buttons,[true,false]);assert.equal(strikes,2);
});
