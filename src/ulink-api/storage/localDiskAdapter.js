const fs = require('fs');
const path = require('path');
const config = require('../config');

function resolveRoot() {
  return path.isAbsolute(config.storage.root) ? config.storage.root : path.resolve(process.cwd(), config.storage.root);
}

async function put(key, bytes) {
  const root = resolveRoot();
  const fullPath = path.join(root, key);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, bytes);
  return { storageRef: key };
}

async function get(storageRef) {
  const root = resolveRoot();
  const fullPath = path.join(root, storageRef);
  return fs.promises.readFile(fullPath);
}

module.exports = { put, get };
