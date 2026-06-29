# Changelog

All notable changes to SiteBlueprint are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-06-29

### Changed
- Refactored the monolithic `dashboard.js` (~1.4k lines) into focused ES modules
  under `src/dashboard/engine/` (`utils`, `paths`, `exclusions`, `freeze-shim`,
  `offline-nav`). Pure logic is now isolated from DOM/orchestration code.
- Reorganized the project into a conventional layout: vendor libraries moved to
  `vendor/`, branding assets to `assets/icons/`.
- The crawler controller now loads as a native ES module (`type="module"`).

### Added
- `LICENSE` (MIT), `CHANGELOG.md`, `CONTRIBUTING.md`.
- `package.json` with lint/format/build scripts and project metadata.
- Dependency-free packaging script (`scripts/build.mjs`) that produces a
  store-ready ZIP in `dist/`.
- ESLint flat config, Prettier config and `.editorconfig` for consistent style.

### Fixed
- Object URLs created during ZIP download are now revoked to avoid memory leaks.

## [1.0.0] - Initial release

### Added
- Deep recursive crawler with configurable depth, throttling and exclusion rules.
- Session/cookie inheritance via credentialed fetches.
- Intelligent relative-path rewriting for HTML, CSS and assets.
- External/CDN asset bundling into an `external/` directory.
- Client-side ZIP generation with JSZip.
- Offline navigation router (`_blueprint_nav.js`) for working internal links.
- Auth redirect detection with one-time login page capture.
- Freeze Live Data mode: render pages in a real tab to capture AJAX-loaded DOM.
