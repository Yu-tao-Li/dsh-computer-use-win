// No packages required. Default: offline unit tests. --live additionally starts
// one owned headless Gecko instance; no registered Gecko => explicit skip.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { BidiConnection, BidiBrowserLane, GECKO_APP_ID, geckoApplication, geckoProfileName, discoverGecko, remoteValue, localValue, keyActions, bidiUrl, launchGecko } from '../mcp/browser-bidi.mjs';
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
} finally { rmSync(fixtureDir, { recursive: true, force: true }); }
await test('settings and existing browser/quiet routing accept Gecko without new tools', () => {
  assert.equal(normalizeSettings({ browserApp: 'firefox' }).browserApp, 'firefox');
  assert.ok(isBrowserCall({ elementId: 't123abc:42' })); assert.ok(isQuietCall('click', { browserTab: 't123abc' }));
  assert.equal(appForProgId('MSEdgeHTM'), 'edge'); assert.equal(appForProgId('ChromeHTML'), 'chrome');
});
await test('visible launch refuses before profile or process side effects', async () => {
  await assert.rejects(launchGecko({ headless: false }), /VISIBLE_UNVERIFIED/);
});
await test('kept profiles are executable-specific and a second owner never spawns', async () => {
  assert.notEqual(geckoProfileName('C:/Firefox/browser.exe'), geckoProfileName('C:/Vantage/browser.exe'));
  const root = mkdtempSync(path.join(process.env.WCU_TEST_OUTPUT || os.tmpdir(), 'wcu-bidi-lock-'));
  try {
    const executable = path.join(root, 'never-spawn.exe'), profile = path.join(root, geckoProfileName(executable));
    mkdirSync(profile); writeFileSync(path.join(profile, 'dsh-bidi-owner'), '99999');
    await assert.rejects(launchGecko({ executable, root, headless: true, keep: true }), /BROWSER_PROFILE_BUSY/);
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
  const el = (tagName, text = '', attrs = {}, children = []) => ({ tagName, textContent: text, innerText: text, children,
    type: tagName === 'INPUT' ? 'text' : undefined, value: tagName === 'INPUT' ? '内容' : undefined,
    tabIndex: -1, getAttribute: name => attrs[name] ?? null, hasAttribute: name => name in attrs,
    getRootNode: () => root, getClientRects: () => [1], matches: () => false });
  const field = el('INPUT'); field.labels = [{ textContent: '姓名' }];
  const shadow = el('DIV'); shadow.shadowRoot = { children: [el('BUTTON', '影子按钮')] };
  try {
    globalThis.location = { href: 'https://fixture.test' }; globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
    globalThis.document = { title: '测试页', children: [el('H1', '标题'), field, el('BUTTON', '隐藏', { 'aria-hidden': 'true' }), shadow, el('IFRAME')] };
    const outline = domOutline(); assert.deepEqual(outline.entries.map(e => [e.role, e.name]), [['heading', '标题'], ['textbox', '姓名'], ['button', '影子按钮']]);
    assert.equal(outline.entries[1].value, '内容'); assert.equal(outline.iframes, 1); assert.equal(domOutline(1).truncated, true);
  } finally { Object.assign(globalThis, saved); }
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
    const lane = new BidiBrowserLane({ executable, env: { ...process.env, WCU_BROWSER_HEADLESS: '1', WCU_BROWSER_PROFILE: root },
      trace: process.env.WCU_BIDI_TRACE ? (kind, data) => console.log(JSON.stringify({ kind, data })) : undefined });
    try {
      const html = '<meta charset="utf-8"><title>BiDi Fixture</title><h1>测试标题</h1><label>关键词<input></label><button onclick="document.querySelector(\'p\').textContent=\'已点击\'">提交</button><p>未点击</p><label>记住<input type="checkbox"></label><select aria-label="城市"><option value="bj">北京</option><option value="sh">上海</option></select><div contenteditable="true" aria-label="编辑器">原文</div><button onclick="alert(\'你好\')">弹窗</button><div style="height:2000px"></div>';
      const r = await lane.run('set_value', { elementId: 'new-tab', value: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
      const tab = r.meta.opened.id, element = async query => (await lane.run('find', { browserTab: tab, query })).meta.results[0].id;
      assert.match(r.text, /heading "测试标题"/);
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
  }
}
