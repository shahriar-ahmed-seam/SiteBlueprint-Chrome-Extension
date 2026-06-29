# Contributing to SiteBlueprint

Thanks for your interest in improving SiteBlueprint! This guide covers how to set
up the project, the architecture, and the conventions we follow.

## Getting started

1. Fork and clone the repository.
2. Install dev tooling (optional, only needed for lint/format/build):
   ```bash
   npm install
   ```
3. Load the extension in Chrome:
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the repository root (the folder with
     `manifest.json`).
4. After editing source files, click the **reload** icon on the extension card
   to pick up changes.

## Project architecture

```
src/
├── popup/                 # Toolbar action popup (launch / resume dashboard)
└── dashboard/
    ├── dashboard.html     # Compiler workspace UI
    ├── dashboard.css      # Styles
    ├── dashboard.js       # Controller: DOM wiring + crawl orchestration
    └── engine/            # Pure, testable engine modules
        ├── utils.js       # Formatting & small helpers
        ├── paths.js       # URL → local path resolution + relative rewriting
        ├── exclusions.js  # Exclusion pattern parsing & matching
        ├── freeze-shim.js # Freeze-mode AJAX/DataTables shim generator
        └── offline-nav.js # Offline navigation router generator
```

**Design rule:** keep `engine/` modules pure (no DOM, no global state). All
side effects — DOM updates, `chrome.*` calls, network I/O, ZIP writes — live in
`dashboard.js`. This keeps the core logic easy to reason about and test.

## Code style

- Modern ES modules, 2-space indentation, single quotes, semicolons.
- Run `npm run lint` and `npm run format` before opening a pull request.
- Prefer small, focused functions with JSDoc on exported APIs.

## Commits & pull requests

- Use clear, imperative commit messages (e.g. `fix: revoke object URL after download`).
- Describe what changed and how you verified it in the PR description.
- One logical change per pull request where possible.

## Building a release package

```bash
npm run build
```

This stages the runtime files into `dist/` and produces
`dist/siteblueprint-v<version>.zip`, ready for the Chrome Web Store or manual
distribution.
