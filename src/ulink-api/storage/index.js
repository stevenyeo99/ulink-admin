const config = require('../config');
const localDiskAdapter = require('./localDiskAdapter');

/**
 * StorageAdapter shape (all adapters must implement):
 *   put(key: string, bytes: Buffer): Promise<{ storageRef: string }>
 *   get(storageRef: string): Promise<Buffer>
 *
 * Day 1 ships only the local disk adapter. S3/Supabase Storage can be added
 * later as sibling files without touching any calling code — callers only
 * ever see storageRef strings, never adapter-specific paths/keys.
 */
function getStorageAdapter() {
  switch (config.storage.driver) {
    case 'local':
      return localDiskAdapter;
    default:
      throw new Error(`Unsupported STORAGE_DRIVER "${config.storage.driver}" (only "local" is implemented)`);
  }
}

module.exports = { getStorageAdapter };
