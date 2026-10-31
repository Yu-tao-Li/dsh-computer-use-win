// browserAttachUser: the opt-in that lets the lane list the user's own browser
// (the one where the user turned remote debugging on themselves), reading the
// endpoint from DevToolsActivePort because the port changes with every launch.
// Offline: nothing is launched and no CDP connection is opened.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// browser.mjs reads LOCALAPPDATA when it is imported, so point it at a fixture
// before the dynamic import below.
const localAppData = await mkdtemp(path.join(os.tmpdir(), 'wcu-attach-'));
const chromeProfile = path.join(localAppData, 'Google', 'Chrome', 'User Data');
await mkdir(chromeProfile, { recursive: true });
const portFile = path.join(chromeProfile, 'DevToolsActivePort');
const writePort = (port, wsPath) => writeFile(portFile, `${port}\n${wsPath}\n`);
await writePort('9222', '/devtools/browser/00000000-1111-2222-3333-444455556666');
process.env.LOCALAPPDATA = localAppData;

const { userBrowserEndpoints, BrowserLane } = await import('../mcp/browser.mjs');
const { DEFAULT_SETTINGS, normalizeSettings, toolSelectionKey } = await import('../mcp/settings.mjs');

// 1. Defaults and settings plumbing.
assert.equal(DEFAULT_SETTINGS.browserAttachUser, false, 'the switch is off by default');
assert.equal(normalizeSettings({}).browserAttachUser, false);
assert.equal(normalizeSettings({ browserAttachUser: true }).browserAttachUser, true);
assert.throws(() => normalizeSettings({ browserAttachUser: 'yes' }), /browserAttachUser must be boolean/);
assert.notEqual(toolSelectionKey({}), toolSelectionKey({ browserAttachUser: true }), 'changing the switch reconnects');

// 2. The endpoint comes from DevToolsActivePort, as a ws:// URL.
const endpoints = userBrowserEndpoints();
assert.equal(endpoints.length, 1);
assert.equal(endpoints[0].url, 'ws://127.0.0.1:9222/devtools/browser/00000000-1111-2222-3333-444455556666');
assert.equal(endpoints[0].name, 'Chrome (user)');
assert.equal(endpoints[0].source, 'configured');

// 3. The port is read again on every listing: a restart changes it.
await writePort('41001', '/devtools/browser/next-run-0001');
assert.equal(userBrowserEndpoints()[0].url, 'ws://127.0.0.1:41001/devtools/browser/next-run-0001');

// 4. The lane only lists it when the switch is on, and an explicit
// WCU_BROWSER_CDP_URL still wins.
const lane = env => new BrowserLane({ env: { ...process.env, ...env } });
assert.deepEqual(lane({ WCU_BROWSER_ATTACH_USER: '0' }).candidates(), []);
assert.deepEqual(lane({}).candidates(), []);
assert.equal(lane({ WCU_BROWSER_ATTACH_USER: '1' }).candidates()[0].url, 'ws://127.0.0.1:41001/devtools/browser/next-run-0001');
assert.equal(lane({ WCU_BROWSER_ATTACH_USER: '1', WCU_BROWSER_CDP_URL: 'ws://127.0.0.1:9222/devtools/browser/explicit' }).candidates()[0].name, 'Configured browser');

// 5. A file that no browser wrote, or none at all, is ignored instead of failing.
await writeFile(portFile, 'not-a-port\n');
assert.deepEqual(userBrowserEndpoints(), []);
await writeFile(portFile, '9222\n/devtools/browser/../../etc/passwd\n');
assert.deepEqual(userBrowserEndpoints(), [], 'only a browser websocket path is accepted');

// 6. The bridge passes the switch as an environment variable. The adapter needs
// its peer dependencies, which a plain checkout may not have installed.
let bridgeConfig;
try { ({ bridgeConfig } = await import('../mcp/dsh-plugin.mjs')); } catch { }
if (bridgeConfig) {
  assert.equal(bridgeConfig({ browserAttachUser: false }).env.WCU_BROWSER_ATTACH_USER, '0');
  assert.equal(bridgeConfig({ browserAttachUser: true }).env.WCU_BROWSER_ATTACH_USER, '1');
} else {
  console.log('bridgeConfig check skipped: peer dependencies are not installed');
}

console.log('browser-attach-user: ok');
