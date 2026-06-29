/**
 * @file utils.js
 * @description Pure, side-effect-free helper utilities shared across the
 * SiteBlueprint crawler engine. Everything here is deterministic and safe to
 * unit test in isolation.
 */

/**
 * Pauses execution for the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Formats a byte count into a human-readable string (B, KB, MB, GB).
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Formats a duration in seconds as mm:ss.
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

/**
 * Extracts the lowercase file extension from a URL, ignoring query/hash.
 * Returns an empty string when no extension is present.
 * @param {string} urlStr
 * @returns {string}
 */
export function getFileExtension(urlStr) {
  try {
    const path = new URL(urlStr).pathname;
    const lastSegment = path.split('/').pop();
    if (lastSegment.includes('.')) {
      return lastSegment.split('.').pop().split(/[?#]/)[0].toLowerCase();
    }
  } catch (_) {
    /* not a parseable URL */
  }
  return '';
}

/**
 * Classifies an asset by file extension into a coarse type bucket.
 * @param {string} ext lowercase extension without the dot
 * @returns {'img'|'font'|'other'}
 */
export function classifyAssetType(ext) {
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp'].includes(ext)) {
    return 'img';
  }
  if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) {
    return 'font';
  }
  return 'other';
}
