// Live smoke for issue #56: a page in a Firefox-family window is read at the
// default depths. Uses the installed Firefox with a throwaway profile and a
// local page; skips when no Firefox is installed. Touches only its own window.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { McpTestClient } from './mcp-test-client.mjs';

const artifacts = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'wcu-gecko-smoke'));
function firefoxPath() {
  if (process.env.WCU_TEST_FIREFOX) return process.env.WCU_TEST_FIREFOX;
  for (const hive of ['HKCU', 'HKLM']) {
    const query = spawnSync('reg', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe`, '/ve'], { encoding: 'utf8', windowsHide: true });
    const match = /REG_SZ\s+(.+)/.exec(query.stdout || '');
    if (match && existsSync(match[1].trim())) return match[1].trim();
  }
  return [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(dir => path.join(dir, 'Mozilla Firefox', 'firefox.exe')).find(existsSync) || null;
}
const firefox = firefoxPath();
if (!firefox) { console.log('SKIP no Firefox installed (set WCU_TEST_FIREFOX to a Firefox-family firefox.exe)'); process.exit(0); }

const issue = 'Feature: add launch/start-app tool that survives DSH kill-on-close Job';
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>WCU Gecko Fixture</title></head><body>
<div id="app"><div><div><header role="banner"><div><nav aria-label="Global"><ul><li><a href="#">Home</a></li><li><a href="#">Issues</a></li></ul></nav></div></header>
<main><div><div><div><div><section aria-label="Issue list"><div><div><div><input type="search" aria-label="Filter issues" value="is:open"></div>
<ul aria-label="Issues">${['Support Firefox-family browsers', issue, 'Backend exits immediately on Windows 11 26H2'].map((title, i) => `<li><div><div><span><svg width="10" height="10" aria-label="Open issue"><circle cx="5" cy="5" r="4"/></svg></span><div><h3><a href="#i${i}">${title}</a></h3><div><span>opened by a fixture</span></div></div></div></div></li>`).join('')}</ul>
<div><div><button type="button" onclick="document.getElementById('out').textContent='clicked'">Fixture action</button> <p id="out">not clicked</p></div></div></div></div></div></section></div></div></div></div></main></div></div></div></body></html>`;
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/issues`;

const profile = path.join(artifacts, 'firefox-profile');
await mkdir(profile, { recursive: true });
// A fresh profile otherwise opens onboarding and a terms-of-use dialog, which
// makes the rest of the window inert, so its accessibility tree stays empty.
await writeFile(path.join(profile, 'user.js'), [
  ['browser.aboutwelcome.enabled', false], ['browser.preonboarding.enabled', false], ['termsofuse.bypassNotification', true],
  ['termsofuse.acceptedVersion', 999], ['termsofuse.acceptedDate', '1735689600000'], ['browser.shell.checkDefaultBrowser', false],
  ['browser.startup.homepage_override.mstone', 'ignore'], ['startup.homepage_welcome_url', ''], ['datareporting.policy.dataSubmissionEnabled', false],
  ['datareporting.policy.dataSubmissionPolicyBypassNotification', true], ['toolkit.telemetry.reportingpolicy.firstRun', false],
  ['app.update.disabledForTesting', true], ['browser.tabs.warnOnClose', false], ['browser.sessionstore.resume_from_crash', false]
].map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`).join('\n') + '\n');
if (process.env.WCU_TEST_WINDOW_X) await writeFile(path.join(profile, 'xulstore.json'), JSON.stringify({ 'chrome://browser/content/browser.xhtml': { 'main-window': { screenX: String(process.env.WCU_TEST_WINDOW_X), screenY: '60', width: '1200', height: '820', sizemode: 'normal' } } }));
const env = { ...process.env, WCU_INDICATOR: '0' };
const browser = spawn(firefox, ['-no-remote', '-new-instance', '-profile', profile, url], { windowsHide: false, stdio: 'ignore' });
const client = new McpTestClient(process.execPath, [path.join(import.meta.dirname, '../mcp/server.mjs')], { env });
const results = [];
async function call(action, args) {
  const response = await client.call('windows_computer_use_' + action, args);
  assert.ok(!response.isError, JSON.stringify(response));
  const result = JSON.parse(response.content.find(part => part.type === 'text').text);
  results.push({ action, args, result }); return result;
}
const names = node => node ? [node.name, ...(node.children || []).flatMap(names)] : [];
let hwnd = 0;
try {
  await client.init();
  for (let i = 0; i < 300 && !hwnd; i++) {
    const listed = await call('list_windows', { maxWindows: 200 });
    hwnd = listed.windows.find(w => w.className === 'MozillaWindowClass' && /^WCU Gecko Fixture/.test(w.name || w.title || ''))?.nativeWindowHandle || 0;
    if (!hwnd) await delay(100);
  }
  assert.ok(hwnd, 'The Firefox fixture window did not appear');
  const target = { nativeWindowHandle: hwnd };
  // Gecko's UIA provider can take most of the default 5 s budget on a CI
  // runner (4.9 s for one tree read), so tree reads get room to finish; the
  // depth under test stays the default.
  const budget = { treeTimeoutMs: 20000 };
  let tree;
  // The document title arrives with the page; wait for it once, then use defaults.
  for (let i = 0; i < 50; i++) { tree = await call('accessibility_tree', { ...target, ...budget }); if (names(tree.tree).includes(issue)) break; await delay(200); }
  assert.ok(names(tree.tree).includes(issue), 'Default-depth tree misses the page: ' + names(tree.tree).filter(Boolean).join('|').slice(0, 2000));
  assert.ok(names(tree.tree).includes('Fixture action'));
  const snap = await call('snapshot', { ...target, ...budget, includeScreenshot: false });
  assert.ok(names(snap.tree).includes('Fixture action'), 'Default snapshot depth misses the page');
  const found = await call('find', { ...target, ...budget, query: issue, controlType: 'Hyperlink', ocrFallback: false });
  assert.equal(found.source, 'uia'); assert.ok(found.results.length > 0, 'find fell short of the page'); assert.match(found.results[0].id, /^uia:rt:/);
  assert.equal((await call('element_info', { ...target, elementId: found.results[0].id })).element.name, issue);
  assert.equal((await call('wait_for', { ...target, condition: 'element', query: 'Fixture action' })).verification, 'observed');
  const desktop = await call('accessibility_tree', { scope: 'desktop' });
  assert.ok(!names(desktop.tree).includes(issue), 'Desktop overview must not descend into pages');
  const button = (await call('find', { ...target, ...budget, query: 'Fixture action', controlType: 'Button', ocrFallback: false })).results[0];
  await call('invoke', { ...target, elementId: button.id });
  assert.equal((await call('wait_for', { ...target, condition: 'element', query: 'clicked', timeoutMs: 5000 })).verification, 'observed', 'The page did not receive the invoke');
  console.log(`PASS Firefox ${path.basename(path.dirname(firefox))}: default tree ${tree.nodeCount} nodes reaches the issue link, snapshot/find/element_info/wait_for reach the page, invoke clicks it, desktop overview unchanged`);
} finally {
  await writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ firefox, results, backendStderr: client.stderr }, null, 2) + '\n').catch(() => {});
  if (hwnd) await client.call('windows_computer_use_close_window', { nativeWindowHandle: hwnd }).catch(() => {});
  client.child.stdin.end();
  // Firefox's launcher may hand over to another process; stop every process using this profile.
  const count = `@(Get-CimInstance Win32_Process -Filter "Name='firefox.exe'" | Where-Object { $_.CommandLine -like '*${profile.replaceAll("'", "''")}*' })`;
  for (let i = 0; hwnd && i < 20 && spawnSync('powershell.exe', ['-NoProfile', '-Command', count + '.Count'], { encoding: 'utf8', windowsHide: true }).stdout.trim() !== '0'; i++) await delay(250);
  spawnSync('powershell.exe', ['-NoProfile', '-Command', count + ' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'], { windowsHide: true });
  if (browser.exitCode === null) browser.kill();
  server.close();
  for (let i = 0; i < 50 && client.child.exitCode === null; i++) await delay(100);
  if (client.child.exitCode === null) client.child.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
