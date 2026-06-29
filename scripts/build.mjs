/**
 * @file build.mjs
 * @description Dependency-free build/packaging script for SiteBlueprint.
 *
 * Stages only the runtime files Chrome needs into `dist/` and produces a
 * store-ready `dist/siteblueprint-v<version>.zip`. Development files (node
 * modules, docs, configs, git) are intentionally excluded.
 *
 * Usage: `npm run build`  (or `node scripts/build.mjs`)
 */

import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const STAGE = join(DIST, 'siteblueprint');

/** Files & folders that ship inside the packaged extension. */
const RUNTIME_ENTRIES = ['manifest.json', 'src', 'vendor', 'assets', 'README.md', 'LICENSE'];

async function readVersion() {
  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
  return manifest.version;
}

async function stage() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });

  for (const entry of RUNTIME_ENTRIES) {
    const from = join(ROOT, entry);
    if (!existsSync(from)) {
      console.warn(`  ! skipped (missing): ${entry}`);
      continue;
    }
    await cp(from, join(STAGE, entry), { recursive: true });
    console.log(`  + staged ${entry}`);
  }
}

/** Zips the staged folder using the platform's native tooling. */
function zip(version) {
  const out = join(DIST, `siteblueprint-v${version}.zip`);
  return new Promise((res, rej) => {
    const isWin = platform() === 'win32';
    const [cmd, args] = isWin
      ? ['powershell', ['-NoProfile', '-Command', `Compress-Archive -Path "${STAGE}/*" -DestinationPath "${out}" -Force`]]
      : ['zip', ['-r', '-q', out, '.']];
    const opts = isWin ? {} : { cwd: STAGE };

    execFile(cmd, args, opts, (err) => {
      if (err) {
        console.warn(`\n  ! Could not auto-zip (${err.message}).`);
        console.warn(`  → Staged extension is ready at: ${STAGE}`);
        return res(null);
      }
      res(out);
    });
  });
}

async function main() {
  console.log('Building SiteBlueprint…');
  const version = await readVersion();
  await stage();
  const out = await zip(version);
  if (out) console.log(`\nDone. Package: ${out}`);
  else console.log('\nStaging complete (manual zip required).');
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
