'use strict';

const crypto = require('node:crypto');
const { normalizeLanguage, translate } = require('../i18n');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const POSE_KEYS = ['idle', 'keyboard', 'mouse', 'both'];
const OPTIONAL_POSE_KEYS = ['blink'];
const ALL_POSE_KEYS = [...POSE_KEYS, ...OPTIONAL_POSE_KEYS];

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const VALID_CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

function isPngBuffer(buf) {
  return Buffer.isBuffer(buf) && buf.length > 24 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

function readPngDimensions(buf, language = 'tr') {
  if (!isPngBuffer(buf)) {
    throw new Error(translate(language, 'invalidPngFileUploadATransparentOr'));
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function slugify(input) {
  const ascii = String(input || '')
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return ascii || 'karakter';
}

function normalizeOffsets(offsets = {}) {
  const result = {};
  for (const key of POSE_KEYS) {
    const raw = offsets?.[key] || {};
    result[key] = {
      x: Number.isFinite(Number(raw.x)) ? Math.round(Number(raw.x)) : 0,
      y: Number.isFinite(Number(raw.y)) ? Math.round(Number(raw.y)) : 0,
    };
  }
  const rawBlink = offsets?.blink;
  if (rawBlink && typeof rawBlink === 'object') {
    result.blink = {
      x: Number.isFinite(Number(rawBlink.x)) ? Math.round(Number(rawBlink.x)) : result.idle.x,
      y: Number.isFinite(Number(rawBlink.y)) ? Math.round(Number(rawBlink.y)) : result.idle.y,
    };
  } else {
    result.blink = { ...result.idle };
  }
  return result;
}

class CharacterStore {
  /**
   * @param {object} options
   * @param {string} options.builtInCharactersDir
   * @param {string} options.userDataDir
   */
  constructor({ builtInCharactersDir, userDataDir, systemLocale = 'tr' }) {
    this.builtInCharactersDir = builtInCharactersDir;
    this.userDataDir = userDataDir;
    this.userCharactersDir = path.join(userDataDir, 'characters');
    this.settingsPath = path.join(userDataDir, 'settings.json');

    const existingUser = fs.existsSync(this.settingsPath) ||
      (fs.existsSync(this.userCharactersDir) && fs.readdirSync(this.userCharactersDir).length > 0);
    this.defaultLanguage = existingUser ? 'tr' : normalizeLanguage(systemLocale);
    fs.mkdirSync(this.userCharactersDir, { recursive: true });
  }

  t(key, params) { return translate(this.getSettings().language, key, params); }

  _scanDirectory(baseDir, builtIn) {
    if (!baseDir || !fs.existsSync(baseDir)) return [];
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    const list = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderPath = path.join(baseDir, entry.name);
      const manifestPath = path.join(folderPath, 'character.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const poses = {};
        const posePaths = {};
        let valid = true;

        for (const key of POSE_KEYS) {
          const relFile = raw?.poses?.[key];
          if (!relFile || typeof relFile !== 'string') {
            valid = false;
            break;
          }
          const resolved = path.resolve(folderPath, relFile);
          if (!resolved.startsWith(path.resolve(folderPath) + path.sep) || !fs.existsSync(resolved)) {
            valid = false;
            break;
          }
          posePaths[key] = resolved;
          poses[key] = pathToFileURL(resolved).href;
        }

        if (!valid) continue;

        // Optional 5th pose: blink (eyes closed idle)
        const relBlink = raw?.poses?.blink;
        if (relBlink && typeof relBlink === 'string') {
          const resolvedBlink = path.resolve(folderPath, relBlink);
          if (
            resolvedBlink.startsWith(path.resolve(folderPath) + path.sep) &&
            fs.existsSync(resolvedBlink)
          ) {
            posePaths.blink = resolvedBlink;
            poses.blink = pathToFileURL(resolvedBlink).href;
          } else {
            posePaths.blink = null;
            poses.blink = null;
          }
        } else {
          posePaths.blink = null;
          poses.blink = null;
        }

        list.push({
          id: String(raw.id || entry.name),
          folderName: entry.name,
          name: String(raw.name || entry.name),
          builtIn: Boolean(builtIn || raw.builtInOrigin),
          createdAt: raw.updatedAt || raw.createdAt || null,
          hasBlink: Boolean(poses.blink),
          poses,
          posePaths,
          offsets: normalizeOffsets(raw.offsets),
        });
      } catch {
        // Ignore malformed folder without crashing startup
      }
    }

    list.sort((a, b) => {
      if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
      if (a.createdAt && b.createdAt) return a.createdAt.localeCompare(b.createdAt);
      return a.name.localeCompare(b.name, 'tr');
    });

    return list;
  }

  listCharacters() {
    const builtIn = this._scanDirectory(this.builtInCharactersDir, true);
    const custom = this._scanDirectory(this.userCharactersDir, false);
    const customById = new Map(custom.map((item) => [item.id, item]));
    const seen = new Set();
    const merged = [];

    for (const item of builtIn) {
      if (customById.has(item.id)) {
        const override = customById.get(item.id);
        merged.push({ ...override, builtIn: true });
      } else {
        merged.push(item);
      }
      seen.add(item.id);
    }

    for (const item of custom) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
    return merged;
  }

  getCharacter(id) {
    const all = this.listCharacters();
    if (!all.length) return null;
    return all.find((c) => c.id === id) || all[0];
  }

  _extractPngBytes(poseInput) {
    if (!poseInput) {
      throw new Error(this.t('aPoseImageIsMissing'));
    }

    if (Buffer.isBuffer(poseInput)) {
      readPngDimensions(poseInput, this.getSettings().language);
      return poseInput;
    }

    if (poseInput instanceof Uint8Array) {
      const buf = Buffer.from(poseInput);
      readPngDimensions(buf, this.getSettings().language);
      return buf;
    }

    if (typeof poseInput === 'object') {
      if (poseInput.buffer) {
        const buf = Buffer.from(poseInput.buffer);
        readPngDimensions(buf, this.getSettings().language);
        return buf;
      }
      if (
        typeof poseInput.sourcePath === 'string' &&
        poseInput.sourcePath.trim() &&
        fs.existsSync(poseInput.sourcePath)
      ) {
        const buf = fs.readFileSync(poseInput.sourcePath);
        readPngDimensions(buf, this.getSettings().language);
        return buf;
      }
      if (typeof poseInput.dataUrl === 'string') {
        const prefix = 'data:image/png;base64,';
        if (!poseInput.dataUrl.startsWith(prefix)) {
          throw new Error(this.t('onlyPngImagesAreSupported'));
        }
        const buf = Buffer.from(poseInput.dataUrl.slice(prefix.length), 'base64');
        readPngDimensions(buf, this.getSettings().language);
        return buf;
      }
    }

    throw new Error(this.t('invalidImageData'));
  }

  nextDefaultName() {
    const existing = this.listCharacters().filter((c) => !c.builtIn);
    return this.t('defaultName', {count: existing.length + 1});
  }

  /**
   * Copies/writes the 4 required pose PNGs + optional 5th blink PNG into local userData characters directory.
   */
  saveCharacter({ name, poses, offsets }) {
    if (!poses || typeof poses !== 'object') {
      throw new Error(this.t('fourRequiredPoseImagesMustBeProvided'));
    }

    const buffers = {};
    for (const key of POSE_KEYS) {
      if (!poses[key]) {
        throw new Error(this.t('missingPose', {pose: this.t({idle:'idle', keyboard:'keyboard', mouse:'mouse', both:'keyboardMouse', blink:'eyesClosed'}[key])}));
      }
      buffers[key] = this._extractPngBytes(poses[key]);
    }

    if (poses.blink) {
      buffers.blink = this._extractPngBytes(poses.blink);
    }

    const cleanName = String(name || '').trim() || this.nextDefaultName();
    const shortId = crypto.randomBytes(3).toString('hex');
    const id = `${slugify(cleanName)}-${shortId}`;
    const targetDir = path.join(this.userCharactersDir, id);
    fs.mkdirSync(targetDir, { recursive: true });

    const manifestPoses = {};
    for (const key of POSE_KEYS) {
      const fileName = `${key}.png`;
      fs.writeFileSync(path.join(targetDir, fileName), buffers[key]);
      manifestPoses[key] = fileName;
    }

    if (buffers.blink) {
      fs.writeFileSync(path.join(targetDir, 'blink.png'), buffers.blink);
      manifestPoses.blink = 'blink.png';
    }

    const nowIso = new Date().toISOString();
    const manifest = {
      id,
      name: cleanName,
      builtIn: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      poses: manifestPoses,
      offsets: normalizeOffsets(offsets),
    };

    fs.writeFileSync(path.join(targetDir, 'character.json'), JSON.stringify(manifest, null, 2) + '\n');
    return this.getCharacter(id);
  }

  _ensureWritableCharacterDir(id) {
    const existing = this.listCharacters().find((c) => c.id === id);
    if (!existing) {
      throw new Error(this.t('characterNotFound'));
    }

    const customDir = path.join(this.userCharactersDir, existing.folderName || id);
    const customManifest = path.join(customDir, 'character.json');
    if (fs.existsSync(customManifest)) {
      return customDir;
    }

    // Clone built-in character into userCharactersDir so optional blink/offsets can be edited safely
    fs.mkdirSync(customDir, { recursive: true });
    const manifestPoses = {};
    for (const key of ALL_POSE_KEYS) {
      const srcPath = existing.posePaths?.[key];
      if (srcPath && fs.existsSync(srcPath)) {
        const fileName = `${key}.png`;
        fs.copyFileSync(srcPath, path.join(customDir, fileName));
        manifestPoses[key] = fileName;
      }
    }
    const nowIso = new Date().toISOString();
    const manifest = {
      id: existing.id,
      name: existing.name,
      builtInOrigin: Boolean(existing.builtIn),
      createdAt: nowIso,
      updatedAt: nowIso,
      poses: manifestPoses,
      offsets: normalizeOffsets(existing.offsets),
    };
    fs.writeFileSync(customManifest, JSON.stringify(manifest, null, 2) + '\n');
    return customDir;
  }

  /**
   * Adds or replaces the optional 5th blink PNG on an existing character.
   */
  setCharacterBlink(id, blinkPoseInput, blinkOffset) {
    const blinkBytes = this._extractPngBytes(blinkPoseInput);
    const targetDir = this._ensureWritableCharacterDir(id);
    const manifestPath = path.join(targetDir, 'character.json');
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    fs.writeFileSync(path.join(targetDir, 'blink.png'), blinkBytes);
    raw.poses = { ...(raw.poses || {}), blink: 'blink.png' };
    raw.updatedAt = new Date().toISOString();

    const normalized = normalizeOffsets(raw.offsets);
    if (blinkOffset && typeof blinkOffset === 'object') {
      normalized.blink = {
        x: Number.isFinite(Number(blinkOffset.x)) ? Math.round(Number(blinkOffset.x)) : normalized.idle.x,
        y: Number.isFinite(Number(blinkOffset.y)) ? Math.round(Number(blinkOffset.y)) : normalized.idle.y,
      };
    }
    raw.offsets = normalized;

    fs.writeFileSync(manifestPath, JSON.stringify(raw, null, 2) + '\n');
    return this.getCharacter(id);
  }

  removeCharacterBlink(id) {
    const targetDir = this._ensureWritableCharacterDir(id);
    const manifestPath = path.join(targetDir, 'character.json');
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    const blinkFile = path.join(targetDir, 'blink.png');
    if (fs.existsSync(blinkFile)) {
      fs.unlinkSync(blinkFile);
    }
    if (raw.poses) {
      delete raw.poses.blink;
    }
    raw.updatedAt = new Date().toISOString();
    fs.writeFileSync(manifestPath, JSON.stringify(raw, null, 2) + '\n');
    return this.getCharacter(id);
  }

  updateCharacterOffsets(id, offsets) {
    const targetDir = this._ensureWritableCharacterDir(id);
    const manifestPath = path.join(targetDir, 'character.json');
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    raw.offsets = normalizeOffsets(offsets);
    raw.updatedAt = new Date().toISOString();
    fs.writeFileSync(manifestPath, JSON.stringify(raw, null, 2) + '\n');
    return this.getCharacter(id);
  }

  deleteCharacter(id) {
    const all = this.listCharacters();
    const target = all.find((c) => c.id === id);
    if (!target || target.builtIn) {
      return false;
    }
    const customDir = path.join(this.userCharactersDir, target.folderName || id);
    if (fs.existsSync(customDir)) {
      fs.rmSync(customDir, { recursive: true, force: true });
    }
    const settings = this.getSettings();
    if (settings.selectedCharacterId === id) {
      const remaining = this.listCharacters();
      this.saveSettings({
        selectedCharacterId: remaining[0]?.id || null,
      });
    }
    return true;
  }

  getSettings() {
    const characters = this.listCharacters();
    const fallbackId = characters[0]?.id || null;
    const defaults = {
      language: this.defaultLanguage,
      selectedCharacterId: fallbackId,
      overlayVisible: false,
      corner: 'bottom-right',
      positionMode: 'corner',
      customX: null,
      customY: null,
      size: 240,
      touchReaction: true,
    };

    if (!fs.existsSync(this.settingsPath)) {
      return defaults;
    }

    try {
      const saved = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
      const validChar = characters.some((c) => c.id === saved.selectedCharacterId)
        ? saved.selectedCharacterId
        : fallbackId;
      const validCorner = VALID_CORNERS.includes(saved.corner) ? saved.corner : defaults.corner;
      const rawSize = Number(saved.size);
      const validSize = Number.isFinite(rawSize)
        ? Math.min(480, Math.max(120, Math.round(rawSize)))
        : defaults.size;

      const hasCustomCoords =
        saved.positionMode === 'custom' &&
        saved.customX !== null &&
        saved.customY !== null &&
        Number.isFinite(Number(saved.customX)) &&
        Number.isFinite(Number(saved.customY));

      return {
        language: ['tr', 'en'].includes(saved.language) ? saved.language : 'tr',
        selectedCharacterId: validChar,
        overlayVisible: Boolean(saved.overlayVisible),
        corner: validCorner,
        positionMode: hasCustomCoords ? 'custom' : 'corner',
        customX: hasCustomCoords ? Math.round(Number(saved.customX)) : null,
        customY: hasCustomCoords ? Math.round(Number(saved.customY)) : null,
        size: validSize,
        touchReaction: saved.touchReaction !== undefined ? Boolean(saved.touchReaction) : true,
      };
    } catch {
      return defaults;
    }
  }

  saveSettings(partial) {
    const current = this.getSettings();
    const next = {
      ...current,
      ...partial,
    };
    if (!VALID_CORNERS.includes(next.corner)) {
      next.corner = current.corner;
    }
    if (typeof next.size === 'number' && Number.isFinite(next.size)) {
      next.size = Math.min(480, Math.max(120, Math.round(next.size)));
    } else {
      next.size = current.size;
    }
    next.language = ['tr', 'en'].includes(next.language) ? next.language : current.language;
    next.overlayVisible = Boolean(next.overlayVisible);
    next.touchReaction = next.touchReaction !== undefined ? Boolean(next.touchReaction) : true;

    if (
      next.positionMode === 'custom' &&
      next.customX !== null &&
      next.customY !== null &&
      Number.isFinite(Number(next.customX)) &&
      Number.isFinite(Number(next.customY))
    ) {
      next.customX = Math.round(Number(next.customX));
      next.customY = Math.round(Number(next.customY));
    } else {
      next.positionMode = 'corner';
      next.customX = null;
      next.customY = null;
    }

    fs.writeFileSync(this.settingsPath, JSON.stringify(next, null, 2) + '\n');
    return this.getSettings();
  }
}

module.exports = {
  CharacterStore,
  POSE_KEYS,
  OPTIONAL_POSE_KEYS,
  ALL_POSE_KEYS,
  VALID_CORNERS,
  isPngBuffer,
  readPngDimensions,
};
