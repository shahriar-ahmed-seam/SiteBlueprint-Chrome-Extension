/**
 * @file exclusions.js
 * @description Parses user-supplied exclusion patterns and tests pathnames
 * against them. Supports plain substring matching and `/regex/` syntax so the
 * crawler can avoid destructive routes (logout, delete) and API endpoints.
 */

/**
 * Splits a comma-separated exclusion string into a clean list of patterns.
 * @param {string} text
 * @returns {string[]}
 */
export function parseExclusions(text) {
  if (!text) return [];
  return text
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Returns true if the pathname matches any of the supplied exclusion patterns.
 * A pattern wrapped in slashes (e.g. `/\/api\//`) is treated as a regex;
 * everything else is a case-insensitive substring match.
 *
 * @param {string} pathname
 * @param {string[]} patterns
 * @returns {boolean}
 */
export function isExcluded(pathname, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const lowerPath = pathname.toLowerCase();

  return patterns.some((pattern) => {
    if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
      try {
        return new RegExp(pattern.slice(1, -1), 'i').test(pathname);
      } catch (_) {
        /* fall through to substring match */
      }
    }
    return lowerPath.includes(pattern.toLowerCase());
  });
}
