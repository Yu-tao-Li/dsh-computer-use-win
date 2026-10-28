// No packages required. Default: offline unit tests. --live additionally starts
// one owned headless Gecko instance; no registered Gecko => explicit skip.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { McpTestClient } from './mcp-test-client.mjs';
import { BidiConnection, BidiBrowserLane, GECKO_APP_ID, geckoApplication, geckoProfileName, discoverGecko, oemText, remoteValue, localValue, keyActions, bidiUrl, launchGecko } from '../mcp/browser-bidi.mjs';
import { domElement, domOutline } from '../mcp/browser-bidi-dom.mjs';
import { BrowserLane, appForProgId, isBrowserCall, isQuietCall } from '../mcp/browser.mjs';
import { normalizeSettings } from '../mcp/settings.mjs';
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
const remote = value => value?.sharedId ? { type: 'node', ...value } : Array.isArray(value) ? { type: 'array', value: value.map(remote) } :
  value === null ? { type: 'null' } : typeof value === 'object' ? { type: 'object', value: Object.entries(value).map(([key, v]) => [key, remote(v)]) } : localValue(value);

class FakeSocket extends EventTarget {
  sent = []; closed = false;
  send(message) { this.sent.push(JSON.parse(message)); }
  close() { this.closed = true; this.dispatchEvent(new Event('close')); }
  receive(data) { this.dispatchEvent(new MessageEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data) })); }
}
await test('BiDi out-of-order correlation, events and protocol errors', async () => {
  const socket = new FakeSocket(), c = new BidiConnection(socket); let event;
  c.listeners.add(e => { event = e; });
  const a = c.send('a'), b = c.send('b');
  socket.receive({ type: 'event', method: 'browsingContext.load', params: { context: 'c' } });
  socket.receive({ type: 'success', id: 2, result: { second: true } });
  socket.receive({ type: 'success', id: 1, result: { first: true } });
  assert.deepEqual(await b, { second: true }); assert.deepEqual(await a, { first: true }); assert.equal(event.method, 'browsingContext.load');
  const rejected = assert.rejects(c.send('session.new'), /session not created/);
  socket.receive({ type: 'error', id: 3, error: 'session not created', message: 'Maximum number of active sessions' });
  await rejected; assert.equal(c.pending.size, 0); c.close();
});
await test('timeout rejects once, never retries mutation, late reply ignored', async () => {
  const s = new FakeSocket(), c = new BidiConnection(s);
  await assert.rejects(c.send('input.performActions', {}, 10), /outcome unknown/);
  s.receive({ type: 'success', id: 1, result: {} }); assert.equal(s.sent.length, 1); assert.equal(c.pending.size, 0); c.close();
});
await test('close, malformed JSON and send failure reject pending work', async () => {
  for (const kind of ['close', 'malformed', 'send']) {
    const s = new FakeSocket(), c = new BidiConnection(s);
    if (kind === 'send') s.send = () => { throw new Error('write failed'); };
    const rejected = assert.rejects(c.send('pending'), /DISCONNECTED|PROTOCOL|write failed/);
    if (kind === 'close') s.close(); if (kind === 'malformed') s.receive('{');
    await rejected; assert.equal(c.pending.size, 0); c.close();
  }
});
await test('loopback restriction and endpoint /session normalization', async () => {
  await assert.rejects(BidiConnection.open('ws://example.com/session'), /BROWSER_ENDPOINT/);
  await assert.rejects(BidiConnection.open('ws://user:secret@127.0.0.1/session'), /BROWSER_ENDPOINT/);
  await assert.rejects(BidiConnection.open('ws://127.0.0.1/session#fragment'), /BROWSER_ENDPOINT/);
  class OpeningSocket extends FakeSocket { constructor(url) { super(); assert.equal(url, 'ws://127.0.0.1:1234/session'); queueMicrotask(() => this.dispatchEvent(new Event('open'))); } }
  const c = await BidiConnection.open('ws://127.0.0.1:1234', { WebSocketImpl: OpeningSocket }); c.close();
});
await test('remote/local value conversion preserves node references and Unicode', () => {
  const value = { entries: [{ node: { sharedId: 'document-node' }, name: '中文' }], nil: null, values: [true, 2] };
  assert.equal(remoteValue(remote(value)).entries[0].node.sharedId, 'document-node');
  assert.deepEqual(remoteValue(localValue({ value: '中文', array: [false, null, 3] })), { value: '中文', array: [false, null, 3] });
});
const fixtureDir = mkdtempSync(path.join(process.env.WCU_TEST_OUTPUT || os.tmpdir(), 'wcu-bidi-unit-'));
try {
  await test('engine detection accepts renamed branch exe and rejects wrong App.ID', async () => {
    const exe = path.join(fixtureDir, 'vantage-custom.exe'); writeFileSync(exe, 'fixture');
    writeFileSync(path.join(fixtureDir, 'application.ini'), `[App]\nName=Vantage\nVersion=153.5.1\nID=${GECKO_APP_ID}\n[Gecko]\nID=other\n`);
    assert.equal(geckoApplication(exe).name, 'Vantage'); assert.equal((await discoverGecko({ WCU_BROWSER_EXE: exe })).version, '153.5.1');
    assert.equal(appForProgId('FirefoxURL-variant123'), 'firefox'); assert.equal(appForProgId('VantageURL-unknown'), null);
    const lane = new BrowserLane({ env: { WCU_BROWSER_APP: 'chrome', WCU_BROWSER_EXE: exe, WCU_BROWSER_HEADLESS: '1' } });
    assert.equal((await lane.health()).backend, 'bidi'); assert.ok(!lane.bidi.owned); await lane.shutdown();
    writeFileSync(path.join(fixtureDir, 'application.ini'), '[App]\nName=Firefox\nID=wrong\n');
    assert.equal(geckoApplication(exe), null); await assert.rejects(discoverGecko({ WCU_BROWSER_EXE: exe }), /ENGINE_MISMATCH/);
    const explicit = new BrowserLane({ env: { WCU_BROWSER_APP: 'firefox', WCU_BROWSER_EXE: exe } });
    assert.equal(await explicit.bidiBackend(), null, 'Explicit non-Gecko exe keeps the CDP route'); await explicit.shutdown();
  });
  await test('the Windows default Firefox-family browser wins over App Paths order', async () => {
    const install = (folder, name) => {
      const dir = path.join(fixtureDir, folder); mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'application.ini'), `[App]\nName=${name}\nID=${GECKO_APP_ID}\n`);
      const exe = path.join(dir, name.toLowerCase() + '.exe'); writeFileSync(exe, 'fixture'); return exe;
    };
    const firefox = install('Mozilla Firefox', 'Firefox'), vantage = install('浏览器\\Vantage Browser', 'Vantage'), queries = [];
    const query = async args => {
      queries.push(args[1]);
      if (args[1] === 'HKCR\\FirefoxURL-194E8716761A8849\\shell\\open\\command') return `\r\nHKEY_CLASSES_ROOT\\FirefoxURL-194E8716761A8849\\shell\\open\\command\r\n    (Default)    REG_SZ    "${vantage}" -osint -url "%1"\r\n`;
      if (args[1].startsWith('HKLM')) return [firefox, vantage].map(exe => `\r\nHKEY_LOCAL_MACHINE\\...\\App Paths\\${path.basename(exe)}\r\n    (Default)    REG_SZ    ${exe}\r\n`).join('');
      return '';
    };
    assert.equal((await discoverGecko({}, undefined, query)).name, 'Firefox', 'Without a default, App Paths order decides');
    assert.equal((await discoverGecko({}, 'FirefoxURL-194E8716761A8849', query)).path, vantage, 'The default ProgId comes first');
    assert.equal(queries[2], 'HKCR\\FirefoxURL-194E8716761A8849\\shell\\open\\command');
    const lane = new BrowserLane({ env: { WCU_BROWSER_APP: 'firefox', WCU_BROWSER_HEADLESS: '1' } }); lane.progId = 'FirefoxURL-194E8716761A8849';
    assert.equal((await lane.bidiBackend()).progId, 'FirefoxURL-194E8716761A8849', 'Choosing Firefox passes the default ProgId on'); await lane.shutdown();
  });
} finally { rmSync(fixtureDir, { recursive: true, force: true }); }
await test('reg.exe output in the OEM code page keeps Chinese paths', () => {
  const gbk = Buffer.concat([Buffer.from('D:\\'), Buffer.from('c8edbcfe', 'hex'), Buffer.from('\\Vantage Browser\\vantage.exe')]);
  assert.equal(oemText(gbk, '936'), 'D:\\软件\\Vantage Browser\\vantage.exe');
  assert.equal(oemText(Buffer.from('C:\\Program Files'), '437'), 'C:\\Program Files', 'An OEM page TextDecoder lacks falls back to UTF-8');
});
await test('settings and existing browser/quiet routing accept Gecko without new tools', () => {
  assert.equal(normalizeSettings({ browserApp: 'firefox' }).browserApp, 'firefox');
  assert.ok(isBrowserCall({ elementId: 't123abc:42' })); assert.ok(isQuietCall('click', { browserTab: 't123abc' }));
  assert.equal(isQuietCall('launch_app', { target: 'notepad.exe' }), true);
  assert.equal(isQuietCall('launch_app', { target: 'notepad.exe', activate: true }), false, 'Bringing the app forward shows the takeover indicator, as activate_window does');
  assert.equal(appForProgId('MSEdgeHTM'), 'edge'); assert.equal(appForProgId('ChromeHTML'), 'chrome');
});
await test('Firefox OS default retains Chromium fallback until explicitly selected', async () => {
  const lane = new BrowserLane({ env: {} }); lane.resolveApp = async () => (lane.resolvedApp = 'firefox');
  assert.equal(await lane.bidiBackend(), null);
  assert.equal((await lane.health()).backend, undefined); assert.equal(lane.bidi, undefined);
  await lane.shutdown();
});
await test('visible launch refuses before profile or process side effects', async () => {
  await assert.rejects(launchGecko({ headless: false }), /VISIBLE_UNVERIFIED/);
});
await test('kept profiles are executable-specific; a live owner blocks, a dead owner\'s lock is taken over', async () => {
  assert.notEqual(geckoProfileName('C:/Firefox/browser.exe'), geckoProfileName('C:/Vantage/browser.exe'));
  const root = mkdtempSync(path.join(process.env.WCU_TEST_OUTPUT || os.tmpdir(), 'wcu-bidi-lock-'));
  try {
    const executable = path.join(root, 'fixture.exe'), profile = path.join(root, geckoProfileName(executable)), lock = path.join(profile, 'dsh-bidi-owner');
    let spawned = 0;
    const spawnImpl = () => {
      spawned++; const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 99996;
      child.kill = () => child.emit('exit', null, 'SIGTERM');
      queueMicrotask(() => child.stderr.emit('data', 'WebDriver BiDi listening on ws://127.0.0.1:1234\n')); return child;
    };
    mkdirSync(profile); writeFileSync(lock, String(process.ppid));
    await assert.rejects(launchGecko({ executable, root, keep: true, spawnImpl }), /BROWSER_PROFILE_BUSY.*running process/);
    assert.equal(spawned, 0, 'A second owner never spawns');
    // Windows process ids are multiples of 4, so 99999 is never a live process:
    // the lock of a server that crashed or was killed.
    writeFileSync(lock, '99999');
    const owned = await launchGecko({ executable, root, keep: true, spawnImpl });
    assert.equal(spawned, 1); assert.equal(readFileSync(lock, 'utf8'), String(process.pid));
    await owned.stop(); assert.equal(existsSync(lock), false); assert.equal(existsSync(profile), true, 'The kept profile stays');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
await test('owned launch has isolated flags, parses split stderr and cleanup is idempotent', async () => {
  const root = mkdtempSync(path.join(process.env.WCU_TEST_OUTPUT || os.tmpdir(), 'wcu-bidi-launch-')), traces = [];
  try {
    const owned = await launchGecko({ executable: path.join(root, 'fixture.exe'), root, trace: (kind, data) => traces.push({ kind, data }),
      spawnImpl: (exe, args, options) => {
        assert.ok(args.includes('-no-remote')); assert.ok(args.includes('-new-instance')); assert.ok(args.includes('-headless')); assert.equal(options.windowsHide, true);
        const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 99999;
        child.kill = () => child.emit('exit', null, 'SIGTERM');
        queueMicrotask(() => { child.stderr.emit('data', 'WebDriver BiDi listen'); child.stderr.emit('data', 'ing on ws://127.0.0.1:1234\n'); }); return child;
      } });
    assert.equal(owned.endpoint, 'ws://127.0.0.1:1234'); assert.equal(existsSync(owned.profile), true);
    await owned.stop(); await owned.stop(); assert.equal(existsSync(owned.profile), false); assert.ok(!traces.some(t => t.kind === 'cleanupError'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
await test('profile initialization failure releases only the newly acquired owner lock', async () => {
  const root = mkdtempSync(path.join(process.env.WCU_TEST_OUTPUT || os.tmpdir(), 'wcu-bidi-init-'));
  try {
    const executable = path.join(root, 'never-spawn.exe'), profile = path.join(root, geckoProfileName(executable));
    mkdirSync(profile); mkdirSync(path.join(profile, 'user.js'));
    await assert.rejects(launchGecko({ executable, root, keep: true }), /EISDIR|EPERM|EACCES/);
    assert.equal(existsSync(path.join(profile, 'dsh-bidi-owner')), false); assert.equal(existsSync(profile), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
await test('URLs and keys reject desktop shortcuts and ambiguous input', () => {
  assert.equal(bidiUrl('example.com/a'), 'https://example.com/a');
  assert.throws(() => bidiUrl('搜索词'), /search URL/); assert.throws(() => bidiUrl('javascript:alert(1)'), /INVALID_ARGUMENTS/);
  assert.throws(() => keyActions(['ctrl', 'l']), /BROWSER_UI_SHORTCUT/); assert.throws(() => keyActions(['a', 'b']), /one non-modifier/);
  assert.deepEqual(keyActions(['ctrl', 'a']).map(e => e.type), ['keyDown', 'keyDown', 'keyUp', 'keyUp']);
  assert.equal(keyActions(['Enter'])[0].value, '\uE007'); assert.equal(keyActions(['中'])[0].value, '中');
});

class FakeBidi {
  listeners = new Set(); calls = []; closed = false; value = ''; next = 0;
  emit(method, params) { for (const listener of this.listeners) listener({ type: 'event', method, params }); }
  async send(method, params) {
    this.calls.push({ method, params });
    if (method === 'browsingContext.create') return { context: `context-${++this.next}` };
    if (method === 'browsingContext.navigate') { this.emit('browsingContext.navigationStarted', { context: params.context, url: params.url }); return { navigation: 'n', url: params.url }; }
    if (method === 'browsingContext.getTree') return { contexts: Array.from({ length: this.next }, (_, i) => ({ context: `context-${i + 1}`, url: 'https://fixture.test' })) };
    if (method === 'script.callFunction') {
      if (params.functionDeclaration === domOutline.toString()) return { type: 'success', result: remote({ title: 'Fixture', url: 'https://fixture.test', entries: [
        { node: { sharedId: 'field' }, role: 'textbox', name: '关键词', value: this.value, states: [] },
        { node: { sharedId: 'button' }, role: 'button', name: '提交', value: '', states: [] }], iframes: 0, truncated: false }) };
      if (params.arguments?.[0]?.value === 'set') this.value = params.arguments[1].value;
      return { type: 'success', result: remote(this.value) };
    }
    if (method === 'browsingContext.captureScreenshot') {
      const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(1280, 16); png.writeUInt32BE(720, 20); return { data: png.toString('base64') };
    }
    return {};
  }
  close() { this.closed = true; }
}
function fixture() { const connection = new FakeBidi(); const lane = new BidiBrowserLane({ env: {}, connection }); const tab = lane.tabFor({ context: 'context-1', url: 'https://fixture.test' }); connection.next = 1; return { connection, lane, tab }; }
await test('explicit endpoint health is cold and does not require a local executable', async () => {
  const lane = new BrowserLane({ env: { WCU_BROWSER_BIDI_URL: 'ws://127.0.0.1:1234', WCU_BROWSER_APP: 'edge', WCU_BROWSER_EXE: 'missing.exe' } });
  const health = await lane.health(); assert.equal(health.backend, 'bidi'); assert.equal(health.configuredEndpoint, true);
  assert.equal(health.agentBrowser, null); assert.equal(lane.bidi.connection, undefined); await lane.shutdown();
});
await test('configured endpoint ends only its own session and permits retry after busy', async () => {
  const open = BidiConnection.open;
  try {
    const rejected = new FakeBidi(); rejected.send = async function(method) { this.calls.push({ method }); throw new Error('Maximum number of active sessions'); };
    BidiConnection.open = async () => rejected;
    const lane = new BidiBrowserLane({ env: { WCU_BROWSER_BIDI_URL: 'ws://127.0.0.1:1234' } });
    await assert.rejects(lane.ensure(), /Maximum number/); assert.deepEqual(rejected.calls.map(c => c.method), ['session.new']);
    assert.equal(lane.connection, null); assert.equal(lane.owned, null);
    const accepted = new FakeBidi(); BidiConnection.open = async () => accepted;
    await lane.ensure(); assert.equal(lane.sessionOwned, true); await lane.shutdown();
    assert.ok(accepted.calls.some(c => c.method === 'session.end')); assert.ok(!accepted.calls.some(c => c.method === 'browser.close'));
  } finally { BidiConnection.open = open; }
});
await test('failed configured session subscription releases its created session', async () => {
  const open = BidiConnection.open;
  try {
    const connection = new FakeBidi(), send = connection.send.bind(connection);
    connection.send = async (method, params) => { if (method === 'session.subscribe') throw new Error('subscription failed'); return send(method, params); };
    BidiConnection.open = async () => connection;
    const lane = new BidiBrowserLane({ env: { WCU_BROWSER_BIDI_URL: 'ws://127.0.0.1:1234' } });
    await assert.rejects(lane.ensure(), /subscription failed/);
    assert.ok(connection.calls.some(c => c.method === 'session.end')); assert.ok(!connection.calls.some(c => c.method === 'browser.close'));
  } finally { BidiConnection.open = open; }
});
await test('concurrent endpoint callers wait for session initialization', async () => {
  const open = BidiConnection.open;
  try {
    const connection = new FakeBidi(), send = connection.send.bind(connection); let release;
    const initialized = new Promise(resolve => { release = resolve; }); let ready = false;
    connection.send = async (method, params) => {
      if (method === 'session.new') { await initialized; ready = true; }
      if (method === 'browsingContext.getTree') assert.equal(ready, true);
      return send(method, params);
    };
    BidiConnection.open = async () => connection;
    const lane = new BidiBrowserLane({ env: { WCU_BROWSER_BIDI_URL: 'ws://127.0.0.1:1234' } });
    const first = lane.ensure(); await Promise.resolve();
    const second = lane.annotateWindows({ windows: [] }); release();
    await Promise.all([first, second]); assert.equal(connection.calls.filter(c => c.method === 'session.new').length, 1);
    await lane.shutdown();
  } finally { BidiConnection.open = open; }
});
await test('invalid browser context is diagnosed instead of issuing page commands', async () => {
  const { lane, connection } = fixture(); connection.send = async () => ({ contexts: [{ context: null }] });
  await assert.rejects(lane.refresh(), /BROWSER_BIDI_CONTEXT.*content-process/);
});
await test('DOM outline IDs stable, navigation IDs invalidated and never reused', async () => {
  const { connection, lane, tab } = fixture();
  const a = await lane.outline(tab), b = await lane.outline(tab); assert.equal(a.rows[0].id, b.rows[0].id);
  connection.emit('browsingContext.navigationStarted', { context: tab.context, url: 'https://other.test' });
  await assert.rejects(lane.run('click', { elementId: a.rows[0].id }), /BROWSER_ELEMENT_STALE/);
  const c = await lane.outline(tab); assert.notEqual(c.rows[0].id, a.rows[0].id);
  const other = fixture(); assert.notEqual(other.lane.idFor(other.tab, 'field'), c.rows[0].id);
});
await test('new-tab routing, address navigation, full/diff and field verification', async () => {
  const { lane } = fixture(); const r = await lane.run('set_value', { elementId: 'new-tab', value: 'https://fixture.test' });
  assert.equal(r.meta.opened.id, r.meta.tab.id); assert.equal(r.meta.channel, 'browser'); assert.match(r.text, /textbox "关键词"/);
  const tab = lane.tabs.get(r.meta.opened.id); const id = (await lane.outline(tab)).rows[0].id;
  const edit = await lane.run('set_value', { elementId: id, value: '中文' }); assert.equal(edit.meta.verifyValue, '中文'); assert.match(edit.text, /^\+ .*value="中文"/m);
  assert.equal((await lane.run('set_value', { elementId: `${tab.key}:address`, value: 'https://other.test' })).meta.pageChange, 'full');
});
await test('invalid mixed targets, mismatched tabs and address misuse send no commands', async () => {
  const { connection, lane, tab } = fixture();
  for (const args of [{ browserTab: tab.key, x: 10 }, { elementId: `${tab.key}:1`, browserTab: 'tab-other' }, { elementId: `${tab.key}:address` }])
    await assert.rejects(lane.run('click', args), /INVALID_ARGUMENTS/);
  assert.equal(connection.calls.length, 0);
});
await test('queued cancellation prevents writes and queue survives rejected call', async () => {
  const { lane, connection, tab } = fixture(); const id = (await lane.outline(tab)).rows[0].id;
  let release; lane.queue = new Promise(resolve => { release = resolve; });
  const request = { cancelled: false }, pending = lane.run('set_value', { elementId: id, value: 'must-not-write' }, request);
  request.cancelled = true; release(); await assert.rejects(pending, /COMPUTER_USE_CANCELLED/); assert.equal(connection.value, '');
  assert.equal((await lane.run('set_value', { elementId: id, value: 'ok' })).meta.verifyValue, 'ok');
});
await test('click uses sharedId element origin and always releases virtual inputs', async () => {
  const { lane, connection, tab } = fixture(); const id = (await lane.outline(tab)).rows[1].id;
  await lane.run('click', { elementId: id });
  const sent = connection.calls.find(call => call.method === 'input.performActions');
  assert.deepEqual(sent.params.actions[0].actions[0].origin, { type: 'element', element: { sharedId: 'button' } });
  assert.ok(connection.calls.some(call => call.method === 'input.releaseActions'));
});
await test('prompt race returns promptly; blocks reads, stages Unicode answer, handles Enter', async () => {
  const { lane, connection, tab } = fixture();
  const pending = lane.untilPrompt(tab, () => new Promise(() => {}));
  connection.emit('browsingContext.userPromptOpened', { context: tab.context, type: 'prompt', message: '名字', defaultValue: '默认' });
  assert.equal(await pending, undefined); assert.equal(tab.promptWaiters.size, 0);
  await assert.rejects(lane.run('tree', { browserTab: tab.key }), /BROWSER_DIALOG_OPEN/);
  await lane.run('type_text', { browserTab: tab.key, text: '张三' });
  const r = await lane.run('keypress', { browserTab: tab.key, keys: ['Enter'] }); assert.equal(r.meta.handledDialog, 'accepted');
  assert.equal(connection.calls.find(call => call.method === 'browsingContext.handleUserPrompt').params.userText, '张三');
});
await test('wait_for observes, times out, validates query and honours cancellation', async () => {
  const { lane, tab } = fixture();
  assert.equal((await lane.run('wait_for', { browserTab: tab.key, condition: 'text', query: '关键词' })).meta.verification, 'observed');
  assert.equal((await lane.run('wait_for', { browserTab: tab.key, condition: 'text', query: 'missing', timeoutMs: 0 })).meta.verification, 'timeout');
  await assert.rejects(lane.run('wait_for', { browserTab: tab.key, condition: 'text' }), /requires query/);
  await assert.rejects(lane.run('wait_for', { browserTab: tab.key, condition: 'text', query: 'missing' }, { cancelled: true }), /CANCELLED/);
});
await test('screenshot returns actual PNG dimensions and explicit no-resize note', async () => {
  const { lane, tab } = fixture(); const r = await lane.run('screenshot', { browserTab: tab.key, maxWidth: 640 });
  assert.deepEqual([r.screenshot.width, r.screenshot.height], [1280, 720]); assert.match(r.screenshot.note, /does not resize.*640/);
});
await test('disabled lane and disconnected session reject before mutation', async () => {
  const { lane, connection, tab } = fixture(); lane.env.WCU_BROWSER_LANE = 'off';
  await assert.rejects(lane.run('set_value', { elementId: 'new-tab', value: 'https://fixture.test' }), /UNAVAILABLE/);
  delete lane.env.WCU_BROWSER_LANE; connection.closed = true;
  await assert.rejects(lane.run('tree', { browserTab: tab.key }), /DISCONNECTED/); assert.equal(connection.calls.length, 0);
});
await test('DOM setters reject detached/disabled/readonly without side effects', () => {
  const base = { isConnected: true, tagName: 'INPUT', type: 'text', matches: () => false, closest: () => null, getAttribute: () => null };
  assert.throws(() => domElement.call({ ...base, isConnected: false }, 'set', 'x'), /STALE/);
  assert.throws(() => domElement.call({ ...base, matches: () => true }, 'set', 'x'), /disabled/);
  assert.throws(() => domElement.call({ ...base, readOnly: true }, 'set', 'x'), /read-only/);
  assert.throws(() => domElement.call({ ...base, type: 'checkbox' }, 'set', 'maybe'), /true or false/);
  assert.throws(() => domElement.call({ ...base, type: 'radio', checked: true }, 'set', 'false'), /radio/);
  assert.equal(domElement.call({ ...base, type: 'password', value: 'secret' }, 'read'), '[redacted]');
});
await test('select options validate atomically and checkbox uses one click', () => {
  const base = { isConnected: true, matches: () => false, closest: () => null, getAttribute: () => null };
  const a = { value: 'a', text: '北京', selected: true }, b = { value: 'b', text: '上海', disabled: true };
  const select = { ...base, tagName: 'SELECT', options: [a, b] };
  assert.throws(() => domElement.call(select, 'set', '上海'), /OPTION_DISABLED/); assert.equal(a.selected, true);
  assert.throws(() => domElement.call(select, 'set', '不存在'), /OPTION_NOT_FOUND/);
  let clicks = 0; const box = { ...base, tagName: 'INPUT', type: 'checkbox', checked: false, click() { this.checked = !this.checked; clicks++; } };
  assert.equal(domElement.call(box, 'set', 'true'), 'checked'); domElement.call(box, 'set', 'true'); assert.equal(clicks, 1);
});
await test('DOM value validation preserves invalid number and dispatches setter events', () => {
  const saved = { document: globalThis.document, HTMLInputElement: globalThis.HTMLInputElement, InputEvent: globalThis.InputEvent };
  class Input { set value(value) { this.actual = value; } get value() { return this.actual; } }
  try {
    globalThis.HTMLInputElement = Input; globalThis.InputEvent = class extends Event {};
    globalThis.document = { createElement: () => ({ set value(v) { this.actual = this.type === 'number' && Number.isNaN(Number(v)) ? '' : v; }, get value() { return this.actual; } }) };
    const events = [], el = Object.assign(new Input(), { isConnected: true, tagName: 'INPUT', type: 'number', actual: '12', matches: () => false, closest: () => null, getAttribute: () => null, dispatchEvent: e => events.push(e.type) });
    assert.throws(() => domElement.call(el, 'set', 'abc'), /VALUE_REJECTED/); assert.equal(el.value, '12'); assert.deepEqual(events, []);
    assert.equal(domElement.call(el, 'set', '25'), '25'); assert.deepEqual(events, ['input', 'change']);
  } finally { Object.assign(globalThis, saved); }
});
await test('DOM outline heuristics label fields, omit hidden nodes, walk open shadow roots and flag frames', () => {
  const saved = { document: globalThis.document, location: globalThis.location, getComputedStyle: globalThis.getComputedStyle };
  const root = { activeElement: null, getElementById: () => null };
  const el = (tagName, text = '', attrs = {}, children = []) => ({ nodeType: 1, tagName, textContent: text, innerText: text,
    childNodes: [...(text ? [{ nodeType: 3, data: text }] : []), ...children],
    type: tagName === 'INPUT' ? 'text' : undefined, value: tagName === 'INPUT' ? '内容' : undefined,
    tabIndex: -1, getAttribute: name => attrs[name] ?? null, hasAttribute: name => name in attrs,
    getRootNode: () => root, getClientRects: () => [1], matches: () => false });
  const field = el('INPUT'); field.labels = [{ textContent: '姓名' }];
  const shadow = el('DIV'); shadow.shadowRoot = { childNodes: [el('BUTTON', '影子按钮')] };
  // A container keeps only the text no listed element inside it shows, and a
  // label's text stays with its control.
  const wrapped = el('INPUT'); wrapped.labels = [{ textContent: '城市' }];
  const label = el('LABEL', '城市', {}, [wrapped]); label.control = wrapped;
  const main = el('MAIN', '开头的说明', {}, [el('UL', '', {}, [el('LI', '', {}, [el('A', '链接一')]), el('LI', '纯文字')]), label,
    el('TABLE', '', {}, [el('TR', '', {}, [el('TD', '单元格')])])]);
  try {
    globalThis.location = { href: 'https://fixture.test' }; globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
    globalThis.document = { title: '测试页', childNodes: [el('H1', '标题'), field, el('BUTTON', '隐藏', { 'aria-hidden': 'true' }), shadow, el('IFRAME'), main] };
    const outline = domOutline(); assert.deepEqual(outline.entries.map(e => [e.role, e.name]), [['heading', '标题'], ['textbox', '姓名'], ['button', '影子按钮'],
      ['main', '开头的说明'], ['list', ''], ['listitem', ''], ['link', '链接一'], ['listitem', '纯文字'], ['textbox', '城市'], ['table', ''], ['row', ''], ['cell', '单元格']]);
    assert.ok(outline.entries.every(e => !('own' in e)));
    assert.equal(outline.entries[1].value, '内容'); assert.equal(outline.iframes, 1); assert.equal(domOutline(1).truncated, true);
  } finally { Object.assign(globalThis, saved); }
});
await test('tab ids are short and the started Firefox is reported headless', async () => {
  const { tab } = fixture(); assert.match(tab.key, /^t[0-9a-f]{16}$/);
  const lane = new BidiBrowserLane({ env: {}, executable: { path: 'C:/fixture/firefox.exe', name: 'Firefox' } });
  assert.equal((await lane.health()).visible, false, 'Show the browser window does not apply to the Firefox the plugin starts');
});
await test('window annotation only associates owned Gecko PID and Mozilla class', async () => {
  const { lane } = fixture(); lane.owned = { child: { pid: 123 } };
  const result = await lane.annotateWindows({ windows: [{ processId: 123, className: 'MozillaWindowClass' }, { processId: 456, className: 'MozillaWindowClass' }, { processId: 123, className: 'OtherClass' }] });
  assert.equal(result.windows[0].browser, lane.key); assert.equal(result.windows[1].browser, undefined); assert.equal(result.windows[2].browser, undefined);
});
console.log(JSON.stringify({ offline: 'passed', tests: passed }));

if (!process.argv.includes('--live')) console.log('SKIP live Gecko: pass --live to execute real-browser checks');
else {
  const executable = await discoverGecko(process.env);
  if (!executable) console.log('SKIP live Gecko: no registered Firefox-family executable found');
  else {
    const root = process.env.WCU_TEST_OUTPUT || path.join(os.tmpdir(), 'wcu-bidi-live'); mkdirSync(root, { recursive: true });
    // Show the browser window stays on (HEADLESS 0): the started Firefox must
    // still run headless instead of failing every call.
    const lane = new BidiBrowserLane({ executable, env: { ...process.env, WCU_BROWSER_HEADLESS: '0', WCU_BROWSER_PROFILE: root },
      trace: process.env.WCU_BIDI_TRACE ? (kind, data) => console.log(JSON.stringify({ kind, data })) : undefined });
    try {
      const html = '<meta charset="utf-8"><title>BiDi Fixture</title><h1>测试标题</h1><label>关键词<input></label><button onclick="document.querySelector(\'p\').textContent=\'已点击\'">提交</button><p>未点击</p><label>记住<input type="checkbox"></label><select aria-label="城市"><option value="bj">北京</option><option value="sh">上海</option></select><div contenteditable="true" aria-label="编辑器">原文</div><button onclick="alert(\'你好\')">弹窗</button><ul><li><a href="#one">链接一</a></li><li>纯文字</li></ul><div style="height:2000px"></div>';
      const r = await lane.run('set_value', { elementId: 'new-tab', value: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
      const tab = r.meta.opened.id, element = async query => (await lane.run('find', { browserTab: tab, query })).meta.results[0].id;
      assert.match(r.text, /heading "测试标题"/); assert.match(tab, /^t[0-9a-f]{16}$/);
      assert.match(r.text, /list ""/); assert.match(r.text, /link "链接一"/); assert.match(r.text, /listitem "纯文字"/);
      assert.equal((r.text.match(/链接一/g) ?? []).length, 1, 'A link text appears once, not again in its list and list item');
      assert.equal((r.text.match(/关键词/g) ?? []).length, 1, 'A label text appears once, as its field name');
      const field = await element('关键词');
      assert.equal((await lane.run('set_value', { elementId: field, value: '中文' })).meta.verifyValue, '中文');
      await lane.run('focus', { elementId: field }); await lane.run('keypress', { browserTab: tab, keys: ['ctrl', 'a'] });
      assert.equal((await lane.run('type_text', { browserTab: tab, text: '键盘中文' })).meta.verifyValue, '键盘中文');
      await lane.run('click', { elementId: await element('提交') });
      assert.equal((await lane.run('wait_for', { browserTab: tab, condition: 'text', query: '已点击' })).meta.verification, 'observed');
      assert.equal((await lane.run('set_value', { elementId: await element('记住'), value: 'true' })).meta.verifyValue, 'checked');
      assert.equal((await lane.run('set_value', { elementId: await element('城市'), value: '上海' })).meta.verifyValue, '上海');
      assert.equal((await lane.run('set_value', { elementId: await element('编辑器'), value: '新文本' })).meta.verifyValue, '新文本');
      const screenshot = await lane.run('screenshot', { browserTab: tab }); assert.ok(screenshot.screenshot.width > 0);
      const scroll = await lane.run('scroll', { browserTab: tab, deltaY: 300 }); assert.ok(scroll.meta.pageScroll.after[1] > 0);
      assert.equal((await lane.run('click', { elementId: await element('弹窗') })).meta.dialog.type, 'alert');
      await lane.run('keypress', { browserTab: tab, keys: ['Enter'] });
      const second = await lane.run('set_value', { elementId: 'new-tab', value: 'about:blank' });
      assert.notEqual(second.meta.opened.id, tab);
      await lane.run('set_value', { elementId: `${tab}:address`, value: 'about:blank' });
      await assert.rejects(lane.run('click', { elementId: field }), /STALE/);
      await lane.run('close_window', { browserTab: second.meta.opened.id });
      await lane.run('close_window', { browserTab: tab }); console.log('PASS live Gecko core lane workflow');
    } finally { await lane.shutdown(); }
    // Emulate a caller-provided endpoint using another test-owned browser.
    // The lane must leave this browser alive and release only its own session.
    const owned = await launchGecko({ executable: executable.path, root, headless: true });
    const external = new BidiBrowserLane({ env: { WCU_BROWSER_BIDI_URL: owned.endpoint } });
    const competing = new BidiBrowserLane({ env: { WCU_BROWSER_BIDI_URL: owned.endpoint } });
    let verify, client;
    try {
      const listing = await external.annotateWindows({ windows: [] });
      assert.equal(listing.browserLane.browsers[0].source, 'configured'); assert.equal(external.owned, undefined);
      const opened = await external.run('set_value', { elementId: 'new-tab', value: 'data:text/html,<h1>External fixture</h1>' });
      await assert.rejects(competing.ensure(), /Maximum number of active sessions/);
      assert.match((await external.run('tree', { browserTab: opened.meta.opened.id })).text, /External fixture/);
      await external.shutdown(); assert.equal(owned.exited, false);
      await competing.ensure();
      assert.ok([...competing.tabs.values()].some(t => /External%20fixture|External fixture/.test(t.url)));
      await competing.shutdown(); assert.equal(owned.exited, false);
      client = new McpTestClient(process.execPath, [path.join(import.meta.dirname, '../mcp/server.mjs')], {
        env: { ...process.env, WCU_BROWSER_BIDI_URL: owned.endpoint, WCU_INDICATOR: '0', WCU_TEST_NO_TAKEOVER: '1' },
      });
      const call = async (name, args) => {
        const result = await client.call('windows_computer_use_' + name, args);
        assert.ok(!result.isError, JSON.stringify(result)); return result;
      };
      await client.init();
      const mcpPage = await call('set_value', { elementId: 'new-tab', value: 'data:text/html,<h1>MCP BiDi fixture</h1><label>Name<input></label>' });
      const mcpMeta = JSON.parse(mcpPage.content.find(c => c.type === 'text').text);
      assert.equal(mcpMeta.backend, 'bidi');
      const found = await call('find', { browserTab: mcpMeta.opened.id, query: 'Name' });
      const field = JSON.parse(found.content.find(c => c.type === 'text').text).results[0].id;
      const set = await call('set_value', { elementId: field, value: 'MCP 中文' });
      assert.equal(JSON.parse(set.content.find(c => c.type === 'text').text).verifyValue, 'MCP 中文');
      assert.ok((await call('screenshot', { browserTab: mcpMeta.opened.id })).content.some(c => c.type === 'image' && c.mimeType === 'image/png'));
      client.child.stdin.end();
      for (let i = 0; client.child.exitCode === null && i < 50; i++) await delay(100);
      assert.equal(client.child.exitCode, 0, client.stderr); assert.equal(owned.exited, false);
      verify = await BidiConnection.open(owned.endpoint);
      await verify.send('session.new', { capabilities: {} });
      assert.ok((await verify.send('browsingContext.getTree')).contexts.length >= 2);
      await verify.send('browser.close'); console.log('PASS configured BiDi endpoint: existing tabs, busy-session isolation, browser survives shutdown and reconnect; real MCP read/write/screenshot and graceful exit');
    } finally { if (client?.child.exitCode === null) client.close(); await external.shutdown(); await competing.shutdown(); verify?.close(); await owned.stop(); }
  }
}
