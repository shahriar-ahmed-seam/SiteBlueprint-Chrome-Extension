# SiteBlueprint 🌐

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue.svg?logo=google-chrome&logoColor=white)](https://chrome.google.com/webstore)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-orange.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Vanilla JS](https://img.shields.io/badge/Language-JS--Vanilla-yellow.svg?logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

**SiteBlueprint** is a high-fidelity Chrome Extension designed to crawl, compile, and download any website (including authenticated dashboards, web apps, and single-page applications) into a fully functional, self-contained offline directory packaged as a single ZIP archive. 

Unlike typical scrapers, SiteBlueprint resolves routing paths locally and injects a smart offline-navigation engine so you can double-click and run the compiled site from your local filesystem with 100% working internal page links, styles, scripts, and media.

---

## 🚀 Key Features

*   **Deep Recursive Crawler Engine**: Discovers, queues, and visits internal URLs up to a configurable max depth. Throttled delays prevent rate-limiting or IP bans.
*   **Cookie/Session Inheritance**: Inherits your active browser session cookies automatically. You can log into any site (such as a POS system, CRM, or SaaS portal) and run the crawler; it accesses internal dashboard pages without requiring credentials.
*   **Intelligent Path Rewriting**: Sanitizes absolute and relative URLs within HTML and CSS files, translating them to relative paths (e.g., `../../css/app.css` or `../purchases/create.html`).
*   **External & CDN Asset Compilation**: Download options to fetch styles, scripts, fonts, and assets hosted on third-party CDNs (like Cloudflare, Google Fonts, and FontAwesome) and bundle them locally into an `external/` assets directory.
*   **Client-Side ZIP Generation**: Compiles the offline site on the fly in the browser memory using `JSZip` and outputs a download instantly.
*   **Dynamic Offline Navigation Router**: Injects a custom router script (`_blueprint_nav.js`) into crawled pages. The script intercepts link clicks, `history.pushState`, `history.replaceState`, and uses a `MutationObserver` to ensure dynamic links point correctly to the local `.html` files instead of live URLs.
*   **Session Resumption Action Popup**: Clicking the extension icon automatically detects if you have an active crawling dashboard open in another tab, letting you "Resume" or "Launch" a new dashboard workspace.
*   **Smart Authentication Safeguards**: Automatically detects and handles redirects to login screens, downloading the login page once as `login.html` and preventing endless loops.

---

## 🛠️ Project Structure

The project is structured following modern extension design principles:

```
SiteBlueprint-Chrome-Extension/
├── manifest.json            # Chrome extension MV3 manifest config
├── README.md                # Project documentation
├── .gitignore               # Ignored system and build files
├── icons/                   # Extension branding assets
│   ├── icon-16.png          # Address bar and tab favicon
│   ├── icon-48.png          # Extension management settings icon
│   └── icon-128.png         # Chrome Web Store & launch icon
├── libs/                    # Vendor libraries
│   └── jszip.min.js         # JSZip library (v3.10.1) for ZIP packaging
└── src/                     # Source files
    ├── popup/               # Browser action popup component
    │   ├── popup.html       # Quick launch/resume panel HTML
    │   ├── popup.css        # Action popup styling
    │   └── popup.js         # Popup logic for tab state querying
    └── dashboard/           # Advanced compiler workspace component
        ├── dashboard.html   # Main control panel UI
        ├── dashboard.css    # Premium glassmorphic workspace styles
        └── dashboard.js     # Crawler & path-rewriting core engine
```

---

## 📦 Installation Guide

To load the extension locally in your Google Chrome browser:

1.  **Download/Clone the Repository**:
    ```bash
    git clone https://github.com/shahriar-ahmed-seam/SiteBlueprint-Chrome-Extension.git
    ```
2.  **Open Chrome Extensions Page**:
    *   Navigate to `chrome://extensions` in your Google Chrome browser.
3.  **Enable Developer Mode**:
    *   Toggle the **Developer mode** switch in the top-right corner of the page.
4.  **Load Unpacked Extension**:
    *   Click the **Load unpacked** button in the top-left corner.
    *   Select the root directory of this project (`SiteBlueprint-Chrome-Extension/` containing `manifest.json`).

---

## 📖 Usage Walkthrough

1.  **Navigate to the Target Website**: Open Chrome and visit the website you want to compile.
2.  **Open the Extension Popup**: Click the SiteBlueprint extension icon from your Chrome toolbar.
3.  **Launch the Dashboard**: Click **Launch Dashboard**. The extension will open the full-tab control panel, pre-populating the target URL.
4.  **Configure Settings**:
    *   **Max Depth**: Set how many levels of links the crawler should follow (1 = target page only, 3 = standard web navigation depth).
    *   **Crawl Delay**: Set a throttle (in ms) to execute requests sequentially and avoid server locks.
    *   **Exclude Paths**: Add comma-separated keywords (e.g., `logout`, `delete`, `/api/`) to prevent the crawler from triggering destructive actions or API endpoints.
    *   **Save CDN & External Assets**: Check to bundle external scripts and styles locally for a 100% offline experience.
5.  **Run the Compiler**: Click **Start Crawling**.
    *   Watch the crawler log out real-time fetches in the **Crawler Engine Console Log**.
    *   Inspect metrics such as crawled page counts, asset sizes, queue status, speed, and time.
    *   Filter or search the discovered local files map under **Discovered Site Blueprint Mapping**.
6.  **Download Workspace**: Once the crawl finishes (or if you click **Stop**), click the glowing **Download Offline ZIP** button.
7.  **Run Offline**: Extract the downloaded ZIP. Double-click `index.html` to browse the compiled website locally with working, relative navigation.

---

## 🗂️ Opening Your Offline Blueprint

After extracting the downloaded ZIP, you get a fully self-contained folder (e.g. `example_com_blueprint/`). Here's how to browse it:

### Option 1 — Open Directly in Browser (Easiest)
Double-click the main entry file (usually `index.html` or `home.html`) in the extracted folder. Chrome's built-in `file://` protocol will load it and the injected `_blueprint_nav.js` router handles internal page navigation automatically.

> **Note:** Some dynamic features (web workers, certain fonts) may be restricted by the browser's `file://` security policy.

### Option 2 — Serve via Local HTTP Server (Recommended)
For the most accurate offline experience, serve the folder through a local web server:

**Using Node.js (npx):**
```bash
npx http-server /path/to/extracted-blueprint -p 8000
# Then open: http://localhost:8000/home.html
```

**Using Python:**
```bash
cd /path/to/extracted-blueprint
python -m http.server 8000
# Then open: http://localhost:8000/home.html
```

**On Windows:**
```powershell
cd "C:\Users\YourName\Downloads\example_com_blueprint"
python -m http.server 8000
# Then open: http://localhost:8000/home.html
```

The injected router (`_blueprint_nav.js`) intercepts all link clicks and redirects you to the correct local `.html` file — meaning navigation works exactly like the live site, just offline.

---

## ❄️ Freeze Live Data Mode

By default, SiteBlueprint uses `fetch()` to download each page. This is fast and works well for **server-rendered websites** (e.g. PHP, Laravel Blade, Django, Rails). However, many modern apps load their actual data **after** the page loads via JavaScript AJAX calls — meaning you'd see empty tables and blank charts offline.

**Freeze Live Data** solves this. When enabled, instead of `fetch()`, the crawler:
1. Opens each URL in a **real background Chrome tab**
2. Waits for the page and all AJAX calls to complete
3. Captures `document.documentElement.outerHTML` — the **fully rendered DOM with data baked in**
4. Closes the tab and saves the frozen HTML

The result is a true **data snapshot** — every table, chart, and list reflects exactly what was on screen at crawl time.

### When to use Freeze Mode
| Scenario | Recommended Mode |
|---|---|
| Static site, blog, marketing page | Normal (fast) |
| Server-rendered app (Laravel, Django, Rails) | Normal (fast) |
| React / Vue / Angular SPA | **Freeze Mode** |
| Dashboard with DataTables or Chart.js | **Freeze Mode** |
| Any app where tables show "No data" offline | **Freeze Mode** |

### Freeze Mode Settings
- **Data Render Wait (ms)**: How long to wait after the page loads before capturing. Default is `2500ms`. Increase to `4000–6000ms` for slow APIs or dashboards with many widgets.
- Freeze mode is **slower** — each page takes at least `render wait + page load time`. Set a longer Crawl Delay (500–1000ms) to be gentle on the server.

---

---

## ⚙️ Technical Deep Dive

### 1. Relative Path Rewriting
SiteBlueprint maps URL paths to local file structures:
- `https://example.com/` -> `index.html`
- `https://example.com/purchases` -> `purchases.html`
- `https://example.com/purchases/create` -> `purchases/create.html`
- `https://example.com/css/app.css` -> `css/app.css`

When writing files, it calculates the depth of the current document (e.g. `purchases/create.html` is depth 1 relative to root) and prepends the correct relative path offset (e.g. `../`) to all linked references.

### 2. The Offline Navigation Router (`_blueprint_nav.js`)
To prevent local browsers from sending relative links like `purchases.html` out to web addresses or hitting empty file pages, the generated package injects a router. This script:
*   Builds a local routing map during compiler serialization.
*   Intercepts navigation clicks on `<a>` tags.
*   Overrides `history.pushState` and `history.replaceState` to change paths smoothly.
*   Uses a `MutationObserver` to watch dynamic DOM changes and inject routers into newly generated links on the fly.

### 3. Session & Credential Forwarding
Because the extension uses native `fetch()` calls in the context of the browser dashboard, it invokes:
```javascript
fetch(url, { credentials: 'include' })
```
This forces Chrome to attach all stored cookies, tokens, and authorization headers to the requests. The server responds exactly as if you were accessing the pages yourself.

---

## 🛡️ License

Distributed under the MIT License. See `LICENSE` or the badge above for more information.
