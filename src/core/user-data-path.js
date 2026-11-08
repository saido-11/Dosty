'use strict';

const fs = require('node:fs');
const path = require('node:path');

function hasUserData(directory) {
  return fs.existsSync(path.join(directory, 'settings.json')) ||
    (fs.existsSync(path.join(directory, 'characters')) &&
      fs.readdirSync(path.join(directory, 'characters')).length > 0);
}

// Keep existing libraries in place when upgrading from the former app name.
// Fresh installations use Dosty; no settings, images or browser caches are copied.
function resolveUserDataPath(appDataDirectory) {
  const current = path.join(appDataDirectory, 'Dosty');
  if (hasUserData(current)) return current;
  for (const name of ['Masaüstü Karakter', 'Masaustu Karakter', 'masaustu-karakter']) {
    const legacy = path.join(appDataDirectory, name);
    if (hasUserData(legacy)) return legacy;
  }
  return current;
}

module.exports = { resolveUserDataPath };
