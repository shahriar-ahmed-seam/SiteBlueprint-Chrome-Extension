// SiteBlueprint Dashboard Scraper Engine
document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
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

  // Stats Elements
  const statPages = document.getElementById('stat-pages');
  const statAssets = document.getElementById('stat-assets');
  const statQueueInfo = document.getElementById('stat-queue-info');
  const statAssetsBreakdown = document.getElementById('stat-assets-breakdown');
  const statSize = document.getElementById('stat-size');
  const statSpeed = document.getElementById('stat-speed');
  const statTime = document.getElementById('stat-time');

  // Engine Variables
  let isRunning = false;
  let isPaused = false;
  let startUrl = '';
  let startOrigin = '';
  let loginUrl = ''; // Detected login page URL for redirect detection
  let sessionInvalidated = false; // True once we detect a session redirect mid-crawl
  let maxDepth = 3;
  let crawlDelay = 300;
  let saveExternal = true;
  let freezeMode = false;   // When true, capture real rendered DOM via tab
  let freezeWait = 2500;   // ms to wait after page load for AJAX data
  let elapsedSeconds = 0;
  let usedFreezeMode = false; // Track if any page was frozen (for shim file inclusion)
  
  // Queues and Lists
  let queue = []; // Array of { url: '', depth: 0 }
  let visited = new Map(); // Map of urlStr -> localPath
  let assetsQueue = []; // Array of { url: '', localPath: '', type: '' }
  let processedAssets = new Set(); // Set of URL strings
  let localPathIndex = new Set(); // Set of local paths already saved (prevents duplicate overwrite)
  let siteMap = {}; // Maps URL pathname -> localPath for offline navigation
  let zip = null;
  
  // Stats Object
  let stats = {
    pagesCrawled: 0,
    assetsGathered: 0,
    totalSize: 0,
    startTime: 0,
    timerInterval: null,
    counts: { css: 0, js: 0, img: 0, font: 0, other: 0 }
  };

  // DOM Rows Map
  const urlToRowElements = new Map();

  // Load URL from query parameters
  const urlParams = new URLSearchParams(window.location.search);
  const paramUrl = urlParams.get('url');
  if (paramUrl) {
    try {
      const parsed = new URL(paramUrl);
      startUrlInput.value = parsed.href;
      domainBadge.textContent = parsed.hostname;
      log(`Detected active tab URL: ${parsed.href}`, 'highlight');
    } catch (e) {
      log(`Invalid target URL passed in parameter: ${paramUrl}`, 'err');
    }
  }

  // Pre-populate exclusion field with known destructive defaults
  if (!excludePatternsInput.value.trim()) {
    excludePatternsInput.value = 'logout, signout, log-out, sign-out';
  }

  // Monitor target URL changes to update badge
  startUrlInput.addEventListener('input', (e) => {
    try {
      const url = new URL(e.target.value.trim());
      domainBadge.textContent = url.hostname;
    } catch(err) {
      domainBadge.textContent = 'Invalid URL';
    }
  });

  // Freeze mode toggle wiring
  freezeModeCheckbox.addEventListener('change', () => {
    const isOn = freezeModeCheckbox.checked;
    freezeWaitGroup.style.display = isOn ? 'flex' : 'none';
    freezeModeGroup.classList.toggle('active', isOn);
    if (isOn) {
      log('❄ Freeze Live Data mode enabled. Pages will be opened in background tabs to capture real rendered DOM with AJAX data.', 'freeze');
    }
  });

  // Clear log console
  clearConsoleBtn.addEventListener('click', () => {
    terminalLog.innerHTML = '';
    log('Console logs cleared.', 'system');
  });

  // Table Search Filter
  tableSearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    for (const [url, elements] of urlToRowElements.entries()) {
      const pathText = elements.row.querySelector('.col-path').textContent.toLowerCase();
      const urlText = url.toLowerCase();
      if (pathText.includes(query) || urlText.includes(query)) {
        elements.row.style.display = '';
      } else {
        elements.row.style.display = 'none';
      }
    }
  });

  // Setup Event Listeners for actions
  startBtn.addEventListener('click', startCrawling);
  stopBtn.addEventListener('click', stopCrawling);
  downloadZipBtn.addEventListener('click', downloadZip);

  // Helper: Sleep utility
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Helper: Log message to terminal console
  function log(message, type = 'info') {
    const line = document.createElement('div');
    line.className = `terminal-line ${type}-line`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${message}`;
    terminalLog.appendChild(line);
    terminalLog.scrollTop = terminalLog.scrollHeight;
  }

  // Helper: Format size bytes
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Helper: Format elapsed time
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  // Helper: Extract file extension
  function getFileExtension(urlStr) {
    try {
      const path = new URL(urlStr).pathname;
      const lastSegment = path.split('/').pop();
      if (lastSegment.includes('.')) {
        return lastSegment.split('.').pop().split(/[?#]/)[0].toLowerCase();
      }
    } catch(e) {}
    return '';
  }

  // ==========================================================================
  // Path Resolution & Sanitization Engine
  // ==========================================================================
  
  // Converts any URL into a relative local project path
  function getLocalPathForUrl(urlStr, baseUrl) {
    try {
      const url = new URL(urlStr, baseUrl);
      const base = new URL(baseUrl);
      
      if (url.origin === base.origin) {
        return urlToLocalPath(url.href, base.origin);
      } else {
        // External Assets
        let extPath = url.pathname;
        if (extPath === '/' || extPath === '') {
          extPath = '/index.html';
        }
        
        let hostname = url.hostname;
        // Clean hostname
        hostname = hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
        
        // Build path under external/
        let fullPath = 'external/' + hostname + extPath;
        
        // Ensure directory endings have index.html
        if (fullPath.endsWith('/')) {
          fullPath += 'index.html';
        }
        
        // Inject extension if it's dynamic
        const lastSegment = fullPath.split('/').pop();
        if (!lastSegment.includes('.')) {
          // Check URL query parameters or default to .html
          const ext = getFileExtension(urlStr);
          fullPath += ext ? `.${ext}` : '.html';
        }
        
        return fullPath;
      }
    } catch(e) {
      // Fallback
      return 'assets/corrupted_path';
    }
  }

  // Internal path mapping rules
  function urlToLocalPath(urlStr, domainOrigin) {
    const url = new URL(urlStr);
    let path = url.pathname;
    let search = url.search;
    
    if (path === '/' || path === '') {
      path = 'index.html';
    } else {
      // Decode
      path = decodeURIComponent(path);
      
      // Remove leading slash
      if (path.startsWith('/')) {
        path = path.slice(1);
      }
      
      // Handle trailing slash
      if (path.endsWith('/')) {
        path = path + 'index.html';
      } else {
        // Check if there is a file extension
        const lastSegment = path.split('/').pop();
        if (!lastSegment.includes('.')) {
          path = path + '.html'; // Dynamic route like /purchases/create
        }
      }
    }
    
    // Append search params as part of filename to support paginated or filtered views offline
    if (search) {
      // Sanitize search parameters: remove '?' and replace '&' / '=' with underscores
      let sanitizedSearch = search.replace(/^\?/, '_').replace(/[&=]/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
      if (sanitizedSearch.length > 40) {
        sanitizedSearch = sanitizedSearch.slice(0, 40); // Cap length
      }
      
      const dotIndex = path.lastIndexOf('.');
      if (dotIndex !== -1) {
        path = path.slice(0, dotIndex) + sanitizedSearch + path.slice(dotIndex);
      } else {
        path = path + sanitizedSearch;
      }
    }
    
    return path;
  }

  // Calculates a relative directory jump (e.g. "../" or "../../") from one local path to another
  function getRelativePath(fromPath, toPath) {
    const fromParts = fromPath.split('/');
    fromParts.pop(); // Remove the filename itself
    
    if (fromParts.length === 0) {
      return toPath;
    }
    
    const upCount = fromParts.length;
    const prefix = '../'.repeat(upCount);
    return prefix + toPath;
  }

  // ==========================================================================
  // Exclusions Parser
  // ==========================================================================
  function getExclusions() {
    const text = excludePatternsInput.value;
    return text.split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  function isExcluded(pathname) {
    const exclusions = getExclusions();
    return exclusions.some(pattern => {
      // Regex check: /pattern/
      if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
        try {
          const regex = new RegExp(pattern.slice(1, -1), 'i');
          return regex.test(pathname);
        } catch(e) {}
      }
      // String check
      return pathname.toLowerCase().includes(pattern.toLowerCase());
    });
  }

  // ==========================================================================
  // Interactive Table Builders
  // ==========================================================================
  function addTableRow(urlStr, localPath, depth, type) {
    if (urlToRowElements.has(urlStr)) return;
    
    // Remove initial empty row
    const emptyRow = blueprintTbody.querySelector('.empty-row');
    if (emptyRow) {
      emptyRow.remove();
    }
    
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
    
    // Cache UI references
    urlToRowElements.set(urlStr, {
      badge: spanBadge,
      sizeCell: tdSize,
      row: tr
    });
  }

  function updateTableStatus(urlStr, status, localPath = null, sizeInBytes = null) {
    const elements = urlToRowElements.get(urlStr);
    if (!elements) return;
    
    elements.badge.className = `badge ${status}`;
    elements.badge.textContent = status;
    
    if (localPath) {
      elements.row.querySelector('.col-path').textContent = localPath;
    }
    
    if (sizeInBytes !== null) {
      elements.sizeCell.textContent = formatBytes(sizeInBytes);
    }
  }

  // ==========================================================================
  // Stats Display Updater
  // ==========================================================================
  function updateStats() {
    statPages.textContent = stats.pagesCrawled;
    statAssets.textContent = stats.assetsGathered;
    statSize.textContent = formatBytes(stats.totalSize);
    
    // Queue details
    statQueueInfo.textContent = `Queue: ${queue.length} pending`;
    
    // Assets break-downs
    statAssetsBreakdown.textContent = `CSS: ${stats.counts.css} | JS: ${stats.counts.js} | Img: ${stats.counts.img} | Font/Other: ${stats.counts.font + stats.counts.other}`;
    
    // Calculate speed
    if (elapsedSeconds > 0) {
      const speedMb = (stats.totalSize / (1024 * 1024)) / elapsedSeconds;
      const pagesSec = stats.pagesCrawled / elapsedSeconds;
      statSpeed.textContent = `Speed: ${pagesSec.toFixed(1)} p/s (${formatBytes(stats.totalSize / elapsedSeconds)}/s)`;
    } else {
      statSpeed.textContent = `Speed: -- /s`;
    }
  }

  // ==========================================================================
  // Crawler Controller & Core BFS Logic
  // ==========================================================================
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
    } catch(e) {
      alert('Invalid URL structure. Please provide a full address, e.g. https://example.com');
      return;
    }
    
    // Clear state
    isRunning = true;
    isPaused = false;
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
    
    maxDepth = parseInt(maxDepthSelect.value);
    crawlDelay = parseInt(crawlDelayInput.value);
    saveExternal = saveExternalCheckbox.checked;
    freezeMode = freezeModeCheckbox.checked;
    freezeWait = parseInt(freezeWaitInput.value) || 2500;
    usedFreezeMode = freezeMode; // track for finalizeCrawl
    
    zip = new JSZip();
    
    stats = {
      pagesCrawled: 0,
      assetsGathered: 0,
      totalSize: 0,
      startTime: Date.now(),
      counts: { css: 0, js: 0, img: 0, font: 0, other: 0 }
    };
    elapsedSeconds = 0;
    
    // UI states
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
    
    // Start elapsed timer
    statTime.textContent = '00:00';
    if (stats.timerInterval) clearInterval(stats.timerInterval);
    stats.timerInterval = setInterval(() => {
      elapsedSeconds++;
      statTime.textContent = formatTime(elapsedSeconds);
      updateStats();
    }, 1000);
    
    // Add start URL to queue
    const rootPath = getLocalPathForUrl(startUrl, startUrl);
    queue.push({ url: startUrl, depth: 0 });
    addTableRow(startUrl, rootPath, 0, 'HTML Page (Root)');
    
    // Trigger compilation
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

  // ==========================================================================
  // Page Fetching: fetch() mode vs. Freeze (tab-based DOM capture) mode
  // ==========================================================================

  /**
   * Unified page fetch entry point.
   * In normal mode  : uses fetch() with credentials (fast, no JS rendering).
   * In freeze mode  : opens a background Chrome tab, waits for the page to
   *                   fully render (including AJAX data), captures outerHTML,
   *                   then closes the tab.
   * Returns { htmlText, finalUrl, contentType }
   */
  async function fetchPageHtml(url) {
    if (!freezeMode) {
      // ── Standard fetch path ───────────────────────────────────────────────
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('Content-Type') || '';
      const finalUrl = response.url;
      const htmlText = contentType.includes('text/html') ? await response.text() : '';
      return { htmlText, finalUrl, contentType };
    }

    // ── Freeze mode: tab-based DOM capture ────────────────────────────────
    return new Promise((resolve, reject) => {
      let tabId = null;
      let settled = false;
      const TIMEOUT = Math.max(freezeWait + 15000, 20000); // hard safety timeout

      const cleanup = () => {
        if (tabId !== null) {
          chrome.tabs.remove(tabId, () => { /* ignore */ });
          tabId = null;
        }
      };

      const fail = (msg) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(msg));
      };

      // Safety timeout so a hung page never blocks the queue forever
      const timeoutHandle = setTimeout(() => fail(`Freeze timeout after ${TIMEOUT}ms`), TIMEOUT);

      // Listen for the tab finishing loading
      const onUpdated = (tid, changeInfo) => {
        if (tid !== tabId || changeInfo.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(onUpdated);

        // Wait extra time for AJAX/JS to render data
        setTimeout(async () => {
          if (settled) return;
          try {
            // Capture the tab's final URL (handle redirects)
            const tab = await chrome.tabs.get(tabId);
            const finalUrl = tab.url || url;
            const contentType = finalUrl.match(/\.(css|js|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot)($|\?)/i)
              ? 'application/octet-stream'
              : 'text/html';

            // Inject script to capture fully rendered outerHTML
            // First, inject the freeze shim inline so DataTables AJAX calls
            // are blocked BEFORE outerHTML is serialised (the shim stays in
            // the HTML and runs again when the user opens the local page).
            const shimScript = generateFreezeShimInlineCode();
            await chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: (shim) => {
                const s = document.createElement('script');
                s.id = '__bp_shim_marker__';
                s.textContent = shim;
                (document.head || document.documentElement).prepend(s);
              },
              args: [shimScript]
            });

            const results = await chrome.scripting.executeScript({
              target: { tabId: tabId },
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

      // Open a background (inactive) tab
      chrome.tabs.create({ url, active: false }, (tab) => {
        if (chrome.runtime.lastError) {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          fail(`Tab creation error: ${chrome.runtime.lastError.message}`);
          return;
        }
        tabId = tab.id;
        // If tab is already complete (e.g. cached page), fire immediately
        if (tab.status === 'complete') {
          onUpdated(tabId, { status: 'complete' });
        }
      });
    });
  }

  // ---- Login / Auth redirect detection helpers ----

  // Patterns that indicate a login page redirect
  const LOGIN_PATTERNS = [/\/login/, /\/signin/, /\/sign-in/, /\/auth/, /\/session\/new/];

  function isLoginUrl(urlStr) {
    try {
      const path = new URL(urlStr).pathname.toLowerCase();
      return LOGIN_PATTERNS.some(re => re.test(path));
    } catch(e) { return false; }
  }

  function isRedirectedToLogin(requestedUrl, finalUrl) {
    if (requestedUrl === finalUrl) return false;
    // If we already know the login URL, check directly
    if (loginUrl && finalUrl === loginUrl) return true;
    // Detect by path pattern
    return isLoginUrl(finalUrl);
  }

  async function crawlEngine() {
    while (queue.length > 0 && isRunning) {
      const current = queue.shift();
      
      // Skip if already crawled
      if (visited.has(current.url)) {
        continue;
      }

      // If session was invalidated, mark remaining queue items and stop
      if (sessionInvalidated) {
        log(`Skipping ${current.url} — session expired, remaining queue cleared.`, 'warn');
        updateTableStatus(current.url, 'warning');
        continue;
      }
      
      log(`${freezeMode ? '❄ Freezing' : 'Loading'} target: ${current.url}`, 'info');
      updateTableStatus(current.url, 'downloading');
      
      try {
        const { htmlText, finalUrl, contentType } = await fetchPageHtml(current.url);

        // ── Auth redirect detection ─────────────────────────────────────────
        if (isRedirectedToLogin(current.url, finalUrl)) {
          // Record the login URL so further redirects are caught immediately
          if (!loginUrl) {
            loginUrl = finalUrl;
            log(`Auth redirect detected! Login page identified as: ${finalUrl}`, 'warn');
          }

          // If this is the FIRST auth redirect (login page itself), save it once
          if (!localPathIndex.has('login.html') && !visited.has(finalUrl)) {
            const loginLocalPath = getLocalPathForUrl(finalUrl, startUrl);
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, 'text/html');
            processHtmlDocument(doc, finalUrl, current.depth);
            injectOfflineNav(doc, loginLocalPath);
            const serializedHtml = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
            zip.file(loginLocalPath, serializedHtml);
            localPathIndex.add(loginLocalPath);
            try { siteMap[new URL(finalUrl).pathname] = loginLocalPath; } catch(e) {}
            visited.set(finalUrl, loginLocalPath);
            stats.pagesCrawled++;
            stats.totalSize += serializedHtml.length;
            log(`Login page saved: ${loginLocalPath}`, 'ok');
            updateTableStatus(current.url, 'warning', loginLocalPath, serializedHtml.length);
          } else {
            // Subsequent pages redirect to login = session is now gone
            sessionInvalidated = true;
            visited.set(current.url, 'login.html'); // map so we don't re-queue
            log(`[AUTH] Session expired — ${current.url} redirected to login. Queued pages will be skipped.`, 'warn');
            updateTableStatus(current.url, 'warning', '⚠ auth-required');
          }

          updateStats();
          updateProgressBar();
          continue; // do NOT process this page's links — avoid crawling login form links
        }
        // ── End auth redirect detection ──────────────────────────────────────
        
        // Map original URL to local path
        const localPath = getLocalPathForUrl(finalUrl, startUrl);
        visited.set(current.url, localPath);
        
        // Handle redirect mappings
        if (finalUrl !== current.url) {
          visited.set(finalUrl, localPath);
          log(`Redirected to: ${finalUrl} (Mapped to: ${localPath})`, 'info');
        }

        // Skip if we already stored this local path from another URL (duplicate redirect)
        if (localPathIndex.has(localPath)) {
          log(`Duplicate path skipped: ${localPath} (already saved)`, 'info');
          updateTableStatus(current.url, 'success', localPath);
          updateStats();
          updateProgressBar();
          continue;
        }
        
        if (contentType.includes('text/html')) {
          // Parse DOM (htmlText already resolved above)
          const parser = new DOMParser();
          const doc = parser.parseFromString(htmlText, 'text/html');
          
          // Process and crawl nodes
          processHtmlDocument(doc, finalUrl, current.depth);

          // Register in sitemap for offline nav
          try { siteMap[new URL(finalUrl).pathname] = localPath; } catch(e) {}

          // Inject offline navigation interceptor
          injectOfflineNav(doc, localPath);

          // Serialize and bundle HTML
          const serializedHtml = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
          zip.file(localPath, serializedHtml);
          localPathIndex.add(localPath);
          
          stats.pagesCrawled++;
          stats.totalSize += serializedHtml.length;
          
          log(`Saved page: ${localPath} (${formatBytes(serializedHtml.length)})`, 'ok');
          updateTableStatus(current.url, 'success', localPath, serializedHtml.length);
          
        } else {
          // Dynamic content that isn't html, store as asset
          log(`Asset content-type detected on page fetch: ${contentType}. Storing as blob.`, 'warn');
          const blob = await response.blob();
          
          zip.file(localPath, blob);
          localPathIndex.add(localPath);
          stats.assetsGathered++;
          stats.totalSize += blob.size;
          stats.counts.other++;
          
          log(`Saved binary resource: ${localPath} (${formatBytes(blob.size)})`, 'ok');
          updateTableStatus(current.url, 'success', localPath, blob.size);
        }
        
      } catch (err) {
        log(`${freezeMode ? 'Freeze' : 'Fetch'} failure on: ${current.url} - ${err.message}`, 'err');
        updateTableStatus(current.url, 'error');
      }
      
      // Update stats and progress bar
      updateStats();
      updateProgressBar();
      
      // Throttle delay
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

  // Update progress bar helper
  function updateProgressBar() {
    const totalDiscovered = urlToRowElements.size;
    const completed = stats.pagesCrawled + processedAssets.size;
    if (totalDiscovered > 0) {
      const percentage = Math.min(100, Math.floor((completed / totalDiscovered) * 100));
      progressBar.style.width = `${percentage}%`;
      progressPercent.textContent = `${percentage}%`;
    }
  }

  // ==========================================================================
  // DOM Link and Asset Scraping/Rewriting Parser
  // ==========================================================================
  function processHtmlDocument(doc, pageUrl, currentDepth) {
    const sourceLocalPath = getLocalPathForUrl(pageUrl, startUrl);
    
    // Inject UTF-8 meta charset if missing
    let hasCharset = false;
    const metas = doc.querySelectorAll('meta');
    for (const meta of metas) {
      if (meta.getAttribute('charset') || meta.getAttribute('http-equiv')?.toLowerCase() === 'content-type') {
        hasCharset = true;
        break;
      }
    }
    if (!hasCharset) {
      const charsetMeta = doc.createElement('meta');
      charsetMeta.setAttribute('charset', 'UTF-8');
      doc.head.insertBefore(charsetMeta, doc.head.firstChild);
    }

    // 1. Process <a> Links
    const links = doc.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        continue;
      }
      
      try {
        const absoluteUrl = new URL(href, pageUrl).href;
        const parsedUrl = new URL(absoluteUrl);
        
        // In-domain filter
        if (parsedUrl.origin === startOrigin) {
          if (isExcluded(parsedUrl.pathname)) {
            continue; // Skip excluded URLs
          }
          
          const targetLocalPath = getLocalPathForUrl(absoluteUrl, startUrl);
          const relPath = getRelativePath(sourceLocalPath, targetLocalPath);
          
          link.setAttribute('href', relPath);
          
          // Queue for crawl if within depth bounds and not visited
          if (!visited.has(absoluteUrl) && !queue.some(item => item.url === absoluteUrl)) {
            if (currentDepth < maxDepth) {
              queue.push({ url: absoluteUrl, depth: currentDepth + 1 });
              addTableRow(absoluteUrl, targetLocalPath, currentDepth + 1, 'HTML Page');
            }
          }
        } else {
          // External link
          link.setAttribute('href', absoluteUrl);
        }
      } catch(e) {}
    }

    // Helper: Asset handler for elements
    function handleAssetTag(element, attrName, type) {
      const attrValue = element.getAttribute(attrName);
      if (!attrValue || attrValue.startsWith('data:')) return;
      
      try {
        const absoluteUrl = new URL(attrValue, pageUrl).href;
        const targetLocalPath = getLocalPathForUrl(absoluteUrl, startUrl);
        const relPath = getRelativePath(sourceLocalPath, targetLocalPath);
        
        element.setAttribute(attrName, relPath);
        enqueueAsset(absoluteUrl, targetLocalPath, type);
      } catch(e) {}
    }

    // 2. Process Stylesheets & Icons
    const linkTags = doc.querySelectorAll('link[href]');
    for (const tag of linkTags) {
      const rel = tag.getAttribute('rel')?.toLowerCase() || '';
      if (rel.includes('stylesheet')) {
        handleAssetTag(tag, 'href', 'css');
      } else if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('image')) {
        handleAssetTag(tag, 'href', 'img');
      }
    }

    // 3. Process Scripts
    const scriptTags = doc.querySelectorAll('script[src]');
    for (const tag of scriptTags) {
      handleAssetTag(tag, 'src', 'js');
    }

    // 4. Process Images
    const imgTags = doc.querySelectorAll('img');
    for (const tag of imgTags) {
      if (tag.hasAttribute('src')) {
        handleAssetTag(tag, 'src', 'img');
      }
      if (tag.hasAttribute('srcset')) {
        const srcsetVal = tag.getAttribute('srcset');
        const rewrittenSrcset = rewriteSrcset(srcsetVal, pageUrl, sourceLocalPath);
        tag.setAttribute('srcset', rewrittenSrcset);
      }
    }

    // 5. Process Media Elements
    const mediaTags = doc.querySelectorAll('video, audio, source, track');
    for (const tag of mediaTags) {
      if (tag.hasAttribute('src')) {
        handleAssetTag(tag, 'src', 'media');
      }
      if (tag.hasAttribute('srcset')) {
        const srcsetVal = tag.getAttribute('srcset');
        const rewrittenSrcset = rewriteSrcset(srcsetVal, pageUrl, sourceLocalPath);
        tag.setAttribute('srcset', rewrittenSrcset);
      }
    }

    // 6. Fix Form Action Paths to ensure online submission integrity
    const forms = doc.querySelectorAll('form[action]');
    for (const form of forms) {
      const action = form.getAttribute('action');
      if (action && !action.startsWith('#') && !action.startsWith('javascript:')) {
        try {
          form.setAttribute('action', new URL(action, pageUrl).href);
        } catch (e) {}
      }
    }

    // 7. Styles Blocks (<style>)
    const styleTags = doc.querySelectorAll('style');
    for (const tag of styleTags) {
      const rewrittenCss = rewriteStyleContent(tag.textContent, pageUrl, sourceLocalPath);
      tag.textContent = rewrittenCss;
    }

    // 8. Inline Style Attributes
    const inlineStyles = doc.querySelectorAll('[style]');
    for (const tag of inlineStyles) {
      const styleAttr = tag.getAttribute('style');
      const rewrittenCss = rewriteStyleContent(styleAttr, pageUrl, sourceLocalPath);
      tag.setAttribute('style', rewrittenCss);
    }
  }

  // Helper: Normalize asset URL — strips fragment (#iefix, #glyph, etc.) and
  // empty query strings that browsers add for IE compat but don't affect the file.
  // e.g. font.eot?#iefix and font.eot?v=2.0.0#iefix all → font.eot
  const ASSET_EXTS = new Set(['eot','woff','woff2','ttf','otf','svg','png','jpg','jpeg','gif','webp','ico','mp4','mp3','wav','pdf']);

  function normalizeAssetUrl(urlStr) {
    try {
      const url = new URL(urlStr);
      url.hash = ''; // Strip #iefix, #glyph, etc. — never changes the downloaded file
      // Strip query if it's empty (just '?') or if this is a binary asset (cache-bust only)
      const ext = url.pathname.split('.').pop().toLowerCase();
      if (url.search === '?' || ASSET_EXTS.has(ext)) {
        url.search = '';
      }
      return url.href;
    } catch(e) { return urlStr; }
  }

  // Helper: Enqueue assets
  function enqueueAsset(urlStr, localPath, type) {
    // Normalize away fragment/IE-compat suffixes before deduplication
    const normUrl = normalizeAssetUrl(urlStr);
    const normPath = getLocalPathForUrl(normUrl, startUrl);

    if (visited.has(normUrl) || processedAssets.has(normUrl)) return;
    // Also skip if this local file path was already saved or queued under a different URL
    if (localPathIndex.has(normPath)) return;
    
    // Check external filters
    try {
      const url = new URL(normUrl);
      const isExternal = url.origin !== startOrigin;
      
      if (isExternal && !saveExternal) {
        return;
      }
      
      if (!assetsQueue.some(item => item.url === normUrl)) {
        assetsQueue.push({ url: normUrl, localPath: normPath, type });
        addTableRow(normUrl, normPath, '--', type.toUpperCase());
      }
    } catch(e) {}
  }

  // Helper: Rewrites srcset values
  function rewriteSrcset(srcsetStr, baseUrl, sourceLocalPath) {
    const parts = srcsetStr.split(',');
    const rewrittenParts = parts.map(part => {
      const trimmed = part.trim();
      if (!trimmed) return part;
      
      const segments = trimmed.split(/\s+/);
      const urlStr = segments[0];
      try {
        const absoluteUrl = new URL(urlStr, baseUrl).href;
        const targetLocalPath = getLocalPathForUrl(absoluteUrl, startUrl);
        const relPath = getRelativePath(sourceLocalPath, targetLocalPath);
        
        // Extract type
        const ext = getFileExtension(absoluteUrl);
        const type = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext) ? 'img' : 'other';
        
        enqueueAsset(absoluteUrl, targetLocalPath, type);
        segments[0] = relPath;
        return segments.join(' ');
      } catch(e) {
        return part;
      }
    });
    return rewrittenParts.join(', ');
  }

  // Helper: Scanner for URL styles in HTML attributes/style tags
  function rewriteStyleContent(cssContent, sourceUrl, sourceLocalPath) {
    return cssContent.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (match, urlStr) => {
      if (urlStr.startsWith('data:')) return match;
      try {
        const absoluteUrl = new URL(urlStr, sourceUrl).href;
        const targetLocalPath = getLocalPathForUrl(absoluteUrl, startUrl);
        const relPath = getRelativePath(sourceLocalPath, targetLocalPath);
        
        // Determine type
        const ext = getFileExtension(absoluteUrl);
        let type = 'other';
        if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) type = 'img';
        else if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) type = 'font';
        
        enqueueAsset(absoluteUrl, targetLocalPath, type);
        return `url('${relPath}')`;
      } catch(e) {
        return match;
      }
    });
  }

  // ==========================================================================
  // Asset Downloader & CSS Sub-Asset Scanner Loop
  // ==========================================================================
  async function downloadAssets() {
    statusDot.className = 'status-dot running';
    statusText.textContent = 'CRAWLER STATUS: COMPILING ASSETS';
    log('Initiating compilation for stylesheet, scripts, images, and fonts...', 'system');
    
    // Process queue with a while loop as CSS parses might append nested assets dynamically
    while (assetsQueue.length > 0 && isRunning) {
      const asset = assetsQueue.shift();
      if (processedAssets.has(asset.url)) continue;
      processedAssets.add(asset.url);
      
      log(`Downloading asset: ${asset.url}`, 'info');
      updateTableStatus(asset.url, 'downloading');
      
      // Per-asset timeout (15 seconds) so a hung request never blocks the queue
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(asset.url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        if (asset.type === 'css') {
          // Parse and rewrite nested background images/fonts inside CSS files
          let cssContent = await response.text();
          cssContent = rewriteCssUrls(cssContent, asset.url, startUrl);
          
          zip.file(asset.localPath, cssContent);
          localPathIndex.add(asset.localPath);
          stats.assetsGathered++;
          stats.totalSize += cssContent.length;
          stats.counts.css++;
          
          log(`Compiled CSS: ${asset.localPath}`, 'ok');
          updateTableStatus(asset.url, 'success', asset.localPath, cssContent.length);
        } else {
          // Save standard binary asset
          const blob = await response.blob();
          zip.file(asset.localPath, blob);
          localPathIndex.add(asset.localPath);
          stats.assetsGathered++;
          stats.totalSize += blob.size;
          
          // Increment stats counts
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
          log(`Asset timed out (15s): ${asset.url}`, 'warn');
          updateTableStatus(asset.url, 'warning');
        } else {
          log(`Asset failed: ${asset.url} — ${err.message}`, 'err');
          updateTableStatus(asset.url, 'error');
        }
      }
      
      updateStats();
      updateProgressBar();
      
      // Short delay between asset downloads to limit server hits
      if (assetsQueue.length > 0 && isRunning) {
        await sleep(50);
      }
    }
    
    if (isRunning) {
      log('All asset downloads completed successfully.', 'system');
      finalizeCrawl();
    }
  }

  // Scans CSS content for nested assets and updates them
  function rewriteCssUrls(cssContent, cssUrl, baseUrl) {
    const cssLocalPath = getLocalPathForUrl(cssUrl, baseUrl);
    
    return cssContent.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (match, urlStr) => {
      if (urlStr.startsWith('data:')) return match;
      try {
        const absoluteUrl = new URL(urlStr, cssUrl).href;
        const targetLocalPath = getLocalPathForUrl(absoluteUrl, baseUrl);
        const relPath = getRelativePath(cssLocalPath, targetLocalPath);
        
        // Enqueue discovered sub-asset
        const ext = getFileExtension(absoluteUrl);
        let type = 'other';
        if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) type = 'img';
        else if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) type = 'font';
        
        enqueueAsset(absoluteUrl, targetLocalPath, type);
        return `url('${relPath}')`;
      } catch(e) {
        return match;
      }
    });
  }

  // ==========================================================================
  // Offline Navigation Helpers
  // ==========================================================================

  // Injects the __BP_DEPTH__ marker and a reference to _blueprint_nav.js into
  // each saved page so links & SPA routing work locally.
  // For frozen pages the freeze shim is ALREADY embedded inline by the tab
  // capture step; we add a reference to the external file only as a fallback.
  function injectOfflineNav(doc, localPath) {
    const depth = localPath.split('/').length - 1;
    const rel = depth > 0 ? '../'.repeat(depth) : '';

    // Depth marker (read by the nav script)
    const depthScript = doc.createElement('script');
    depthScript.textContent = `window.__BP_DEPTH__=${depth};`;

    // Reference to the shared nav interceptor at ZIP root
    const navScript = doc.createElement('script');
    navScript.setAttribute('src', rel + '_blueprint_nav.js');

    if (doc.head) {
      doc.head.appendChild(depthScript);
      doc.head.appendChild(navScript);
    }

    // For freeze-mode pages that were NOT processed through the tab capture
    // (e.g. the login redirect page saved from normal fetch), inject shim inline.
    if (freezeMode && !doc.getElementById('__bp_shim_marker__')) {
      const shimScript = doc.createElement('script');
      shimScript.id = '__bp_shim_marker__';
      shimScript.textContent = generateFreezeShimInlineCode();
      doc.head.insertBefore(shimScript, doc.head.firstChild);
    }
  }

  // ==========================================================================
  // Freeze Shim: blocks XHR/fetch & patches DataTables for offline use
  // ==========================================================================

  /**
   * Returns the JS source for the freeze shim that is embedded inline into
   * every frozen HTML page.  It runs before any page JS and:
   *   1. Replaces XMLHttpRequest with a stub that returns empty JSON {}  for
   *      same-origin and relative requests (prevents DataTables "Invalid JSON"
   *      alerts and similar AJAX errors).
   */
  function generateFreezeShimInlineCode() {
    return `/* SiteBlueprint Freeze Shim — auto-injected, do not edit */
(function(){
'use strict';
if(window.__BP_SHIM_ACTIVE__) return;
window.__BP_SHIM_ACTIVE__ = true;

// ── 0. Suppress DataTables alert dialogs ────────────────────────────────────
var _nativeAlert = window.alert;
window.alert = function(msg) {
  if (typeof msg === 'string' && msg.indexOf('DataTables warning') !== -1) {
    console.warn('[SiteBlueprint Freeze] Suppressed DataTables alert:', msg);
    return;
  }
  return _nativeAlert.apply(this, arguments);
};

// ── 1. XMLHttpRequest stub ──────────────────────────────────────────────────
var _NativeXHR = window.XMLHttpRequest;
function FrozenXHR() {
  var real = new _NativeXHR();
  var _isFrozen = false;
  this.open = function(method, url) {
    try {
      var abs = new URL(url, window.location.href);
      _isFrozen = (abs.origin === window.location.origin || abs.protocol === 'file:');
    } catch(e) { _isFrozen = !(/^https?:\/\//.test(url)); }
    if (!_isFrozen) { real.open.apply(real, arguments); }
  };
  this.send = function(body) {
    if (!_isFrozen) { real.send.apply(real, arguments); return; }
    var self = this;
    self.readyState = 4;
    self.status = 200;
    self.statusText = 'OK';
    self.responseText = '{"draw":0,"recordsTotal":0,"recordsFiltered":0,"data":[]}';
    self.response = self.responseText;
    setTimeout(function() {
      if (typeof self.onload === 'function') { try { self.onload({}); } catch(e){} }
      if (typeof self.onreadystatechange === 'function') { try { self.onreadystatechange({}); } catch(e){} }
    }, 0);
  };
  this.setRequestHeader = function(k, v) { if (!_isFrozen) real.setRequestHeader(k, v); };
  this.abort = function() { if (!_isFrozen) real.abort(); };
  this.addEventListener = function(evt, fn) { if (!_isFrozen) real.addEventListener(evt, fn); };
  this.removeEventListener = function(evt, fn) { if (!_isFrozen) real.removeEventListener(evt, fn); };
  this.overrideMimeType = function(m) { try { real.overrideMimeType(m); } catch(e){} };
  ['timeout','withCredentials','responseType'].forEach(function(p) {
    Object.defineProperty(this, p, {
      get: function() { return real[p]; },
      set: function(v) { try { real[p] = v; } catch(e){} },
      configurable: true
    });
  }, this);
}
window.XMLHttpRequest = FrozenXHR;

// ── 2. fetch() stub ─────────────────────────────────────────────────────────
var _nativeFetch = window.fetch;
window.fetch = function(input, init) {
  var url = (typeof input === 'string') ? input : ((input && input.url) || '');
  var isFrozen = false;
  try {
    var abs2 = new URL(url, window.location.href);
    isFrozen = (abs2.origin === window.location.origin || abs2.protocol === 'file:');
  } catch(e) { isFrozen = !(/^https?:\/\//.test(url)); }
  if (isFrozen) {
    var emptyJson = '{"draw":0,"recordsTotal":0,"recordsFiltered":0,"data":[]}';
    return Promise.resolve(new Response(emptyJson, {
      status: 200,
      headers: {'Content-Type': 'application/json'}
    }));
  }
  return _nativeFetch.apply(this, arguments);
};

// ── 3. DataTables / jQuery patch ────────────────────────────────────────────
// Poll until jQuery and DataTables are available, then patch them.
var _dtPatched = false;
function patchDataTables() {
  if (!window.jQuery) return;
  var $ = window.jQuery;
  if ($.fn.dataTable && $.fn.dataTable.ext) {
    $.fn.dataTable.ext.errMode = 'none';
    _dtPatched = true;
  }
  function stripAjax(opts) {
    if (!opts || typeof opts !== 'object') return opts;
    var o = Object.assign({}, opts);
    delete o.ajax;
    delete o.serverSide;
    return o;
  }
  ['DataTable', 'dataTable'].forEach(function(name) {
    var orig = $.fn[name];
    if (orig && !orig.__bp_patched__) {
      $.fn[name] = function(opts) { return orig.call(this, stripAjax(opts)); };
      $.fn[name].__bp_patched__ = true;
      Object.assign($.fn[name], orig);
    }
  });
  if ($.ajax && !$.__bp_ajax_patched__) {
    var origAjax = $.ajax;
    $.ajax = function(url, opts) {
      var settings = (typeof url === 'object') ? url : Object.assign({url: url}, opts || {});
      var target = (settings && settings.url) || '';
      var isFr = false;
      try {
        var a = new URL(target, window.location.href);
        isFr = (a.origin === window.location.origin || a.protocol === 'file:');
      } catch(e) { isFr = !(/^https?:\/\//.test(target)); }
      if (isFr) {
        var emptyDT = {draw: 0, recordsTotal: 0, recordsFiltered: 0, data: []};
        var dfd = $.Deferred ? $.Deferred() : null;
        setTimeout(function() {
          if (settings && typeof settings.success === 'function') {
            try { settings.success(emptyDT, 'success', {}); } catch(e) {}
          }
          if (dfd) dfd.resolve(emptyDT, 'success', {});
        }, 0);
        if (dfd) return dfd.promise();
        return {done: function(){return this;}, fail: function(){return this;}, always: function(){return this;}};
      }
      return origAjax.apply(this, arguments);
    };
    $.__bp_ajax_patched__ = true;
  }
}
var _dtPollCount = 0;
var _dtPollTimer = setInterval(function() {
  patchDataTables();
  _dtPollCount++;
  if (_dtPatched || _dtPollCount > 200) clearInterval(_dtPollTimer);
}, 50);

console.log('[SiteBlueprint] Freeze shim active \u2014 AJAX blocked, DataTables patched for offline use.');
})();
`;
  }


  // Generates the _blueprint_nav.js content with the full sitemap embedded.
  function generateBlueprintNavScript() {
    const mapJson = JSON.stringify(siteMap);
    return `/* SiteBlueprint v1.0 — Offline Navigation Interceptor
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
      pn = /^https?:\/\//.test(h)
        ? new URL(h).pathname
        : new URL(h, window.location.href).pathname;
    } catch (e) { return null; }
    pn = decodeURIComponent(pn).replace(/\/+$/, '') || '/';
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

  // ==========================================================================
  // Crawler Finalization & ZIP Packaging
  // ==========================================================================
  function finalizeCrawl() {
    isRunning = false;
    if (stats.timerInterval) {
      clearInterval(stats.timerInterval);
    }

    // Generate & save offline navigation script
    const navScriptContent = generateBlueprintNavScript();
    zip.file('_blueprint_nav.js', navScriptContent);
    log(`Offline nav script generated (_blueprint_nav.js) — ${Object.keys(siteMap).length} pages mapped.`, 'zip');

    // Save freeze shim as a standalone file too (useful for manual debugging)
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
      
      const parsedUrl = new URL(startUrl);
      let filename = parsedUrl.hostname;
      // Clean filename
      filename = filename.replace(/[^a-zA-Z0-9]/g, '_') + '_blueprint.zip';
      
      log(`Archiving completed. Initiating browser download for: ${filename}`, 'ok');
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      log('Download successfully completed!', 'ok');
    } catch(err) {
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
