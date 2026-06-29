/**
 * @file dashboard.js
 * @description SiteBlueprint dashboard controller. Wires the UI to the crawler
 * engine, orchestrates the breadth-first crawl, asset compilation, offline
 * rewriting and ZIP packaging. Pure logic (path resolution, exclusions, shim
 * and nav generation) lives in ./engine/* and is imported here.
 *
 * `JSZip` is provided as a global by vendor/jszip.min.js (loaded before this
 * module in dashboard.html).
 */

import {
  sleep,
  formatBytes,
  formatTime,
  getFileExtension,
  classifyAssetType
} from './engine/utils.js';
import {
  getLocalPathForUrl,
  getRelativePath,
  normalizeAssetUrl
} from './engine/paths.js';
import { parseExclusions, isExcluded } from './engine/exclusions.js';
import { generateFreezeShimInlineCode } from './engine/freeze-shim.js';
import { generateBlueprintNavScript } from './engine/offline-nav.js';

document.addEventListener('DOMContentLoaded', () => {
  // ── UI Elements ───────────────────────────────────────────────────────────
  const startUrlInput = document.getElementById('start-url');
  const maxDepthSelect = document.getElementById('max-depth');
  const crawlDelayInput = document.getElementById('crawl-delay');
  const excludePatternsInput = document.getElementById('exclude-patterns');
  const saveExternalCheckbox = document.getElementById('save-external');
  const freezeModeCheckbox = document.getElementById('freeze-mode');
  const freezeWaitInput = document.getElementById('freeze-wait');
  const freezeWaitGroup = document.getElementById('freeze-wait-group');
  const freezeModeGroup = document.querySelector('.freeze-mode-group');
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');
  const downloadZipBtn = document.getElementById('download-zip-btn');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const domainBadge = document.getElementById('domain-badge');
  const progressPercent = document.getElementById('progress-percent');
  const progressBar = document.getElementById('progress-bar');
  const terminalLog = document.getElementById('terminal-log');
  const clearConsoleBtn = document.getElementById('clear-console-btn');
  const tableSearch = document.getElementById('table-search');
  const blueprintTbody = document.getElementById('blueprint-tbody');

  // Stats elements
  const statPages = document.getElementById('stat-pages');
  const statAssets = document.getElementById('stat-assets');
  const statQueueInfo = document.getElementById('stat-queue-info');
  const statAssetsBreakdown = document.getElementById('stat-assets-breakdown');
  const statSize = document.getElementById('stat-size');
  const statSpeed = document.getElementById('stat-speed');
  const statTime = document.getElementById('stat-time');

  // ── Engine configuration constants ──────────────────────────────────────────
  const ASSET_TIMEOUT_MS = 15000; // per-asset fetch timeout
  const ASSET_THROTTLE_MS = 50; // gap between asset downloads
  const DEFAULT_FREEZE_WAIT_MS = 2500;

  // ── Engine state ────────────────────────────────────────────────────────────
  let isRunning = false;
  let startUrl = '';
  let startOrigin = '';
  let loginUrl = ''; // detected login page URL for redirect detection
  let sessionInvalidated = false; // true once a mid-crawl session redirect is seen
  let maxDepth = 3;
  let crawlDelay = 300;
  let saveExternal = true;
  let freezeMode = false; // capture real rendered DOM via background tab
  let freezeWait = DEFAULT_FREEZE_WAIT_MS;
  let usedFreezeMode = false; // whether any page was frozen (for shim inclusion)
  let exclusions = []; // parsed exclusion patterns for the active crawl
  let elapsedSeconds = 0;

  // Queues and lookup tables
  let queue = []; // [{ url, depth }]
  let visited = new Map(); // urlStr -> localPath
  let assetsQueue = []; // [{ url, localPath, type }]
  let processedAssets = new Set(); // asset URLs already handled
  let localPathIndex = new Set(); // local paths already written (dedupe)
  let siteMap = {}; // URL pathname -> localPath, for offline nav
  let zip = null;

  let stats = createEmptyStats();
  const urlToRowElements = new Map();

  // ── Bootstrap from query string ─────────────────────────────────────────────
  const paramUrl = new URLSearchParams(window.location.search).get('url');
  if (paramUrl) {
    try {
      const parsed = new URL(paramUrl);
      startUrlInput.value = parsed.href;
      domainBadge.textContent = parsed.hostname;
      log(`Detected active tab URL: ${parsed.href}`, 'highlight');
    } catch (_) {
      log(`Invalid target URL passed in parameter: ${paramUrl}`, 'err');
    }
  }

  if (!excludePatternsInput.value.trim()) {
    excludePatternsInput.value = 'logout, signout, log-out, sign-out';
  }

  // ── UI event wiring ──────────────────────────────────────────────────────────
  startUrlInput.addEventListener('input', (e) => {
    try {
      domainBadge.textContent = new URL(e.target.value.trim()).hostname;
    } catch (_) {
      domainBadge.textContent = 'Invalid URL';
    }
  });

  freezeModeCheckbox.addEventListener('change', () => {
    const isOn = freezeModeCheckbox.checked;
    freezeWaitGroup.style.display = isOn ? 'flex' : 'none';
    freezeModeGroup.classList.toggle('active', isOn);
    if (isOn) {
      log('❄ Freeze Live Data mode enabled. Pages will be opened in background tabs to capture real rendered DOM with AJAX data.', 'freeze');
    }
  });

  clearConsoleBtn.addEventListener('click', () => {
    terminalLog.innerHTML = '';
    log('Console logs cleared.', 'system');
  });

  tableSearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    for (const [url, elements] of urlToRowElements.entries()) {
      const pathText = elements.row.querySelector('.col-path').textContent.toLowerCase();
      const matches = pathText.includes(query) || url.toLowerCase().includes(query);
      elements.row.style.display = matches ? '' : 'none';
    }
  });

  startBtn.addEventListener('click', startCrawling);
  stopBtn.addEventListener('click', stopCrawling);
  downloadZipBtn.addEventListener('click', downloadZip);

  // ── Local helpers (DOM-bound) ────────────────────────────────────────────────
  function createEmptyStats() {
    return {
      pagesCrawled: 0,
      assetsGathered: 0,
      totalSize: 0,
      startTime: 0,
      timerInterval: null,
      counts: { css: 0, js: 0, img: 0, font: 0, other: 0 }
    };
  }

  /** Logs a message to the on-screen terminal console. */
  function log(message, type = 'info') {
    const line = document.createElement('div');
    line.className = `terminal-line ${type}-line`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    terminalLog.appendChild(line);
    terminalLog.scrollTop = terminalLog.scrollHeight;
  }

  // ── Interactive blueprint table ──────────────────────────────────────────────
  function addTableRow(urlStr, localPath, depth, type) {
    if (urlToRowElements.has(urlStr)) return;

    const emptyRow = blueprintTbody.querySelector('.empty-row');
    if (emptyRow) emptyRow.remove();

    const tr = document.createElement('tr');
    tr.setAttribute('data-url', urlStr);

    const tdPath = document.createElement('td');
    tdPath.className = 'col-path';
    tdPath.textContent = localPath;
    tr.appendChild(tdPath);

    const tdUrl = document.createElement('td');
    tdUrl.className = 'col-url';
    tdUrl.textContent = urlStr;
    tdUrl.setAttribute('title', urlStr);
    tr.appendChild(tdUrl);

    const tdDepth = document.createElement('td');
    tdDepth.textContent = depth === 0 ? 'Root' : depth;
    tr.appendChild(tdDepth);

    const tdType = document.createElement('td');
    tdType.textContent = type;
    tr.appendChild(tdType);

    const tdStatus = document.createElement('td');
    const spanBadge = document.createElement('span');
    spanBadge.className = 'badge pending';
    spanBadge.textContent = 'pending';
    tdStatus.appendChild(spanBadge);
    tr.appendChild(tdStatus);

    const tdSize = document.createElement('td');
    tdSize.textContent = '--';
    tr.appendChild(tdSize);

    blueprintTbody.appendChild(tr);
    urlToRowElements.set(urlStr, { badge: spanBadge, sizeCell: tdSize, row: tr });
  }

  function updateTableStatus(urlStr, status, localPath = null, sizeInBytes = null) {
    const elements = urlToRowElements.get(urlStr);
    if (!elements) return;

    elements.badge.className = `badge ${status}`;
    elements.badge.textContent = status;
    if (localPath) elements.row.querySelector('.col-path').textContent = localPath;
    if (sizeInBytes !== null) elements.sizeCell.textContent = formatBytes(sizeInBytes);
  }

  // ── Stats display ────────────────────────────────────────────────────────────
  function updateStats() {
    statPages.textContent = stats.pagesCrawled;
    statAssets.textContent = stats.assetsGathered;
    statSize.textContent = formatBytes(stats.totalSize);
    statQueueInfo.textContent = `Queue: ${queue.length} pending`;
    statAssetsBreakdown.textContent =
      `CSS: ${stats.counts.css} | JS: ${stats.counts.js} | Img: ${stats.counts.img} | Font/Other: ${stats.counts.font + stats.counts.other}`;

    if (elapsedSeconds > 0) {
      const pagesSec = stats.pagesCrawled / elapsedSeconds;
      statSpeed.textContent = `Speed: ${pagesSec.toFixed(1)} p/s (${formatBytes(stats.totalSize / elapsedSeconds)}/s)`;
    } else {
      statSpeed.textContent = 'Speed: -- /s';
    }
  }

  function updateProgressBar() {
    const totalDiscovered = urlToRowElements.size;
    const completed = stats.pagesCrawled + processedAssets.size;
    if (totalDiscovered > 0) {
      const percentage = Math.min(100, Math.floor((completed / totalDiscovered) * 100));
      progressBar.style.width = `${percentage}%`;
      progressPercent.textContent = `${percentage}%`;
    }
  }

  // ── Crawler controller ───────────────────────────────────────────────────────
  async function startCrawling() {
    if (isRunning) return;

    const inputUrl = startUrlInput.value.trim();
    if (!inputUrl) {
      alert('Please enter a valid target URL.');
      return;
    }

    try {
      const parsed = new URL(inputUrl);
      startUrl = parsed.href;
      startOrigin = parsed.origin;
    } catch (_) {
      alert('Invalid URL structure. Please provide a full address, e.g. https://example.com');
      return;
    }

    // Reset engine state
    isRunning = true;
    sessionInvalidated = false;
    loginUrl = '';
    queue = [];
    visited.clear();
    assetsQueue = [];
    processedAssets.clear();
    localPathIndex.clear();
    siteMap = {};
    urlToRowElements.clear();
    blueprintTbody.innerHTML = '';

    maxDepth = parseInt(maxDepthSelect.value, 10);
    crawlDelay = parseInt(crawlDelayInput.value, 10);
    saveExternal = saveExternalCheckbox.checked;
    freezeMode = freezeModeCheckbox.checked;
    freezeWait = parseInt(freezeWaitInput.value, 10) || DEFAULT_FREEZE_WAIT_MS;
    usedFreezeMode = freezeMode;
    exclusions = parseExclusions(excludePatternsInput.value);

    zip = new JSZip();
    stats = createEmptyStats();
    stats.startTime = Date.now();
    elapsedSeconds = 0;

    startBtn.disabled = true;
    stopBtn.disabled = false;
    downloadZipBtn.disabled = true;

    statusDot.className = 'status-dot running';
    statusText.textContent = 'CRAWLER STATUS: RUNNING';
    domainBadge.textContent = new URL(startUrl).hostname;

    log(`Initializing SiteBlueprint crawler core for: ${startUrl}`, 'system');
    log(`Options configured - Max Depth: ${maxDepth === 999 ? 'Unlimited' : maxDepth}, Delay: ${crawlDelay}ms, Save CDNs: ${saveExternal}, Freeze Mode: ${freezeMode ? '❄ ON (render wait: ' + freezeWait + 'ms)' : 'off'}`, 'system');
    if (freezeMode) {
      log('❄ Freeze mode: each page will be loaded in a real browser tab. Data visible in Chrome will be frozen into the saved HTML.', 'freeze');
    }

    statTime.textContent = '00:00';
    if (stats.timerInterval) clearInterval(stats.timerInterval);
    stats.timerInterval = setInterval(() => {
      elapsedSeconds++;
      statTime.textContent = formatTime(elapsedSeconds);
      updateStats();
    }, 1000);

    const rootPath = getLocalPathForUrl(startUrl, startUrl);
    queue.push({ url: startUrl, depth: 0 });
    addTableRow(startUrl, rootPath, 0, 'HTML Page (Root)');

    try {
      await crawlEngine();
    } catch (err) {
      log(`Compilation engine crashed: ${err.message}`, 'err');
      stopCrawling();
    }
  }

  function stopCrawling() {
    if (!isRunning) return;
    log('Crawl sequence stopped by user. Compiling currently fetched resources...', 'warn');
    isRunning = false;
    finalizeCrawl();
  }

  // ── Page fetching: fetch() mode vs Freeze (tab DOM capture) mode ──────────────
  /**
   * Unified page fetch entry point.
   * - Normal mode: fetch() with credentials (fast, no JS rendering).
   * - Freeze mode: open a background tab, wait for render, capture outerHTML.
   * @returns {Promise<{htmlText:string, finalUrl:string, contentType:string}>}
   */
  async function fetchPageHtml(url) {
    if (!freezeMode) {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('Content-Type') || '';
      const htmlText = contentType.includes('text/html') ? await response.text() : '';
      return { htmlText, finalUrl: response.url, contentType };
    }
    return freezeCapture(url);
  }

  /** Freeze-mode capture: render the page in a background tab and snapshot it. */
  function freezeCapture(url) {
    return new Promise((resolve, reject) => {
      let tabId = null;
      let settled = false;
      const TIMEOUT = Math.max(freezeWait + 15000, 20000);

      const cleanup = () => {
        if (tabId !== null) {
          chrome.tabs.remove(tabId, () => {});
          tabId = null;
        }
      };
      const fail = (msg) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(msg));
      };

      const timeoutHandle = setTimeout(() => fail(`Freeze timeout after ${TIMEOUT}ms`), TIMEOUT);

      const onUpdated = (tid, changeInfo) => {
        if (tid !== tabId || changeInfo.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(onUpdated);

        setTimeout(async () => {
          if (settled) return;
          try {
            const tab = await chrome.tabs.get(tabId);
            const finalUrl = tab.url || url;
            const contentType = finalUrl.match(/\.(css|js|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot)($|\?)/i)
              ? 'application/octet-stream'
              : 'text/html';

            // Inline the freeze shim BEFORE serialising so DataTables AJAX is
            // blocked and the shim persists in the saved HTML.
            const shimScript = generateFreezeShimInlineCode();
            await chrome.scripting.executeScript({
              target: { tabId },
              func: (shim) => {
                const s = document.createElement('script');
                s.id = '__bp_shim_marker__';
                s.textContent = shim;
                (document.head || document.documentElement).prepend(s);
              },
              args: [shimScript]
            });

            const results = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => document.documentElement.outerHTML
            });

            const htmlText = (results && results[0] && results[0].result) || '';
            clearTimeout(timeoutHandle);
            settled = true;
            cleanup();
            resolve({ htmlText, finalUrl, contentType });
          } catch (err) {
            fail(`Tab scripting error: ${err.message}`);
          }
        }, freezeWait);
      };

      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.create({ url, active: false }, (tab) => {
        if (chrome.runtime.lastError) {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          fail(`Tab creation error: ${chrome.runtime.lastError.message}`);
          return;
        }
        tabId = tab.id;
        if (tab.status === 'complete') onUpdated(tabId, { status: 'complete' });
      });
    });
  }

  // ── Login / auth redirect detection ──────────────────────────────────────────
  const LOGIN_PATTERNS = [/\/login/, /\/signin/, /\/sign-in/, /\/auth/, /\/session\/new/];

  function isLoginUrl(urlStr) {
    try {
      const path = new URL(urlStr).pathname.toLowerCase();
      return LOGIN_PATTERNS.some((re) => re.test(path));
    } catch (_) {
      return false;
    }
  }

  function isRedirectedToLogin(requestedUrl, finalUrl) {
    if (requestedUrl === finalUrl) return false;
    if (loginUrl && finalUrl === loginUrl) return true;
    return isLoginUrl(finalUrl);
  }

  async function crawlEngine() {
    while (queue.length > 0 && isRunning) {
      const current = queue.shift();
      if (visited.has(current.url)) continue;

      if (sessionInvalidated) {
        log(`Skipping ${current.url} — session expired, remaining queue cleared.`, 'warn');
        updateTableStatus(current.url, 'warning');
        continue;
      }

      log(`${freezeMode ? '❄ Freezing' : 'Loading'} target: ${current.url}`, 'info');
      updateTableStatus(current.url, 'downloading');

      try {
        const { htmlText, finalUrl, contentType } = await fetchPageHtml(current.url);

        if (isRedirectedToLogin(current.url, finalUrl)) {
          handleAuthRedirect(current, finalUrl, htmlText);
          updateStats();
          updateProgressBar();
          continue;
        }

        const localPath = getLocalPathForUrl(finalUrl, startUrl);
        visited.set(current.url, localPath);

        if (finalUrl !== current.url) {
          visited.set(finalUrl, localPath);
          log(`Redirected to: ${finalUrl} (Mapped to: ${localPath})`, 'info');
        }

        if (localPathIndex.has(localPath)) {
          log(`Duplicate path skipped: ${localPath} (already saved)`, 'info');
          updateTableStatus(current.url, 'success', localPath);
          updateStats();
          updateProgressBar();
          continue;
        }

        if (contentType.includes('text/html')) {
          const doc = new DOMParser().parseFromString(htmlText, 'text/html');
          processHtmlDocument(doc, finalUrl, current.depth);
          try { siteMap[new URL(finalUrl).pathname] = localPath; } catch (_) {}
          injectOfflineNav(doc, localPath);

          const serializedHtml = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
          zip.file(localPath, serializedHtml);
          localPathIndex.add(localPath);
          stats.pagesCrawled++;
          stats.totalSize += serializedHtml.length;

          log(`Saved page: ${localPath} (${formatBytes(serializedHtml.length)})`, 'ok');
          updateTableStatus(current.url, 'success', localPath, serializedHtml.length);
        } else {
          const rawText = htmlText || '';
          zip.file(localPath, rawText);
          localPathIndex.add(localPath);
          stats.assetsGathered++;
          stats.totalSize += rawText.length;
          stats.counts.other++;

          log(`Saved non-HTML resource: ${localPath} (${formatBytes(rawText.length)})`, 'ok');
          updateTableStatus(current.url, 'success', localPath, rawText.length);
        }
      } catch (err) {
        log(`${freezeMode ? 'Freeze' : 'Fetch'} failure on: ${current.url} - ${err.message}`, 'err');
        updateTableStatus(current.url, 'error');
      }

      updateStats();
      updateProgressBar();

      if (queue.length > 0 && crawlDelay > 0 && isRunning) {
        await sleep(crawlDelay);
      }
    }

    if (isRunning) {
      if (sessionInvalidated) {
        log('Warning: Session expired mid-crawl. Some pages could not be captured. Proceed to download what was collected.', 'warn');
      } else {
        log('All discovered pages crawled. Commencing asset downloads...', 'system');
      }
      await downloadAssets();
    }
  }

  /** Handles a page that redirected to a login screen. */
  function handleAuthRedirect(current, finalUrl, htmlText) {
    if (!loginUrl) {
      loginUrl = finalUrl;
      log(`Auth redirect detected! Login page identified as: ${finalUrl}`, 'warn');
    }

    if (!localPathIndex.has('login.html') && !visited.has(finalUrl)) {
      const loginLocalPath = getLocalPathForUrl(finalUrl, startUrl);
      const doc = new DOMParser().parseFromString(htmlText, 'text/html');
      processHtmlDocument(doc, finalUrl, current.depth);
      injectOfflineNav(doc, loginLocalPath);

      const serializedHtml = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
      zip.file(loginLocalPath, serializedHtml);
      localPathIndex.add(loginLocalPath);
      try { siteMap[new URL(finalUrl).pathname] = loginLocalPath; } catch (_) {}
      visited.set(finalUrl, loginLocalPath);
      stats.pagesCrawled++;
      stats.totalSize += serializedHtml.length;

      log(`Login page saved: ${loginLocalPath}`, 'ok');
      updateTableStatus(current.url, 'warning', loginLocalPath, serializedHtml.length);
    } else {
      sessionInvalidated = true;
      visited.set(current.url, 'login.html');
      log(`[AUTH] Session expired — ${current.url} redirected to login. Queued pages will be skipped.`, 'warn');
      updateTableStatus(current.url, 'warning', '⚠ auth-required');
    }
  }

  // ── DOM link & asset scraping / rewriting ─────────────────────────────────────
  function processHtmlDocument(doc, pageUrl, currentDepth) {
    const sourceLocalPath = getLocalPathForUrl(pageUrl, startUrl);

    ensureCharsetMeta(doc);
    rewriteAnchors(doc, pageUrl, sourceLocalPath, currentDepth);
    rewriteResourceTags(doc, pageUrl, sourceLocalPath);
    rewriteForms(doc, pageUrl);
    rewriteInlineStyles(doc, pageUrl, sourceLocalPath);
  }

  function ensureCharsetMeta(doc) {
    const metas = doc.querySelectorAll('meta');
    for (const meta of metas) {
      if (meta.getAttribute('charset') || meta.getAttribute('http-equiv')?.toLowerCase() === 'content-type') {
        return;
      }
    }
    const charsetMeta = doc.createElement('meta');
    charsetMeta.setAttribute('charset', 'UTF-8');
    doc.head.insertBefore(charsetMeta, doc.head.firstChild);
  }

  function rewriteAnchors(doc, pageUrl, sourceLocalPath, currentDepth) {
    for (const link of doc.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      if (!href || /^(#|javascript:|mailto:|tel:)/.test(href)) continue;

      try {
        const absoluteUrl = new URL(href, pageUrl).href;
        const parsedUrl = new URL(absoluteUrl);

        if (parsedUrl.origin === startOrigin) {
          if (isExcluded(parsedUrl.pathname, exclusions)) continue;

          const targetLocalPath = getLocalPathForUrl(absoluteUrl, startUrl);
          link.setAttribute('href', getRelativePath(sourceLocalPath, targetLocalPath));

          const alreadyQueued = visited.has(absoluteUrl) || queue.some((item) => item.url === absoluteUrl);
          if (!alreadyQueued && currentDepth < maxDepth) {
            queue.push({ url: absoluteUrl, depth: currentDepth + 1 });
            addTableRow(absoluteUrl, targetLocalPath, currentDepth + 1, 'HTML Page');
          }
        } else {
          link.setAttribute('href', absoluteUrl); // keep external links absolute
        }
      } catch (_) {}
    }
  }

  function handleAssetTag(element, attrName, type, pageUrl, sourceLocalPath) {
    const attrValue = element.getAttribute(attrName);
    if (!attrValue || attrValue.startsWith('data:')) return;
    try {
      const absoluteUrl = new URL(attrValue, pageUrl).href;
      const targetLocalPath = getLocalPathForUrl(absoluteUrl, startUrl);
      element.setAttribute(attrName, getRelativePath(sourceLocalPath, targetLocalPath));
      enqueueAsset(absoluteUrl, type);
    } catch (_) {}
  }

  function rewriteResourceTags(doc, pageUrl, sourceLocalPath) {
    // Stylesheets & icons
    for (const tag of doc.querySelectorAll('link[href]')) {
      const rel = tag.getAttribute('rel')?.toLowerCase() || '';
      if (rel.includes('stylesheet')) {
        handleAssetTag(tag, 'href', 'css', pageUrl, sourceLocalPath);
      } else if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('image')) {
        handleAssetTag(tag, 'href', 'img', pageUrl, sourceLocalPath);
      }
    }

    // Scripts
    for (const tag of doc.querySelectorAll('script[src]')) {
      handleAssetTag(tag, 'src', 'js', pageUrl, sourceLocalPath);
    }

    // Images
    for (const tag of doc.querySelectorAll('img')) {
      if (tag.hasAttribute('src')) handleAssetTag(tag, 'src', 'img', pageUrl, sourceLocalPath);
      if (tag.hasAttribute('srcset')) {
        tag.setAttribute('srcset', rewriteSrcset(tag.getAttribute('srcset'), pageUrl, sourceLocalPath));
      }
    }

    // Media
    for (const tag of doc.querySelectorAll('video, audio, source, track')) {
      if (tag.hasAttribute('src')) handleAssetTag(tag, 'src', 'media', pageUrl, sourceLocalPath);
      if (tag.hasAttribute('srcset')) {
        tag.setAttribute('srcset', rewriteSrcset(tag.getAttribute('srcset'), pageUrl, sourceLocalPath));
      }
    }
  }

  function rewriteForms(doc, pageUrl) {
    for (const form of doc.querySelectorAll('form[action]')) {
      const action = form.getAttribute('action');
      if (action && !action.startsWith('#') && !action.startsWith('javascript:')) {
        try {
          form.setAttribute('action', new URL(action, pageUrl).href);
        } catch (_) {}
      }
    }
  }

  function rewriteInlineStyles(doc, pageUrl, sourceLocalPath) {
    for (const tag of doc.querySelectorAll('style')) {
      tag.textContent = rewriteStyleContent(tag.textContent, pageUrl, sourceLocalPath);
    }
    for (const tag of doc.querySelectorAll('[style]')) {
      tag.setAttribute('style', rewriteStyleContent(tag.getAttribute('style'), pageUrl, sourceLocalPath));
    }
  }

  /** Enqueues an asset for download, deduplicating by normalized URL & path. */
  function enqueueAsset(urlStr, type) {
    const normUrl = normalizeAssetUrl(urlStr);
    const normPath = getLocalPathForUrl(normUrl, startUrl);

    if (visited.has(normUrl) || processedAssets.has(normUrl)) return;
    if (localPathIndex.has(normPath)) return;

    try {
      const isExternal = new URL(normUrl).origin !== startOrigin;
      if (isExternal && !saveExternal) return;

      if (!assetsQueue.some((item) => item.url === normUrl)) {
        assetsQueue.push({ url: normUrl, localPath: normPath, type });
        addTableRow(normUrl, normPath, '--', type.toUpperCase());
      }
    } catch (_) {}
  }

  function rewriteSrcset(srcsetStr, baseUrl, sourceLocalPath) {
    return srcsetStr
      .split(',')
      .map((part) => {
        const trimmed = part.trim();
        if (!trimmed) return part;
        const segments = trimmed.split(/\s+/);
        try {
          const absoluteUrl = new URL(segments[0], baseUrl).href;
          const targetLocalPath = getLocalPathForUrl(absoluteUrl, startUrl);
          const ext = getFileExtension(absoluteUrl);
          const type = classifyAssetType(ext) === 'img' ? 'img' : 'other';
          enqueueAsset(absoluteUrl, type);
          segments[0] = getRelativePath(sourceLocalPath, targetLocalPath);
          return segments.join(' ');
        } catch (_) {
          return part;
        }
      })
      .join(', ');
  }

  /** Rewrites url(...) references inside inline style content/attributes. */
  function rewriteStyleContent(cssContent, sourceUrl, sourceLocalPath) {
    return cssContent.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (match, urlStr) => {
      if (urlStr.startsWith('data:')) return match;
      try {
        const absoluteUrl = new URL(urlStr, sourceUrl).href;
        const targetLocalPath = getLocalPathForUrl(absoluteUrl, startUrl);
        enqueueAsset(absoluteUrl, classifyAssetType(getFileExtension(absoluteUrl)));
        return `url('${getRelativePath(sourceLocalPath, targetLocalPath)}')`;
      } catch (_) {
        return match;
      }
    });
  }

  // ── Asset downloader & nested CSS scanner ─────────────────────────────────────
  async function downloadAssets() {
    statusDot.className = 'status-dot running';
    statusText.textContent = 'CRAWLER STATUS: COMPILING ASSETS';
    log('Initiating compilation for stylesheet, scripts, images, and fonts...', 'system');

    while (assetsQueue.length > 0 && isRunning) {
      const asset = assetsQueue.shift();
      if (processedAssets.has(asset.url)) continue;
      processedAssets.add(asset.url);

      log(`Downloading asset: ${asset.url}`, 'info');
      updateTableStatus(asset.url, 'downloading');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS);

      try {
        const response = await fetch(asset.url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        if (asset.type === 'css') {
          let cssContent = await response.text();
          cssContent = rewriteCssUrls(cssContent, asset.url);
          zip.file(asset.localPath, cssContent);
          localPathIndex.add(asset.localPath);
          stats.assetsGathered++;
          stats.totalSize += cssContent.length;
          stats.counts.css++;
          log(`Compiled CSS: ${asset.localPath}`, 'ok');
          updateTableStatus(asset.url, 'success', asset.localPath, cssContent.length);
        } else {
          const blob = await response.blob();
          zip.file(asset.localPath, blob);
          localPathIndex.add(asset.localPath);
          stats.assetsGathered++;
          stats.totalSize += blob.size;
          if (asset.type === 'js') stats.counts.js++;
          else if (asset.type === 'img') stats.counts.img++;
          else if (asset.type === 'font') stats.counts.font++;
          else stats.counts.other++;
          log(`Saved asset: ${asset.localPath} (${formatBytes(blob.size)})`, 'ok');
          updateTableStatus(asset.url, 'success', asset.localPath, blob.size);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          log(`Asset timed out (${ASSET_TIMEOUT_MS / 1000}s): ${asset.url}`, 'warn');
          updateTableStatus(asset.url, 'warning');
        } else {
          log(`Asset failed: ${asset.url} — ${err.message}`, 'err');
          updateTableStatus(asset.url, 'error');
        }
      }

      updateStats();
      updateProgressBar();

      if (assetsQueue.length > 0 && isRunning) {
        await sleep(ASSET_THROTTLE_MS);
      }
    }

    if (isRunning) {
      log('All asset downloads completed successfully.', 'system');
      finalizeCrawl();
    }
  }

  /** Scans CSS content for nested assets, enqueues them and rewrites URLs. */
  function rewriteCssUrls(cssContent, cssUrl) {
    const cssLocalPath = getLocalPathForUrl(cssUrl, startUrl);
    return cssContent.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (match, urlStr) => {
      if (urlStr.startsWith('data:')) return match;
      try {
        const absoluteUrl = new URL(urlStr, cssUrl).href;
        const targetLocalPath = getLocalPathForUrl(absoluteUrl, startUrl);
        enqueueAsset(absoluteUrl, classifyAssetType(getFileExtension(absoluteUrl)));
        return `url('${getRelativePath(cssLocalPath, targetLocalPath)}')`;
      } catch (_) {
        return match;
      }
    });
  }

  // ── Offline navigation injection ──────────────────────────────────────────────
  function injectOfflineNav(doc, localPath) {
    const depth = localPath.split('/').length - 1;
    const rel = depth > 0 ? '../'.repeat(depth) : '';

    const depthScript = doc.createElement('script');
    depthScript.textContent = `window.__BP_DEPTH__=${depth};`;

    const navScript = doc.createElement('script');
    navScript.setAttribute('src', rel + '_blueprint_nav.js');

    if (doc.head) {
      doc.head.appendChild(depthScript);
      doc.head.appendChild(navScript);
    }

    // For freeze-mode pages saved via normal fetch (e.g. login redirect),
    // inline the shim since the tab-capture step never ran.
    if (freezeMode && !doc.getElementById('__bp_shim_marker__')) {
      const shimScript = doc.createElement('script');
      shimScript.id = '__bp_shim_marker__';
      shimScript.textContent = generateFreezeShimInlineCode();
      doc.head.insertBefore(shimScript, doc.head.firstChild);
    }
  }

  // ── Finalization & ZIP packaging ──────────────────────────────────────────────
  function finalizeCrawl() {
    isRunning = false;
    if (stats.timerInterval) clearInterval(stats.timerInterval);

    zip.file('_blueprint_nav.js', generateBlueprintNavScript(siteMap));
    log(`Offline nav script generated (_blueprint_nav.js) — ${Object.keys(siteMap).length} pages mapped.`, 'zip');

    if (usedFreezeMode) {
      zip.file('_blueprint_freeze_shim.js', generateFreezeShimInlineCode());
      log('Freeze shim saved (_blueprint_freeze_shim.js) — AJAX blocker & DataTables patch included.', 'zip');
    }

    statusDot.className = 'status-dot finished';
    statusText.textContent = 'CRAWLER STATUS: READY TO EXPORT';
    progressBar.style.width = '100%';
    progressPercent.textContent = '100%';

    startBtn.disabled = false;
    stopBtn.disabled = true;
    downloadZipBtn.disabled = false;

    log(`Compilation sequence finished. Final totals - Pages: ${stats.pagesCrawled}, Assets: ${stats.assetsGathered}, Total Zip Weight: ${formatBytes(stats.totalSize)}`, 'highlight');
    log('Ready to generate offline package. Click "Download Offline ZIP" to save.', 'zip');
  }

  async function downloadZip() {
    if (!zip) return;

    downloadZipBtn.disabled = true;
    statusDot.className = 'status-dot packaging';
    statusText.textContent = 'CRAWLER STATUS: PACKAGING ARCHIVE';
    log('Packaging offline blueprint files into a structured ZIP file. Please wait...', 'zip');

    try {
      const content = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        const percent = metadata.percent.toFixed(0);
        progressPercent.textContent = `${percent}%`;
        progressBar.style.width = `${percent}%`;
      });

      const filename = new URL(startUrl).hostname.replace(/[^a-zA-Z0-9]/g, '_') + '_blueprint.zip';
      log(`Archiving completed. Initiating browser download for: ${filename}`, 'ok');

      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      log('Download successfully completed!', 'ok');
    } catch (err) {
      log(`Error generating ZIP file: ${err.message}`, 'err');
    } finally {
      statusDot.className = 'status-dot finished';
      statusText.textContent = 'CRAWLER STATUS: COMPLETED';
      downloadZipBtn.disabled = false;
      progressBar.style.width = '100%';
      progressPercent.textContent = '100%';
    }
  }
});
