// Kept sign-ins through the real MCP server, headless. With browserSignIn on,
// the DSH browser keeps one profile per browser: a site's cookies, its session
// cookie too, are still there when a later server starts the browser again,
// also after a server that was killed left a stale port file behind. A second
// server shares the running browser and leaves it open. With the switch off
// every launch starts empty, and the user's own browser (a DevToolsActivePort
// where Edge keeps its user data) is never listed or used. No desktop input.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { appForProgId, defaultProgId } from '../mcp/browser.mjs';
import { McpTestClient } from './mcp-test-client.mjs';

for (const [progId, app] of [['MSEdgeHTM', 'edge'], ['ChromeHTML', 'chrome'], ['FirefoxURL-308046B0AF4A39CB', null], ['', null], [null, null]]) assert.equal(appForProgId(progId), app, String(progId));
const progId = await defaultProgId();
assert.ok(progId === null || /^\S+$/.test(progId), `the default browser ProgId reads as one word: ${progId}`);

// /set signs in with a lasting cookie and a session cookie, as a site without
// "remember me" does; other pages show what the browser sends back.
const site = http.createServer((request, response) => {
  if (request.url === '/set') {
    response.setHeader('set-cookie', ['who=signed-in; Path=/; Max-Age=3600', 'visit=session; Path=/']);
    response.end('<!doctype html><title>set</title><p>set</p>');
    return;
  }
  const cookie = request.headers.cookie ?? '';
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>谁</title><h1>${/who=([\w-]+)/.exec(cookie)?.[1] ?? '未登录'}</h1><h2>${/visit=(\w+)/.exec(cookie)?.[1] ?? '无会话'}</h2>`);
});
// The user's own browser, waiting for them to allow a connection: it never answers.
const held = net.createServer(() => { });
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => held.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${site.address().port}`;

const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-kept-'));
const agentDir = path.join(root, 'agent'), local = path.join(root, 'local');
await mkdir(path.join(local, 'Microsoft', 'Edge', 'User Data'), { recursive: true });
await writeFile(path.join(local, 'Microsoft', 'Edge', 'User Data', 'DevToolsActivePort'), `${held.address().port}\n/devtools/browser/held`);
const clients = [];
// Browser processes (not their helpers) started on a profile under the test root.
const browsersOn = dir => Number(execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${dir}') -and -not $_.CommandLine.Contains('--type=') }).Count`], { encoding: 'utf8' }).trim());
try {
  async function server(env = {}) {
    const client = new McpTestClient(process.execPath, [path.join(import.meta.dirname, '../mcp/server.mjs')], {
      env: { ...process.env, LOCALAPPDATA: local, WCU_BROWSER_HEADLESS: '1', WCU_BROWSER_PROFILE: agentDir, WCU_BROWSER_APP: 'edge', ...env }
    });
    clients.push(client);
    await client.init();
    return client;
  }
  async function call(client, tool, args) {
    const response = await client.call('windows_computer_use_' + tool, args);
    assert.ok(!response.isError, JSON.stringify(response));
    return { meta: JSON.parse(response.content[0].text), page: response.content[1]?.text ?? '' };
  }
  // A server ends as DSH ends it: its input closes.
  async function end(client) {
    client.child.stdin.end();
    for (let i = 0; i < 150 && client.child.exitCode === null && client.child.signalCode === null; i++) await delay(100);
    assert.ok(client.child.exitCode !== null || client.child.signalCode !== null, 'the server ends once its input closes');
  }
  const keptDir = () => readdirSync(agentDir).filter(entry => entry.startsWith('kept-')).map(entry => path.join(agentDir, entry));
  const signedIn = page => /heading "signed-in"/.test(page) && /heading "session"/.test(page);

  // On: the first server signs in; its own new tab sees both cookies.
  const first = await server({ WCU_BROWSER_SIGNIN: '1' });
  const listing = (await call(first, 'list_windows', {})).meta.browserLane;
  assert.match(listing.use, /whose profile is kept/);
  assert.ok(!listing.browsers.length && !listing.waitingForPermission, `the user's own browser is not listed or asked: ${JSON.stringify(listing)}`);
  await call(first, 'set_value', { elementId: 'new-tab', value: origin + '/set' });
  assert.ok(signedIn((await call(first, 'set_value', { elementId: 'new-tab', value: origin + '/who' })).page));
  const [kept] = keptDir();
  assert.ok(kept && /kept-(edge|chrome)$/.test(kept), `one kept profile: ${readdirSync(agentDir)}`);
  assert.equal(await readFile(path.join(kept, 'dsh-server-pid'), 'utf8'), String(first.child.pid));
  await end(first);
  assert.equal(browsersOn(kept), 0, 'the browser closes with its server');
  assert.ok(!existsSync(path.join(kept, 'DevToolsActivePort')), 'the closed browser leaves no port file');

  // A later server starts the browser again on the kept profile: still signed
  // in, session cookie included, and none of the last tabs come back.
  const second = await server({ WCU_BROWSER_SIGNIN: '1' });
  const again = await call(second, 'set_value', { elementId: 'new-tab', value: origin + '/who' });
  assert.ok(signedIn(again.page), again.page);
  const tabs = (await call(second, 'list_windows', {})).meta.browserLane.browsers.flatMap(browser => browser.tabs);
  assert.ok(!tabs.some(tab => tab.url === origin + '/set'), `no restored tabs: ${JSON.stringify(tabs)}`);

  // A killed server leaves its port file; the next launch is not misled by it.
  second.child.kill();
  for (let i = 0; i < 100 && browsersOn(kept); i++) await delay(100);
  assert.ok(existsSync(path.join(kept, 'DevToolsActivePort')), 'a killed server leaves a stale port file');
  const third = await server({ WCU_BROWSER_SIGNIN: '1' });
  let started = Date.now();
  assert.ok(signedIn((await call(third, 'set_value', { elementId: 'new-tab', value: origin + '/who' })).page));
  assert.ok(Date.now() - started < 15000, `relaunch after a stale port file took ${Date.now() - started} ms`);

  // A second server on the same kept profile shares the running browser, and
  // ending it leaves that browser to its own server.
  const sharer = await server({ WCU_BROWSER_SIGNIN: '1' });
  assert.ok(signedIn((await call(sharer, 'set_value', { elementId: 'new-tab', value: origin + '/who' })).page));
  assert.equal(browsersOn(kept), 1, 'one browser for both servers');
  await end(sharer);
  assert.equal(browsersOn(kept), 1, 'the sharing server leaves the browser open');
  const own = (await call(third, 'list_windows', {})).meta.browserLane.browsers.find(browser => browser.source === 'agent');
  const whoTab = own.tabs.find(tab => tab.url === origin + '/who');
  assert.ok(whoTab, JSON.stringify(own));
  assert.ok(signedIn((await call(third, 'accessibility_tree', { browserTab: whoTab.id })).page));
  await end(third);
  assert.equal(browsersOn(kept), 0);

  // Off: a throwaway profile, no sign-ins; the kept profile stays as it was.
  const off = await server();
  started = Date.now();
  const plain = await call(off, 'set_value', { elementId: 'new-tab', value: origin + '/who' });
  assert.match(plain.page, /heading "未登录"/);
  assert.match(plain.page, /heading "无会话"/);
  assert.ok(!(await call(off, 'list_windows', {})).meta.browserLane.browsers.some(browser => browser.source !== 'agent'));
  assert.ok(existsSync(path.join(kept, 'Default')), 'the kept profile is untouched');
  await end(off);
  console.log(JSON.stringify({ passed: true, defaultProgId: progId, kept: path.basename(kept) }));
} finally {
  for (const client of clients) client.close();
  site.close(); held.close();
  await delay(1000);
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => { });
}
