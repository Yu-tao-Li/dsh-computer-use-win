// Renders the README diagrams to PNG with a local Chrome or Edge:
//   node assets/diagrams/render.mjs [how-it-works|architecture ...]
// Each page is rendered in light and dark for zh and en at 2x scale with a
// transparent background. A page that reports a layout problem is not written.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const figures = process.argv.length > 2 ? process.argv.slice(2) : ['how-it-works', 'architecture'];
const WIDTH = 860;
const browser = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find(candidate => candidate && existsSync(candidate));
if (!browser) throw new Error('Set CHROME_PATH to a Chrome or Edge executable');

// A throwaway profile keeps the user's browser profile untouched.
const profile = mkdtempSync(path.join(os.tmpdir(), 'wcu-diagrams-'));
const common = ['--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--virtual-time-budget=4000'];
function run(args) {
  const result = spawnSync(browser, [...common, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (result.status !== 0) throw new Error(result.stderr || `${path.basename(browser)} exited with ${result.status}`);
  return result.stdout;
}

let failed = false;
try {
  for (const figure of figures) for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) {
    const name = `${figure}-${lang}-${theme}`;
    const url = `${pathToFileURL(path.join(here, `${figure}.html`)).href}?lang=${lang}&theme=${theme}`;
    // First pass: lay the page out and read its height and self-check.
    const dom = run([`--window-size=${WIDTH},3000`, '--dump-dom', url]);
    const error = /data-error="([^"]*)"/.exec(dom)?.[1];
    const height = Number(/data-height="(\d+)"/.exec(dom)?.[1]);
    if (error || !height) { failed = true; console.error(`${name}: ${error || 'the page did not finish drawing'}`); continue; }
    const output = path.join(here, `${name}.png`);
    run(['--force-device-scale-factor=2', '--default-background-color=00000000', `--window-size=${WIDTH},${height}`, `--screenshot=${output}`, url]);
    console.log(`${name}.png  ${WIDTH * 2}x${height * 2}`);
  }
} finally {
  rmSync(profile, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
