// Renders the plugin-market images with a local Chrome or Edge:
//   node assets/market/render.mjs
// market.html → market-1.png … market-6.png (1500x1000, 3:2 as the market
// shows them), icon.html → icon-180.png (the storefront tile).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find(candidate => candidate && existsSync(candidate));
if (!browser) throw new Error('Set CHROME_PATH to a Chrome or Edge executable');

// A throwaway profile keeps the user's browser profile untouched.
const profile = mkdtempSync(path.join(os.tmpdir(), 'wcu-market-'));
const common = ['--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--virtual-time-budget=4000', '--force-device-scale-factor=2'];
function shot(page, query, width, height, output, background) {
  const url = pathToFileURL(path.join(here, page)).href + query;
  const result = spawnSync(browser, [...common, ...(background ? [`--default-background-color=${background}`] : []), `--window-size=${width},${height}`, `--screenshot=${path.join(here, output)}`, url], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `${path.basename(browser)} exited with ${result.status}`);
  console.log(`${output}  ${width * 2}x${height * 2}`);
}
try {
  for (let slide = 1; slide <= 6; slide++) shot('market.html', `?slide=${slide}`, 750, 500, `market-${slide}.png`);
  shot('icon.html', '', 90, 90, 'icon-180.png', '00000000');
} finally {
  rmSync(profile, { recursive: true, force: true });
}
