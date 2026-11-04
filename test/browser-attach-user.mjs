import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BrowserLane } from '../mcp/browser.mjs';
import { bridgeConfig } from '../mcp/dsh-plugin.mjs';
import { normalizeSettings, toolSelectionKey, browserRoutingInstructions } from '../mcp/settings.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-attach-'));
const profile = app => path.join(root, app === 'chrome' ? 'Google/Chrome/User Data' : 'Microsoft/Edge/User Data');
for (const app of ['chrome','edge']) await mkdir(profile(app), { recursive: true });
const portFile = (app, port, route = 'fixture') => writeFile(path.join(profile(app), 'DevToolsActivePort'), `${port}\n/devtools/browser/${route}`);
let handshakes = 0;
const sockets = new Set();
const held = net.createServer(socket => { handshakes++; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(resolve => held.listen(0, '127.0.0.1', resolve));
await portFile('chrome', held.address().port); await portFile('edge', held.address().port, 'edge');
const env = { ...process.env, LOCALAPPDATA: root, WCU_BROWSER_APP: 'chrome', WCU_BROWSER_ATTACH_USER: '1', WCU_BROWSER_ATTACH_TIMEOUT_MS: '200' };
delete env.WCU_BROWSER_CDP_URL;
const lane = new BrowserLane({ env });
try {
  assert.equal(bridgeConfig({ browserAttachUser: true }).env.WCU_BROWSER_ATTACH_USER, '1');
  assert.equal(normalizeSettings({ browserAttachUser: true, browserApp: 'firefox' }).browserAttachUser, false);
  assert.notEqual(toolSelectionKey({}), toolSelectionKey({ browserAttachUser: true }));
  assert.match(browserRoutingInstructions({ browserAttachUser: true }), /Only operate tabs the user mentioned/);
  const listed = (await lane.annotateWindows({ windows: [] })).browserLane;
  assert.equal(handshakes, 0); assert.equal(listed.browsers.length, 1);
  assert.match(listed.browsers[0].name, /chrome/); assert.equal(listed.browsers[0].status, 'available');
  const key = listed.browsers[0].id, args = { elementId: key + ':connect', value: 'connect' };
  const pending = lane.run('set_value', args, {});
  await new Promise(r => setTimeout(r, 70));
  assert.equal(handshakes, 1);
  await assert.rejects(lane.run('set_value',args,{}),/BROWSER_ATTACH_IN_PROGRESS/);
  assert.equal(handshakes,1,'Concurrent explicit requests cannot stack consent prompts');
  assert.equal((await lane.annotateWindows({ windows: [] })).browserLane.browsers[0].status, 'waitingForPermission');
  await assert.rejects(pending, /No automatic retry/);
  for (let i = 0; i < 3; i++) await lane.annotateWindows({ windows: [] });
  assert.equal(handshakes, 1, 'Listing after timeout must not repeat the handshake');
  assert.equal((await lane.annotateWindows({ windows: [] })).browserLane.browsers[0].status, 'timedOut');
  await assert.rejects(lane.run('set_value', args, {})); assert.equal(handshakes, 2, 'An explicit retry makes one new handshake');
  const request = {};
  const cancelled = lane.run('set_value', args, request);
  await new Promise(r => setTimeout(r, 60)); request.cancelled = true;
  await assert.rejects(cancelled, /COMPUTER_USE_CANCELLED/);
  const count = handshakes; await lane.annotateWindows({ windows: [] }); assert.equal(handshakes, count);
  await portFile('chrome', held.address().port, 'changed-after-restart');
  assert.equal((await lane.userCandidate()).key, key);
  assert.match((await lane.userCandidate()).url, /changed-after-restart$/);
  await portFile('chrome', 70000); assert.equal(await lane.userCandidate(), null);
  const off = new BrowserLane({ env: { ...env, WCU_BROWSER_ATTACH_USER: '0' } });
  try { assert.equal(await off.userCandidate(), null); } finally { off.close(); }
  const edge = new BrowserLane({ env: { ...env, WCU_BROWSER_APP: 'edge' } });
  try { assert.match((await edge.userCandidate()).name, /edge/); } finally { edge.close(); }
  const defaults = new BrowserLane({ env: { ...env, WCU_BROWSER_APP: 'default' } });
  defaults.resolveApp = async () => (defaults.resolvedApp = 'edge');
  try { assert.match((await defaults.userCandidate()).name, /edge/); } finally { defaults.close(); }
} finally { lane.close(); for (const socket of sockets) socket.destroy(); await new Promise(r => held.close(r)); }

// A real, task-owned headless browser behind a counted TCP proxy. It models
// the consent-success case without touching the user's actual profile.
const owner = new BrowserLane({ env: { ...process.env, WCU_BROWSER_HEADLESS: '1', WCU_BROWSER_PROFILE: path.join(root, 'agent'), WCU_BROWSER_APP: 'chrome', WCU_BROWSER_ATTACH_USER: '0' } });
let proxy, user, site;
const proxySockets = new Set(); let connections = 0;
try {
  const browser = await owner.ensureAgent({}); const endpoint = new URL(browser.url);
  proxy = net.createServer(socket => { connections++; proxySockets.add(socket); const upstream = net.connect(Number(endpoint.port), '127.0.0.1'); proxySockets.add(upstream); socket.pipe(upstream).pipe(socket); socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy()); });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  await writeFile(path.join(profile('chrome'), 'DevToolsActivePort'), `${proxy.address().port}\n${endpoint.pathname}`);
  site = http.createServer((request, response) => response.end('<!doctype html><title>User attach fixture</title><h1>Fixture</h1>'));
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${site.address().port}/?token=fixture#fragment`;
  await owner.openTab(browser.key, url, {});
  user = new BrowserLane({ env: { ...env, WCU_BROWSER_ATTACH_TIMEOUT_MS: '3000' } });
  const first = (await user.annotateWindows({ windows: [] })).browserLane.browsers[0];
  assert.equal(connections, 0);
  await user.run('set_value', { elementId: first.connect, value: 'connect' }, {});
  assert.equal(connections, 1);
  await user.run('set_value', { elementId: first.connect, value: 'connect' }, {});
  assert.equal(connections,1,'An established connection is reused without a handshake');
  await assert.rejects(user.run('set_value',{elementId:first.connect,value:'connect'},{cancelled:true}),/COMPUTER_USE_CANCELLED/);
  assert.ok((await browser.cdp.send('Browser.getVersion')).product);
  let listed = (await user.annotateWindows({ windows: [] })).browserLane.browsers[0];
  assert.ok(listed.tabs.every(tab => !tab.url.includes('token=') && !tab.url.includes('#')));
  await user.run('set_value', { elementId: first.id + ':new-tab', value: url }, {});
  listed = (await user.annotateWindows({ windows: [] })).browserLane.browsers[0];
  assert.ok(listed.tabs.some(tab => tab.url.includes('token=')), 'Tabs DSH opened can retain their full URL');
  await user.shutdown();
  assert.ok((await browser.cdp.send('Browser.getVersion')).product, 'Disconnecting must leave the user browser running');
  console.log(JSON.stringify({ passed: true, listMakesNoHandshake: true, explicitSingleHandshake: true, timeoutNoRetry: true, cancellation: true, selectedBrowserOnly: true, endpointReload: true, realBrowserSuccess: true, userBrowserSurvives: true, queryRedaction: true, root }));
} finally {
  user?.close(); await owner.shutdown(); for (const socket of proxySockets) socket.destroy();
  if (proxy) await new Promise(resolve => proxy.close(resolve)); if (site) await new Promise(resolve => site.close(resolve));
}
