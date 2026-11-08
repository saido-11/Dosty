'use strict';

// Recognizes a drag from anonymous global left-button events. Ordinary clicks
// remain click-through; only a visible-pixel hit followed by movement moves the pet.
class DirectDrag {
  constructor({ onMove, onEnd, threshold = 6 }) {
    this.onMove = onMove;
    this.onEnd = onEnd;
    this.threshold = threshold;
    this.sequence = 0;
    this.session = null;
  }
  press(point, bounds) {
    this.cancel();
    const id = ++this.sequence;
    this.session = { id, point: {...point}, bounds: {...bounds}, hit: false, moved: false };
    return id;
  }
  confirmHit(id, hit) {
    if (this.session?.id === id) this.session.hit = Boolean(hit);
  }
  move(point) {
    const s = this.session;
    if (!s?.hit) return false;
    const dx = point.x - s.point.x, dy = point.y - s.point.y;
    if (!s.moved && Math.hypot(dx, dy) < this.threshold) return false;
    s.moved = true;
    this.onMove({ x: s.bounds.x + dx, y: s.bounds.y + dy, width: s.bounds.width, height: s.bounds.height });
    return true;
  }
  release() {
    const s = this.session;
    this.session = null;
    if (s?.moved) this.onEnd();
  }
  cancel() { this.session = null; }
}
module.exports = { DirectDrag };
