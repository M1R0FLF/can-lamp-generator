#!/usr/bin/env node
// Node driver for the measurement harness.
//
//   node tools/measure/run.mjs <script.mjs> [args...]
//
// Bundles `browser-entry.ts` with esbuild, opens Chromium, injects the bundle,
// then imports <script.mjs> and calls its default export with a `run(fn, arg)`
// helper that evaluates `fn` inside the page with `window.LAMP` in scope.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);

const bundle = await build({
  entryPoints: [path.join(here, 'browser-entry.ts')],
  bundle: true,
  format: 'iife',
  write: false,
  target: 'chrome110',
  logLevel: 'warning',
});
const code = bundle.outputFiles[0].text;

// The preinstalled Chromium (build 1194) predates whatever build this
// playwright package wants, so point at it explicitly rather than letting
// playwright look for a version-matched download that isn't there.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.error(`[page ${m.type()}]`, m.text());
});
await page.goto('about:blank');
await page.addScriptTag({ content: code });

/** Evaluate `fn` in the page. `fn` receives ({ LAMP, arg }). */
const run = (fn, arg) => page.evaluate(fn, { arg });

const scriptPath = process.argv[2];
if (!scriptPath) {
  console.error('usage: node tools/measure/run.mjs <script.mjs> [args...]');
  process.exit(2);
}
const mod = await import(pathToFileURL(path.resolve(scriptPath)).href);
try {
  await mod.default({ run, page, argv: process.argv.slice(3) });
} finally {
  await browser.close();
}
