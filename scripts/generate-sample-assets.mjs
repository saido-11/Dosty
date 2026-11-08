import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// CRC32 table for PNG chunk encoding
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // Filter type 0 (None)
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

class Canvas2D {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4);
  }

  blendPixel(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || a <= 0) return;
    const idx = (y * this.width + x) * 4;
    const srcA = Math.min(1, Math.max(0, a / 255));
    const dstA = this.data[idx + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;

    this.data[idx] = Math.round((r * srcA + this.data[idx] * dstA * (1 - srcA)) / outA);
    this.data[idx + 1] = Math.round((g * srcA + this.data[idx + 1] * dstA * (1 - srcA)) / outA);
    this.data[idx + 2] = Math.round((b * srcA + this.data[idx + 2] * dstA * (1 - srcA)) / outA);
    this.data[idx + 3] = Math.round(outA * 255);
  }

  fillCircle(cx, cy, radius, [r, g, b, a = 255]) {
    const minX = Math.floor(cx - radius - 1);
    const maxX = Math.ceil(cx + radius + 1);
    const minY = Math.floor(cy - radius - 1);
    const maxY = Math.ceil(cy + radius + 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const cov = Math.min(1, Math.max(0, radius + 0.5 - dist));
        if (cov > 0) this.blendPixel(x, y, r, g, b, a * cov);
      }
    }
  }

  fillEllipse(cx, cy, rx, ry, [r, g, b, a = 255]) {
    const minX = Math.floor(cx - rx - 2);
    const maxX = Math.ceil(cx + rx + 2);
    const minY = Math.floor(cy - ry - 2);
    const maxY = Math.ceil(cy + ry + 2);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        const d = Math.hypot(nx, ny);
        const edge = 1 / Math.min(rx, ry);
        const cov = Math.min(1, Math.max(0, (1 + edge * 0.5 - d) / edge));
        if (cov > 0) this.blendPixel(x, y, r, g, b, a * cov);
      }
    }
  }

  fillRoundRect(rx, ry, rw, rh, rad, [r, g, b, a = 255]) {
    const minX = Math.floor(rx - 1);
    const maxX = Math.ceil(rx + rw + 1);
    const minY = Math.floor(ry - 1);
    const maxY = Math.ceil(ry + rh + 1);
    const cr = Math.min(rad, rw / 2, rh / 2);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const qx = Math.max(rx + cr - px, 0, px - (rx + rw - cr));
        const qy = Math.max(ry + cr - py, 0, py - (ry + rh - cr));
        const dist = Math.hypot(qx, qy) - cr;
        const cov = Math.min(1, Math.max(0, 0.5 - dist));
        if (cov > 0) this.blendPixel(x, y, r, g, b, a * cov);
      }
    }
  }

  fillTriangle(x1, y1, x2, y2, x3, y3, [r, g, b, a = 255]) {
    const minX = Math.floor(Math.min(x1, x2, x3) - 1);
    const maxX = Math.ceil(Math.max(x1, x2, x3) + 1);
    const minY = Math.floor(Math.min(y1, y2, y3) - 1);
    const maxY = Math.ceil(Math.max(y1, y2, y3) + 1);
    const area = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
    if (Math.abs(area) < 1e-5) return;
    const sign = area > 0 ? 1 : -1;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let inside = 0;
        for (let sy = 0.25; sy <= 0.75; sy += 0.5) {
          for (let sx = 0.25; sx <= 0.75; sx += 0.5) {
            const px = x + sx;
            const py = y + sy;
            const w1 = ((x2 - px) * (y3 - py) - (x3 - px) * (y2 - py)) * sign;
            const w2 = ((x3 - px) * (y1 - py) - (x1 - px) * (y3 - py)) * sign;
            const w3 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * sign;
            if (w1 >= 0 && w2 >= 0 && w3 >= 0) inside++;
          }
        }
        if (inside > 0) this.blendPixel(x, y, r, g, b, (a * inside) / 4);
      }
    }
  }

  drawCapsule(x1, y1, x2, y2, thickness, [r, g, b, a = 255]) {
    const rad = thickness / 2;
    const minX = Math.floor(Math.min(x1, x2) - rad - 2);
    const maxX = Math.ceil(Math.max(x1, x2) + rad + 2);
    const minY = Math.floor(Math.min(y1, y2) - rad - 2);
    const maxY = Math.ceil(Math.max(y1, y2) + rad + 2);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq)) : 0;
        const cx = x1 + t * dx;
        const cy = y1 + t * dy;
        const dist = Math.hypot(px - cx, py - cy);
        const cov = Math.min(1, Math.max(0, rad + 0.5 - dist));
        if (cov > 0) this.blendPixel(x, y, r, g, b, a * cov);
      }
    }
  }

  toPngBuffer() {
    return encodePng(this.width, this.height, this.data);
  }
}

export function drawSampleCharacterPose({
  keyboardDown = false,
  mouseDown = false,
  eyesClosed = false,
} = {}) {
  const c = new Canvas2D(512, 512);

  const outline = [38, 43, 68, 255];
  const bodyCream = [252, 247, 238, 255];
  const mintPatch = [142, 229, 206, 255];
  const blush = [255, 163, 177, 190];
  const earInner = [255, 176, 189, 255];
  const coral = [255, 107, 107, 255];
  const coralDark = [214, 73, 88, 255];
  const deskMat = [46, 53, 82, 238];
  const deskRim = [86, 98, 145, 255];
  const kbBody = [64, 74, 110, 255];
  const keyIdle = [225, 232, 247, 255];
  const keyActive = [110, 242, 198, 255];
  const mouseBody = [232, 238, 250, 255];
  const spark = [255, 217, 90, 255];

  // Headphones band behind head
  c.fillEllipse(256, 192, 142, 118, coralDark);
  c.fillEllipse(256, 198, 126, 104, [0, 0, 0, 0]); // visual layering handled by head over it

  // Left & Right Cat Ears (fixed position across all 4 frames!)
  c.fillTriangle(136, 190, 152, 82, 224, 144, outline);
  c.fillTriangle(146, 184, 158, 96, 216, 146, bodyCream);
  c.fillTriangle(156, 176, 163, 114, 205, 150, earInner);

  c.fillTriangle(376, 190, 360, 82, 288, 144, outline);
  c.fillTriangle(366, 184, 354, 96, 296, 146, mintPatch);
  c.fillTriangle(356, 176, 349, 114, 307, 150, earInner);

  // Head & Torso (100% locked across frames so body never shifts)
  c.fillEllipse(256, 248, 136, 118, outline);
  c.fillEllipse(256, 248, 127, 109, bodyCream);

  // Cute mint forehead spot
  c.fillEllipse(302, 172, 48, 30, mintPatch);

  // Headphone earcups
  c.fillRoundRect(102, 192, 34, 76, 16, outline);
  c.fillRoundRect(107, 197, 24, 66, 12, coral);
  c.fillRoundRect(376, 192, 34, 76, 16, outline);
  c.fillRoundRect(381, 197, 24, 66, 12, coral);

  // Cheeks
  c.fillEllipse(184, 258, 22, 13, blush);
  c.fillEllipse(328, 258, 22, 13, blush);

  // Eyes
  if (keyboardDown && mouseDown) {
    // Excited > < eyes when both hands strike simultaneously
    c.drawCapsule(192, 224, 214, 236, 8, outline);
    c.drawCapsule(214, 236, 192, 248, 8, outline);
    c.drawCapsule(320, 224, 298, 236, 8, outline);
    c.drawCapsule(298, 236, 320, 248, 8, outline);
  } else if (eyesClosed && !keyboardDown && !mouseDown) {
    // Calm closed eyelids (blink frame of idle pose)
    c.drawCapsule(190, 237, 204, 242, 7.5, outline);
    c.drawCapsule(204, 242, 218, 237, 7.5, outline);
    c.drawCapsule(294, 237, 308, 242, 7.5, outline);
    c.drawCapsule(308, 242, 322, 237, 7.5, outline);
  } else {
    c.fillCircle(204, 235, 13, outline);
    c.fillCircle(200, 230, 4.5, [255, 255, 255, 255]);
    c.fillCircle(308, 235, 13, outline);
    c.fillCircle(304, 230, 4.5, [255, 255, 255, 255]);
  }

  // Little cat mouth (:3)
  c.drawCapsule(244, 256, 256, 264, 6, outline);
  c.drawCapsule(256, 264, 268, 256, 6, outline);

  // Floating desk mat (fixed across all frames)
  c.fillRoundRect(48, 336, 416, 132, 34, outline);
  c.fillRoundRect(55, 343, 402, 118, 29, deskMat);
  c.fillRoundRect(64, 350, 384, 6, 3, deskRim);

  // Mouse device on viewer's LEFT (character's right paw)
  c.fillRoundRect(92, 372, 92, 68, 28, outline);
  c.fillRoundRect(97, 377, 82, 58, 24, mouseBody);
  // Left/right click button highlight when mouseDown
  if (mouseDown) {
    c.fillRoundRect(101, 380, 36, 24, 10, coral);
  }
  c.drawCapsule(138, 380, 138, 404, 4, outline);

  // Mechanical keyboard on viewer's RIGHT (character's left paw)
  c.fillRoundRect(230, 368, 202, 76, 18, outline);
  c.fillRoundRect(236, 374, 190, 64, 14, kbBody);

  // Keycaps row 1 & row 2
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 5; col++) {
      const kx = 248 + col * 34;
      const ky = 383 + row * 25;
      const isPressedKey = keyboardDown && row === 0 && (col === 1 || col === 2);
      c.fillRoundRect(
        kx,
        isPressedKey ? ky + 3 : ky,
        28,
        19,
        5,
        isPressedKey ? keyActive : keyIdle
      );
    }
  }

  // --- PAW 1: Mouse Paw (viewer's left, independent!) ---
  if (!mouseDown) {
    // Resting elevated above mouse
    c.drawCapsule(168, 314, 142, 344, 42, outline);
    c.drawCapsule(168, 314, 142, 344, 31, bodyCream);
    c.fillCircle(138, 347, 10, earInner);
  } else {
    // Pressing firmly onto mouse + crisp visual click burst!
    c.drawCapsule(168, 320, 136, 392, 42, outline);
    c.drawCapsule(168, 320, 136, 392, 31, bodyCream);
    // Click action lines
    c.drawCapsule(74, 366, 90, 376, 6, spark);
    c.drawCapsule(70, 392, 86, 394, 6, spark);
    c.drawCapsule(86, 346, 98, 362, 6, coral);
  }

  // --- PAW 2: Keyboard Paw (viewer's right, independent!) ---
  if (!keyboardDown) {
    // Resting elevated above keyboard
    c.drawCapsule(344, 314, 322, 344, 42, outline);
    c.drawCapsule(344, 314, 322, 344, 31, mintPatch);
    c.fillCircle(320, 347, 10, earInner);
  } else {
    // Striking keyboard keycaps + crisp strike burst!
    c.drawCapsule(344, 320, 312, 392, 42, outline);
    c.drawCapsule(344, 320, 312, 392, 31, mintPatch);
    // Key strike sparks
    c.drawCapsule(282, 346, 294, 362, 6, spark);
    c.drawCapsule(338, 344, 330, 362, 6, keyActive);
    c.drawCapsule(358, 358, 344, 370, 6, spark);
  }

  return c.toPngBuffer();
}

function drawAppIcon() {
  const c = new Canvas2D(512, 512);
  c.fillRoundRect(24, 24, 464, 464, 112, [33, 39, 66, 255]);
  c.fillRoundRect(38, 38, 436, 436, 98, [50, 60, 99, 255]);
  const cat = drawSampleCharacterPose({ keyboardDown: true, mouseDown: false });
  // Composite character pose into icon
  // Simpler: draw directly on top using same primitives at center
  c.fillCircle(256, 248, 176, [72, 86, 138, 140]);
  c.fillTriangle(148, 198, 162, 98, 228, 152, [38, 43, 68, 255]);
  c.fillTriangle(157, 192, 168, 112, 220, 154, [252, 247, 238, 255]);
  c.fillTriangle(364, 198, 350, 98, 284, 152, [38, 43, 68, 255]);
  c.fillTriangle(355, 192, 344, 112, 292, 154, [142, 229, 206, 255]);
  c.fillEllipse(256, 260, 126, 108, [38, 43, 68, 255]);
  c.fillEllipse(256, 260, 116, 98, [252, 247, 238, 255]);
  c.fillCircle(208, 248, 13, [38, 43, 68, 255]);
  c.fillCircle(304, 248, 13, [38, 43, 68, 255]);
  c.drawCapsule(244, 270, 256, 278, 6, [38, 43, 68, 255]);
  c.drawCapsule(256, 278, 268, 270, 6, [38, 43, 68, 255]);
  c.fillRoundRect(116, 366, 280, 64, 20, [110, 242, 198, 255]);
  for (let i = 0; i < 5; i++) {
    c.fillRoundRect(136 + i * 50, 382, 38, 32, 8, [38, 43, 68, 255]);
  }
  void cat;
  return c.toPngBuffer();
}

function drawTrayIcon(size, monochrome = false) {
  const c = new Canvas2D(size, size);
  const s = size / 36;
  const fg = monochrome ? [0, 0, 0, 255] : [110, 242, 198, 255];
  const bg = monochrome ? [0, 0, 0, 220] : [38, 43, 68, 255];

  c.fillTriangle(6 * s, 16 * s, 9 * s, 5 * s, 16 * s, 12 * s, fg);
  c.fillTriangle(30 * s, 16 * s, 27 * s, 5 * s, 20 * s, 12 * s, fg);
  c.fillEllipse(18 * s, 20 * s, 11 * s, 9.5 * s, fg);
  if (!monochrome) {
    c.fillCircle(14 * s, 19 * s, 1.8 * s, bg);
    c.fillCircle(22 * s, 19 * s, 1.8 * s, bg);
  } else {
    // Cut out eyes for crisp macOS template silhouette
    for (const ex of [14 * s, 22 * s]) {
      const r = Math.max(1.4, 2.0 * s);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (Math.hypot(x + 0.5 - ex, y + 0.5 - 19.5 * s) <= r) {
            const idx = (y * size + x) * 4;
            c.data[idx + 3] = 0;
          }
        }
      }
    }
  }
  c.fillRoundRect(5 * s, 29 * s, 26 * s, 4 * s, 2 * s, fg);
  return c.toPngBuffer();
}

export function generateAllSampleAssets(targetRoot = rootDir) {
  const morKediManifest = path.join(targetRoot, 'resources', 'characters', 'mor-kedi', 'character.json');
  const charDir = path.join(targetRoot, 'resources', 'characters', 'minti-kedi');
  const iconsDir = path.join(targetRoot, 'resources', 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });

  if (!fs.existsSync(morKediManifest)) {
    fs.mkdirSync(charDir, { recursive: true });

    fs.writeFileSync(
      path.join(charDir, 'idle.png'),
      drawSampleCharacterPose({ keyboardDown: false, mouseDown: false })
    );
    fs.writeFileSync(
      path.join(charDir, 'keyboard.png'),
      drawSampleCharacterPose({ keyboardDown: true, mouseDown: false })
    );
    fs.writeFileSync(
      path.join(charDir, 'mouse.png'),
      drawSampleCharacterPose({ keyboardDown: false, mouseDown: true })
    );
    fs.writeFileSync(
      path.join(charDir, 'both.png'),
      drawSampleCharacterPose({ keyboardDown: true, mouseDown: true })
    );
    fs.writeFileSync(
      path.join(charDir, 'blink.png'),
      drawSampleCharacterPose({ keyboardDown: false, mouseDown: false, eyesClosed: true })
    );

    const metadata = {
      id: 'minti-kedi',
      name: 'Minti Kedi (Örnek)',
      builtIn: true,
      poses: {
        idle: 'idle.png',
        keyboard: 'keyboard.png',
        mouse: 'mouse.png',
        both: 'both.png',
        blink: 'blink.png',
      },
      offsets: {
        idle: { x: 0, y: 0 },
        keyboard: { x: 0, y: 0 },
        mouse: { x: 0, y: 0 },
        both: { x: 0, y: 0 },
        blink: { x: 0, y: 0 },
      },
    };
    fs.writeFileSync(path.join(charDir, 'character.json'), JSON.stringify(metadata, null, 2) + '\n');
  }

  const appIconPath = path.join(iconsDir, 'app-icon.png');
  if (!fs.existsSync(appIconPath)) {
    fs.writeFileSync(appIconPath, drawAppIcon());
  }
  const trayTemplatePath = path.join(iconsDir, 'trayTemplate.png');
  if (!fs.existsSync(trayTemplatePath)) {
    fs.writeFileSync(trayTemplatePath, drawTrayIcon(18, true));
  }
  const trayTemplate2xPath = path.join(iconsDir, 'trayTemplate@2x.png');
  if (!fs.existsSync(trayTemplate2xPath)) {
    fs.writeFileSync(trayTemplate2xPath, drawTrayIcon(36, true));
  }
  const trayColorPath = path.join(iconsDir, 'tray-color.png');
  if (!fs.existsSync(trayColorPath)) {
    fs.writeFileSync(trayColorPath, drawTrayIcon(32, false));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.join(rootDir, 'out', 'legacy-sample-assets');
  generateAllSampleAssets(target);
  console.log('[generate:assets] Özgün örnek karakter ve uygulama ikonları oluşturuldu.');
}
