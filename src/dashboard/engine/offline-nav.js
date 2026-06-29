/**
 * @file offline-nav.js
 * @description Generates `_blueprint_nav.js`, the router injected into every
 * saved page. It rewrites link clicks and SPA history navigation to point at
 * the correct local `.html` file using the embedded sitemap, so the mirrored
 * site navigates exactly like the live one — but entirely offline.
 */

/**
 * Builds the offline navigation interceptor with the sitemap baked in.
 * @param {Record<string, string>} siteMap maps URL pathname -> local file path
 * @returns {string}
 */
export function generateBlueprintNavScript(siteMap) {
  const mapJson = JSON.stringify(siteMap);
  return `/* SiteBlueprint — Offline Navigation Interceptor
 * Auto-generated. Do not edit.
 * Sitemap entries: ${Object.keys(siteMap).length} pages
 */
(function () {
  'use strict';
  const sitemap = ${mapJson};
  const depth   = window.__BP_DEPTH__ || 0;
  const up      = '../'.repeat(depth);

  function resolve(href) {
    if (!href) return null;
    const h = href.trim();
    if (h.charAt(0) === '#' || /^(mailto|tel|javascript|data):/.test(h)) return null;
    let pn;
    try {
      pn = /^https?:\\/\\//.test(h)
        ? new URL(h).pathname
        : new URL(h, window.location.href).pathname;
    } catch (e) { return null; }
    pn = decodeURIComponent(pn).replace(/\\/+$/, '') || '/';
    const lp = sitemap[pn] || sitemap[pn + '/'];
    return lp ? up + lp : null;
  }

  /* 1. Anchor click interception (capture phase = fires before any SPA router) */
  document.addEventListener('click', function (e) {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const f = resolve(a.getAttribute('href'));
    if (f) {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = f;
    }
  }, true);

  /* 2. SPA history.pushState interception */
  const _ps = history.pushState.bind(history);
  history.pushState = function (s, t, url) {
    if (url) { const f = resolve(String(url)); if (f) { window.location.href = f; return; } }
    return _ps(s, t, url);
  };

  /* 3. SPA history.replaceState interception */
  const _rs = history.replaceState.bind(history);
  history.replaceState = function (s, t, url) {
    if (url) { const f = resolve(String(url)); if (f) { window.location.replace(f); return; } }
    return _rs(s, t, url);
  };

  /* 4. Patch <a> tags that SPA frameworks create dynamically */
  if (window.MutationObserver) {
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          (node.tagName === 'A' ? [node] : Array.from(node.querySelectorAll('a[href]'))).forEach(function(a) {
            const href = a.getAttribute('href');
            const f = resolve(href);
            if (f) a.setAttribute('href', f);
          });
        });
      });
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  console.log('[SiteBlueprint] Offline nav active | depth:', depth, '| pages in map:', Object.keys(sitemap).length);
})();
`;
}
