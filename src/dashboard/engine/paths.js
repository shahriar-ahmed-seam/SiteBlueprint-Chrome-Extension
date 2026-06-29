/**
 * @file paths.js
 * @description URL -> local file path resolution and relative-path rewriting.
 * These functions are the backbone of the offline mirror: they translate live
 * URLs into a deterministic local directory layout and compute the relative
 * hops needed to link files together once served from the filesystem.
 *
 * All functions are pure: given the same inputs they always return the same
 * output and never touch the DOM or global state.
 */

import { getFileExtension } from './utils.js';

/** Binary asset extensions whose query strings are pure cache-busters. */
export const ASSET_EXTS = new Set([
  'eot', 'woff', 'woff2', 'ttf', 'otf', 'svg',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp',
  'mp4', 'mp3', 'wav', 'ogg', 'webm', 'pdf'
]);

/**
 * Converts any (absolute or relative) URL into a relative local project path.
 * Same-origin resources map into the root tree; cross-origin assets are nested
 * under `external/<hostname>/...`.
 *
 * @param {string} urlStr the link/asset URL (may be relative)
 * @param {string} baseUrl the document URL used to resolve relatives and decide origin
 * @returns {string} a local, slash-delimited path (no leading slash)
 */
export function getLocalPathForUrl(urlStr, baseUrl) {
  try {
    const url = new URL(urlStr, baseUrl);
    const base = new URL(baseUrl);

    if (url.origin === base.origin) {
      return urlToLocalPath(url.href);
    }

    // ── External / CDN asset ────────────────────────────────────────────────
    let extPath = url.pathname;
    if (extPath === '/' || extPath === '') {
      extPath = '/index.html';
    }

    const hostname = url.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    let fullPath = `external/${hostname}${extPath}`;

    if (fullPath.endsWith('/')) {
      fullPath += 'index.html';
    }

    const lastSegment = fullPath.split('/').pop();
    if (!lastSegment.includes('.')) {
      const ext = getFileExtension(urlStr);
      fullPath += ext ? `.${ext}` : '.html';
    }

    return fullPath;
  } catch (_) {
    return 'assets/corrupted_path';
  }
}

/**
 * Maps a same-origin URL to a local file path, applying directory-index and
 * extension heuristics, and folding query strings into the filename so that
 * filtered/paginated views remain distinct offline.
 *
 * @param {string} urlStr absolute same-origin URL
 * @returns {string}
 */
export function urlToLocalPath(urlStr) {
  const url = new URL(urlStr);
  let path = url.pathname;
  const search = url.search;

  if (path === '/' || path === '') {
    path = 'index.html';
  } else {
    path = decodeURIComponent(path);
    if (path.startsWith('/')) path = path.slice(1);

    if (path.endsWith('/')) {
      path += 'index.html';
    } else {
      const lastSegment = path.split('/').pop();
      if (!lastSegment.includes('.')) {
        path += '.html'; // dynamic route, e.g. /purchases/create
      }
    }
  }

  if (search) {
    let sanitizedSearch = search
      .replace(/^\?/, '_')
      .replace(/[&=]/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '');
    if (sanitizedSearch.length > 40) sanitizedSearch = sanitizedSearch.slice(0, 40);

    const dotIndex = path.lastIndexOf('.');
    path = dotIndex !== -1
      ? path.slice(0, dotIndex) + sanitizedSearch + path.slice(dotIndex)
      : path + sanitizedSearch;
  }

  return path;
}

/**
 * Computes the relative path from one local file to another, accounting for
 * the directory depth of the source file.
 *
 * @param {string} fromPath local path of the document doing the linking
 * @param {string} toPath local path of the target resource
 * @returns {string}
 */
export function getRelativePath(fromPath, toPath) {
  const fromParts = fromPath.split('/');
  fromParts.pop(); // drop the filename itself
  if (fromParts.length === 0) return toPath;
  return '../'.repeat(fromParts.length) + toPath;
}

/**
 * Normalizes an asset URL for deduplication: strips fragments (#iefix, #glyph)
 * and removes query strings that are empty or pure cache-busters on binary
 * assets. e.g. `font.eot?v=2#iefix` -> `font.eot`.
 *
 * @param {string} urlStr
 * @returns {string}
 */
export function normalizeAssetUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    url.hash = '';
    const ext = url.pathname.split('.').pop().toLowerCase();
    if (url.search === '?' || ASSET_EXTS.has(ext)) {
      url.search = '';
    }
    return url.href;
  } catch (_) {
    return urlStr;
  }
}
