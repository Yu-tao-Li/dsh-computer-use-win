// Experimental Gecko lane. Own a fresh browser, or connect only to an endpoint
// explicitly configured by the user. DOM semantics approximate, not replace, AX.
import { execFile, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { domOutline, domElement, domFocused } from './browser-bidi-dom.mjs';

export const GECKO_APP_ID = '{ec8030f7-c20a-464f-9b0e-13a3a9e97384}';
const fail = (code, detail) => { throw new Error(`${code}: ${detail}`); };
const check = request => { if (request?.cancelled) fail('COMPUTER_USE_CANCELLED', 'cancelled'); };
const processAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// reg.exe prints in the OEM code page (GBK on Chinese Windows), so a browser
// installed under a Chinese folder came back garbled when read as UTF-8.
const OEM_ENCODINGS = { 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5' };
export function oemText(bytes, page) {
  try { return new TextDecoder(OEM_ENCODINGS[page] ?? `cp${page}`).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}
const regBytes = args => new Promise(resolve => execFile('reg.exe', args,
  { windowsHide: true, timeout: 5000, encoding: 'buffer' }, (error, stdout) => resolve(error ? null : stdout)));
let oemPage;
async function regQuery(args) {
  const bytes = await regBytes(args);
  if (!bytes) return '';
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { }
  oemPage ??= regBytes(['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'OEMCP'])
    .then(output => /OEMCP\s+REG_SZ\s+(\d+)/.exec(output?.toString('latin1') ?? '')?.[1]);
  return oemText(bytes, await oemPage);
}

export function geckoApplication(executable) {
  if (!executable || !existsSync(executable)) return null;
  for (const file of [path.join(path.dirname(executable), 'application.ini'), path.join(path.dirname(executable), 'browser', 'application.ini')]) {
    try {
      const app = /(?:^|\r?\n)\[App\]\s*\r?\n([\s\S]*?)(?=\r?\n\[|$)/i.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
      const value = key => new RegExp(`^${key}=(.*)$`, 'mi').exec(app)?.[1].trim();
      if (value('ID')?.toLowerCase() === GECKO_APP_ID) return { path: executable, key: 'firefox', engine: 'gecko', name: value('Name') || 'Gecko', version: value('Version') };
    } catch { }
  }
  return null;
}

// The Windows default browser first when it is a Firefox-family one (its
// ProgId), then App Paths; do not require firefox.exe or browserName=firefox.
export async function discoverGecko(env = process.env, progId, query = regQuery) {
  if (env.WCU_BROWSER_EXE) {
    const app = geckoApplication(env.WCU_BROWSER_EXE);
    if (!app) fail('BROWSER_ENGINE_MISMATCH', 'WCU_BROWSER_EXE has no Firefox-family application.ini ID');
    return app;
  }
  const candidates = [];
  if (/^FirefoxURL-/i.test(progId ?? '')) {
    const command = await query(['query', `HKCR\\${progId}\\shell\\open\\command`, '/ve']);
    const value = /REG_SZ\s+(.*)/.exec(command)?.[1];
    const exe = /^"([^"]+\.exe)"/i.exec(value ?? '')?.[1] ?? /^(.+?\.exe)(?:\s|$)/i.exec(value ?? '')?.[1];
    if (exe) candidates.push(exe);
  }
  for (const hive of ['HKCU', 'HKLM']) {
    const output = await query(['query', `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths`, '/s']);
    for (const match of output.matchAll(/REG_(?:EXPAND_)?SZ\s+"?([^\r\n]+?\.exe)"?\s*$/gmi)) {
      candidates.push(match[1].replace(/%([^%]+)%/g, (_, key) => env[key] ?? `%${key}%`));
    }
  }
  return candidates.map(geckoApplication).find(Boolean) ?? null;
}

export class BidiConnection {
  constructor(socket, trace = () => {}) {
    this.socket = socket; this.trace = trace; this.next = 0; this.pending = new Map(); this.listeners = new Set(); this.closed = false;
    socket.addEventListener('message', event => this.receive(event.data));
    socket.addEventListener('close', () => this.fail(new Error('BROWSER_DISCONNECTED: BiDi socket closed')));
    socket.addEventListener('error', () => this.fail(new Error('BROWSER_DISCONNECTED: BiDi socket error')));
  }
  static async open(url, { timeoutMs = 5000, trace, WebSocketImpl = WebSocket } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' || !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.hash) fail('BROWSER_ENDPOINT', 'loopback ws endpoint without credentials or fragment required');
    if (parsed.pathname === '/') parsed.pathname = '/session';
    const socket = new WebSocketImpl(parsed.href);
    const connection = new BidiConnection(socket, trace);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { connection.close(); reject(new Error('BROWSER_TIMEOUT: BiDi WebSocket open')); }, timeoutMs);
      const finish = (error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
      socket.addEventListener('open', () => finish(), { once: true });
      socket.addEventListener('error', () => finish(new Error('BROWSER_DISCONNECTED: BiDi upgrade failed')), { once: true });
    });
    return connection;
  }
  receive(data) {
    let message;
    try { message = JSON.parse(String(data)); } catch { this.fail(new Error('BROWSER_PROTOCOL: invalid JSON')); return; }
    this.trace('receive', message);
    if (message.type === 'event') { for (const listener of this.listeners) listener(message); return; }
    const item = this.pending.get(message.id);
    if (!item) return;
    this.pending.delete(message.id); clearTimeout(item.timer);
    if (message.type === 'error') item.reject(new Error(`BROWSER_BIDI_ERROR: ${message.error}: ${message.message}`));
    else if (message.type === 'success') item.resolve(message.result);
    else item.reject(new Error('BROWSER_PROTOCOL: unexpected BiDi response type'));
  }
  send(method, params = {}, timeoutMs = 15000) {
    if (this.closed) return Promise.reject(new Error('BROWSER_DISCONNECTED: BiDi socket closed'));
    const message = { id: ++this.next, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(message.id); reject(new Error(`BROWSER_TIMEOUT: ${method}; outcome unknown, do not automatically retry mutations`)); }, timeoutMs);
      this.pending.set(message.id, { resolve, reject, timer });
      try { this.trace('send', message); this.socket.send(JSON.stringify(message)); }
      catch (error) { clearTimeout(timer); this.pending.delete(message.id); reject(error); }
    });
  }
  fail(error) { this.closed = true; for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear(); }
  close() { this.fail(new Error('BROWSER_DISCONNECTED: closed by lane')); try { this.socket.close(); } catch { } }
}

export const FIREFOX_PREFS = Object.freeze({
  'browser.shell.checkDefaultBrowser': false, 'browser.startup.page': 0,
  'browser.startup.homepage': 'about:blank', 'browser.startup.homepage_override.mstone': 'ignore',
  'startup.homepage_welcome_url': '', 'startup.homepage_welcome_url.additional': '',
  'browser.aboutwelcome.enabled': false, 'browser.newtabpage.enabled': false,
  'browser.sessionstore.resume_from_crash': false, 'browser.sessionstore.resume_session_once': false,
  'browser.tabs.warnOnClose': false, 'browser.warnOnQuitShortcut': false,
  'app.update.auto': false, 'app.update.enabled': false, 'app.normandy.enabled': false,
  'datareporting.policy.dataSubmissionEnabled': false, 'datareporting.healthreport.uploadEnabled': false,
  'toolkit.telemetry.enabled': false, 'toolkit.telemetry.unified': false,
  'browser.discovery.enabled': false,
  'browser.tabs.loadInBackground': true, 'browser.tabs.loadDivertedInBackground': true,
});

export function geckoProfileName(executable) {
  // Branches can have incompatible profile versions; never share kept cookies
  // or session files just because two executables have the same engine ID.
  return 'kept-firefox-' + createHash('sha1').update(path.resolve(executable).toLowerCase()).digest('hex').slice(0, 16);
}

export async function launchGecko({ executable, root, headless = true, keep = false, timeoutMs = 20000, trace = () => {}, spawnImpl = spawn }) {
  // Native nonactivating placement is a release gate. Never silently launch a
  // visible window in the wrong monitor or downgrade the user's setting.
  if (!headless) fail('BROWSER_BIDI_VISIBLE_UNVERIFIED', 'prototype requires browserVisible=false; nonactivating visible launch is not yet validated');
  mkdirSync(root, { recursive: true });
  const profile = keep ? path.join(root, geckoProfileName(executable)) : mkdtempSync(path.join(root, `bidi-${process.pid}-`));
  mkdirSync(profile, { recursive: true });
  const lock = path.join(profile, 'dsh-bidi-owner');
  for (;;) {
    try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; }
    catch (error) {
      // A server that crashed or was killed leaves its lock behind. Take the
      // profile over once that process is gone, as profileLock does for Chromium.
      let owner = 0;
      if (error.code === 'EEXIST') try { owner = Number(readFileSync(lock, 'utf8')); } catch (readError) { if (readError.code === 'ENOENT') continue; }
      if (owner > 0 && owner !== process.pid && !processAlive(owner)) { rmSync(lock, { force: true }); continue; }
      fail('BROWSER_PROFILE_BUSY', `BiDi profile already owned${owner ? ` by running process ${owner}` : ''}; never share a single session (${error.code})`);
    }
  }
  const args = ['-no-remote', '-new-instance', '-profile', profile, '-headless', '--remote-debugging-port', '0', 'about:blank'];
  let child;
  try {
    writeFileSync(path.join(profile, 'user.js'), Object.entries(FIREFOX_PREFS).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n') + '\n');
    trace('launch', { executable, args, profile });
    child = spawnImpl(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (error) {
    rmSync(lock, { force: true });
    if (!keep) rmSync(profile, { recursive: true, force: true });
    throw error;
  }
  let stderr = '', exited = false, cleaned = false;
  const exit = new Promise(resolve => child.once('exit', (code, signal) => { exited = true; trace('exit', { pid: child.pid, code, signal }); resolve(); }));
  child.stdout.on('data', data => trace('stdout', String(data)));
  const cleanup = () => { if (!exited || cleaned) return; try { rmSync(lock, { force: true }); if (!keep) rmSync(profile, { recursive: true, force: true }); cleaned = true; } catch (error) { trace('cleanupError', error.message); } };
  const stop = async () => { if (!exited) child.kill(); await Promise.race([exit, delay(3000)]); cleanup(); };
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`BROWSER_TIMEOUT: Firefox startup; ${stderr.slice(-2000)}`)), timeoutMs);
      const finish = (error, url) => { clearTimeout(timer); error ? reject(error) : resolve(url); };
      child.once('error', error => { exited = true; finish(error); });
      child.once('exit', code => finish(new Error(`BROWSER_LANE_UNAVAILABLE: Firefox exited ${code}; ${stderr.slice(-2000)}`)));
      child.stderr.on('data', data => {
        stderr = (stderr + data).slice(-16000); trace('stderr', String(data));
        const url = /WebDriver BiDi listening on (ws:\/\/[^\s]+)/.exec(stderr)?.[1];
        if (url) finish(null, url);
      });
    });
    return { child, profile, endpoint, stop, cleanup, exit, get exited() { return exited; }, get stderr() { return stderr; } };
  } catch (error) { await stop(); throw error; }
}

export function remoteValue(value) {
  if (!value) return undefined;
  if (value.type === 'node' || value.type === 'window') return value;
  if (value.type === 'array') return (value.value ?? []).map(remoteValue);
  if (value.type === 'object') return Object.fromEntries((value.value ?? []).map(([key, item]) => [typeof key === 'string' ? key : remoteValue(key), remoteValue(item)]));
  if (value.type === 'null') return null;
  return value.value;
}
export function localValue(value) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array', value: value.map(localValue) };
  if (typeof value === 'object') return { type: 'object', value: Object.entries(value).map(([key, item]) => [key, localValue(item)]) };
  return { type: typeof value, ...(value === undefined ? {} : { value }) };
}
export function bidiUrl(value) {
  const text = String(value ?? '').trim();
  if (/^(?:https?|file):\/\//i.test(text) || text === 'about:blank' || /^data:/i.test(text)) return text;
  if (/^[\w-]+(\.[\w-]+)+(?::\d+)?(?:[/?#]\S*)?$/.test(text)) return `https://${text}`;
  fail('INVALID_ARGUMENTS', 'address requires a URL; use a search URL for search terms');
}
const SPECIAL_KEYS = { enter: '\uE007', tab: '\uE004', backspace: '\uE003', delete: '\uE017', escape: '\uE00C', esc: '\uE00C',
  left: '\uE012', up: '\uE013', right: '\uE014', down: '\uE015', home: '\uE011', end: '\uE010', pageup: '\uE00E', pagedown: '\uE00F', space: ' ' };
const MODIFIERS = { ctrl: '\uE009', control: '\uE009', shift: '\uE008', alt: '\uE00A', meta: '\uE03D', win: '\uE03D' };
export function keyActions(keys) {
  if (!Array.isArray(keys) || !keys.length) fail('INVALID_ARGUMENTS', 'keys must contain one non-modifier');
  const modifiers = [], ordinary = [];
  for (const key of keys) {
    if (typeof key !== 'string') fail('INVALID_ARGUMENTS', 'keys must be strings');
    const lower = key.toLowerCase();
    if (MODIFIERS[lower]) modifiers.push(MODIFIERS[lower]); else ordinary.push(key);
  }
  if (ordinary.length !== 1) fail('INVALID_ARGUMENTS', 'keys must contain one non-modifier');
  const lower = ordinary[0].toLowerCase();
  if (modifiers.includes(MODIFIERS.ctrl) && ['l', 't', 'n', 'w', 'r', 'tab'].includes(lower) || modifiers.includes(MODIFIERS.alt) || modifiers.includes(MODIFIERS.meta) || /^f\d+$/i.test(lower))
    fail('BROWSER_UI_SHORTCUT', 'browser chrome shortcuts are unavailable; use address/new-tab/close_window');
  const value = SPECIAL_KEYS[lower] ?? (Array.from(ordinary[0]).length === 1 ? ordinary[0] : null);
  if (!value) fail('INVALID_ARGUMENTS', 'unsupported key');
  return [...new Set(modifiers)].map(value => ({ type: 'keyDown', value })).concat([{ type: 'keyDown', value }, { type: 'keyUp', value }], [...new Set(modifiers)].reverse().map(value => ({ type: 'keyUp', value })));
}

export class BidiBrowserLane {
  constructor({ env = process.env, connection, executable, progId, trace = () => {} } = {}) {
    this.env = env; this.connection = connection; this.executable = executable; this.progId = progId; this.trace = trace;
    this.key = 'b' + randomBytes(8).toString('hex'); this.tabs = new Map(); this.contexts = new Map();
    this.nextId = 0; this.queue = Promise.resolve(); this.stopping = false; this.seriesActive = () => false;
    if (connection) this.listen(connection);
  }
  listen(connection) {
    connection.listeners.add(message => {
      const p = message.params ?? {}, tab = this.contexts.get(p.context);
      if (message.method === 'browsingContext.contextCreated' && p.parent == null && p.context) this.tabFor(p);
      if (!tab) return;
      if (message.method === 'browsingContext.contextDestroyed') { tab.closed = true; this.tabs.delete(tab.key); this.contexts.delete(p.context); }
      if (message.method === 'browsingContext.navigationStarted') { tab.ids.clear(); tab.byShared.clear(); tab.last = null; tab.url = p.url; }
      if (message.method === 'browsingContext.userPromptOpened') {
        tab.dialog = { type: p.type, message: p.message, ...(p.defaultValue !== undefined ? { defaultValue: p.defaultValue } : {}) };
        for (const wake of tab.promptWaiters) wake();
      }
      if (message.method === 'browsingContext.userPromptClosed') tab.dialog = null;
    });
  }
  async ensure(request) {
    check(request);
    if (this.stopping) fail('BROWSER_DISCONNECTED', 'lane is stopping');
    if (this.env.WCU_BROWSER_LANE === 'off') fail('BROWSER_LANE_UNAVAILABLE', 'browser lane is disabled');
    if (this.launching) { const connection = await this.launching; check(request); return connection; }
    if (this.connection?.closed) fail('BROWSER_DISCONNECTED', 'restart lane after disconnect; mutation replay is unsafe');
    if (this.connection) return this.connection;
    this.launching ??= (async () => {
      let endpoint = this.env.WCU_BROWSER_BIDI_URL;
      if (!endpoint) {
        this.executable ??= await discoverGecko(this.env, this.progId);
        if (!this.executable) fail('BROWSER_LANE_UNAVAILABLE', 'no registered Firefox-family application found; set WCU_BROWSER_EXE');
        // Always headless: a visible Gecko window that never takes the
        // foreground is not verified yet. Settings turn 显示浏览器窗口 off for
        // Firefox, and health and list_windows report visible:false.
        this.owned = await launchGecko({ executable: this.executable.path,
          root: this.env.WCU_BROWSER_PROFILE || path.join(this.env.LOCALAPPDATA || os.tmpdir(), 'dsh-computer-use-win', 'agent-browser'),
          headless: true, keep: this.env.WCU_BROWSER_SIGNIN === '1', trace: this.trace });
        endpoint = this.owned.endpoint;
      }
      try {
        const connection = await BidiConnection.open(endpoint, { trace: this.trace });
        this.connection = connection;
        await connection.send('session.new', { capabilities: { alwaysMatch: { unhandledPromptBehavior: { default: 'ignore' } } } });
        this.sessionOwned = true; this.listen(connection);
        await connection.send('session.subscribe', { events: ['browsingContext.contextCreated', 'browsingContext.contextDestroyed', 'browsingContext.navigationStarted', 'browsingContext.load', 'browsingContext.userPromptOpened', 'browsingContext.userPromptClosed'] });
        await this.refresh();
        return connection;
      } catch (error) {
        // A failed session.new can mean another client owns the single Gecko
        // session. Never end that client's session or close its browser.
        if (this.sessionOwned && this.connection && !this.connection.closed) await this.connection.send('session.end', {}, 3000).catch(() => {});
        this.sessionOwned = false; this.connection?.close(); this.connection = null;
        await this.owned?.stop(); this.owned = null; throw error;
      }
    })().finally(() => { this.launching = null; });
    const connection = await this.launching; check(request); return connection;
  }
  tabFor(info) {
    if (!info.context) fail('BROWSER_BIDI_CONTEXT', 'browser returned an invalid context; check content-process startup errors');
    let tab = this.contexts.get(info.context);
    if (!tab) {
      // 64 bits, as the Chromium lane's tab ids: unique across server runs, and
      // half the cost of 128 on every outline line that repeats the tab id.
      tab = { key: 't' + randomBytes(8).toString('hex'), context: info.context, ids: new Map(), byShared: new Map(), promptWaiters: new Set(), last: null, title: '', url: info.url ?? 'about:blank', dialog: null };
      this.tabs.set(tab.key, tab); this.contexts.set(tab.context, tab);
    }
    if (info.url !== undefined) tab.url = info.url;
    return tab;
  }
  idFor(tab, sharedId) {
    if (!sharedId) fail('BROWSER_PROTOCOL', 'DOM outline returned a node without sharedId');
    if (!tab.byShared.has(sharedId)) { const number = ++this.nextId; tab.byShared.set(sharedId, number); tab.ids.set(number, sharedId); }
    return `${tab.key}:${tab.byShared.get(sharedId)}`;
  }
  describe(tab) { return { id: tab.key, title: tab.title, url: tab.url, browser: this.key }; }
  async refresh() {
    const { contexts } = await this.connection.send('browsingContext.getTree', { maxDepth: 0 });
    if (contexts.some(info => !info.context)) fail('BROWSER_BIDI_CONTEXT', 'Firefox returned context=null; inspect content-process startup errors');
    for (const info of contexts) if (info.context) this.tabFor(info);
    const live = new Set(contexts.map(info => info.context));
    for (const tab of this.tabs.values()) if (!live.has(tab.context)) { this.tabs.delete(tab.key); this.contexts.delete(tab.context); }
  }
  async call(tab, fn, args = [], sharedId) {
    const result = await this.connection.send('script.callFunction', { functionDeclaration: fn.toString(), target: { context: tab.context, sandbox: 'dsh-bidi' },
      awaitPromise: false, arguments: args.map(localValue), ...(sharedId ? { this: { sharedId } } : {}), serializationOptions: { maxObjectDepth: 8, maxDomDepth: 0 } });
    if (result.type === 'exception') {
      const message = result.exceptionDetails?.text || 'script exception';
      throw new Error(message.includes('BROWSER_') || message.includes('INVALID_ARGUMENTS') ? message : `BROWSER_SCRIPT_ERROR: ${message}`);
    }
    return remoteValue(result.result);
  }
  async untilPrompt(tab, action) {
    let wake;
    const prompt = new Promise(resolve => { wake = () => resolve(undefined); tab.promptWaiters.add(wake); });
    try { return await Promise.race([Promise.resolve().then(action), prompt]); }
    finally { tab.promptWaiters.delete(wake); }
  }
  async outline(tab, maxNodes = 500) {
    const result = await this.call(tab, domOutline);
    tab.title = result.title; tab.url = result.url;
    const rows = result.entries.map(item => ({ id: this.idFor(tab, item.node.sharedId), role: item.role, name: item.name, value: item.value, states: item.states }));
    return { ...result, rows, lines: rows.slice(0, maxNodes).map(row => `[${row.id}] ${row.role} ${JSON.stringify(row.name.slice(0, 160))}${row.value ? ` value=${JSON.stringify(row.value.slice(0, 120))}` : ''}${row.states.length ? ` (${row.states.join(', ')})` : ''}`), truncated: result.truncated || rows.length > maxNodes };
  }
  page(tab, action, outline, detail = {}, full = false) {
    const header = `Tab [${tab.key}] ${JSON.stringify(tab.title)} ${tab.url}\n[${tab.key}:address] address`;
    let mode = 'full', lines = outline.lines;
    if (!full && tab.last) { mode = 'diff'; const before = new Set(tab.last), after = new Set(lines); lines = [...tab.last.filter(line => !after.has(line)).map(line => '- ' + line), ...lines.filter(line => !before.has(line)).map(line => '+ ' + line)]; }
    tab.last = outline.lines;
    return { meta: { ok: true, action, channel: 'browser', backend: 'bidi', background: true, tab: this.describe(tab), outlineSource: 'DOM heuristics', pageChange: mode,
      lines: outline.lines.length, truncated: outline.truncated, iframes: outline.iframes, ...detail }, text: header + '\n' + (lines.join('\n') || '(no outline changes)') };
  }
  run(action, args = {}, request) {
    const pending = this.queue.catch(() => {}).then(() => { check(request); return this.runPage(action, args, request); });
    this.queue = pending; return pending;
  }
  async runPage(action, args, request) {
    if (this.env.WCU_BROWSER_LANE === 'off') fail('BROWSER_LANE_UNAVAILABLE', 'browser lane is disabled');
    const conflict = ['windowTitle', 'processId', 'nativeWindowHandle', 'x', 'y'].filter(key => args[key] !== undefined);
    if (conflict.length) fail('INVALID_ARGUMENTS', `browser targets cannot combine with ${conflict.join(', ')}`);
    if (action === 'accessibility_tree') action = 'tree';
    if (action === 'invoke' && (args.action ?? 'default') !== 'default') fail('INVALID_ARGUMENTS', 'only default invoke is supported in a page');
    const match = /^(?:web:)?(t[0-9a-z]+):(\d+|address)$/.exec(args.elementId ?? '');
    const opener = /^(?:(b[0-9a-z]+):)?new-tab$/.exec(args.elementId ?? '');
    let tab, sharedId, detail = {};
    if (match && args.browserTab && args.browserTab !== match[1]) fail('INVALID_ARGUMENTS', 'elementId and browserTab disagree');
    if (opener) {
      if (action !== 'set_value') fail('INVALID_ARGUMENTS', 'new-tab requires set_value');
      if (opener[1] && opener[1] !== this.key) fail('BROWSER_TAB_NOT_FOUND', 'unknown browser');
      const url = bidiUrl(args.value); await this.ensure(request); check(request);
      tab = this.tabFor(await this.connection.send('browsingContext.create', { type: 'tab', background: true }));
      await this.untilPrompt(tab, () => this.connection.send('browsingContext.navigate', { context: tab.context, url, wait: 'interactive' }));
      detail.opened = this.describe(tab);
    } else {
      tab = this.tabs.get(match?.[1] ?? args.browserTab);
      if (!tab || tab.closed) fail('BROWSER_TAB_NOT_FOUND', 'read list_windows for current tab ids');
      if (!this.connection || this.connection.closed) fail('BROWSER_DISCONNECTED', 'BiDi session is unavailable');
      if (match && match[2] !== 'address') {
        sharedId = tab.ids.get(Number(match[2]));
        if (!sharedId) fail('BROWSER_ELEMENT_STALE', 'element is no longer in this document; read the page again');
      }
      if (match?.[2] === 'address' && action !== 'set_value') fail('INVALID_ARGUMENTS', 'address requires set_value');
      if (tab.dialog) return this.handleDialog(tab, action, args);
      const needsElement = ['click', 'double_click', 'move', 'invoke', 'focus', 'set_value', 'element_info'];
      if (needsElement.includes(action) && !match) fail('INVALID_ARGUMENTS', action + ' requires an element id');
      check(request);
      if (['tree', 'snapshot'].includes(action)) {
        const result = this.page(tab, action, await this.outline(tab, args.maxNodes ?? 500), {}, true);
        if (action === 'snapshot' && args.includeScreenshot) result.screenshot = await this.screenshot(tab, args.maxWidth);
        return result;
      }
      if (action === 'find') return this.find(tab, args);
      if (action === 'wait_for') return this.waitFor(tab, args, request);
      if (action === 'screenshot') return { meta: { ok: true, channel: 'browser', backend: 'bidi', action, tab: this.describe(tab) }, screenshot: await this.screenshot(tab, args.maxWidth) };
      if (action === 'element_info') return { meta: { ok: true, channel: 'browser', action, ...await this.call(tab, domElement, ['info'], sharedId) } };
      if (action === 'close_window') {
        await this.untilPrompt(tab, () => this.connection.send('browsingContext.close', { context: tab.context, promptUnload: true }));
        if (tab.dialog) return this.dialogResult(tab, action);
        this.tabs.delete(tab.key); this.contexts.delete(tab.context);
        return { meta: { ok: true, channel: 'browser', action, closed: true } };
      }
      await this.untilPrompt(tab, async () => {
        if (action === 'set_value' && match[2] === 'address') {
          const url = bidiUrl(args.value); tab.ids.clear(); tab.byShared.clear(); tab.last = null;
          await this.connection.send('browsingContext.navigate', { context: tab.context, url, wait: 'interactive' });
        } else if (['click', 'double_click', 'invoke', 'move'].includes(action)) {
          await this.call(tab, domElement, ['prepareClick'], sharedId); check(request);
          const button = ({ left: 0, middle: 1, right: 2 })[args.button ?? 'left'];
          if (button === undefined) fail('INVALID_ARGUMENTS', 'unknown mouse button');
          const actions = [{ type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: { sharedId } } }];
          if (action !== 'move') for (let i = 0; i < (action === 'double_click' ? 2 : 1); i++) actions.push({ type: 'pointerDown', button }, { type: 'pointerUp', button });
          await this.perform(tab, [{ type: 'pointer', id: 'dsh-pointer', parameters: { pointerType: 'mouse' }, actions }]);
        } else if (action === 'focus') await this.call(tab, domElement, ['focus'], sharedId);
        else if (action === 'set_value') { detail.verifyValue = await this.call(tab, domElement, ['set', args.value], sharedId); detail.inputMethod = 'DOM setter and synthetic events'; }
        else if (action === 'type_text') {
          if (typeof args.text !== 'string') fail('INVALID_ARGUMENTS', 'text must be a string');
          const focused = await this.call(tab, domFocused);
          const actions = Array.from(args.text).flatMap(value => [{ type: 'keyDown', value }, { type: 'keyUp', value }]);
          if (actions.length) await this.perform(tab, [{ type: 'key', id: 'dsh-keyboard', actions }]);
          if (!tab.dialog) detail.verifyValue = await this.call(tab, domElement, ['read'], focused.sharedId);
        } else if (action === 'keypress') await this.perform(tab, [{ type: 'key', id: 'dsh-keyboard', actions: keyActions(args.keys) }]);
        else if (action === 'scroll') {
          const dx = args.deltaX ?? 0, dy = args.deltaY ?? 480;
          if (![dx, dy].every(Number.isFinite)) fail('INVALID_ARGUMENTS', 'scroll deltas must be finite');
          if (sharedId) detail.elementScroll = await this.call(tab, domElement, ['scroll', [dx, dy]], sharedId);
          else detail.pageScroll = await this.call(tab, function (x, y) { const before = [scrollX, scrollY]; scrollBy({ left: x, top: y, behavior: 'instant' }); return { before, after: [scrollX, scrollY] }; }, [dx, dy]);
          detail.inputMethod = 'DOM scrollBy';
        } else fail('BROWSER_BIDI_UNSUPPORTED', action + ' is not supported by this prototype');
      });
    }
    if (tab.dialog) return this.dialogResult(tab, action, detail);
    check(request);
    // Bound settling, never infer task success from a successfully sent action.
    await delay(80); if (tab.dialog) return this.dialogResult(tab, action, detail);
    const outline = await this.outline(tab);
    if (detail.opened) detail.opened = this.describe(tab);
    return this.page(tab, action, outline, { verification: 'sent', verificationNote: 'Inspect resulting page state; DOM outline is heuristic.', ...detail }, Boolean(opener));
  }
  async perform(tab, actions) {
    try { await this.connection.send('input.performActions', { context: tab.context, actions }); }
    finally { await this.connection.send('input.releaseActions', { context: tab.context }, 3000).catch(() => {}); }
  }
  dialogResult(tab, action, detail = {}) { return { meta: { ok: true, channel: 'browser', backend: 'bidi', action, tab: this.describe(tab), dialog: tab.dialog, verification: 'sent', ...detail } }; }
  async handleDialog(tab, action, args) {
    if (action === 'type_text' && tab.dialog.type === 'prompt') { tab.dialog.text = args.text; return this.dialogResult(tab, action); }
    const key = args.keys?.length === 1 ? String(args.keys[0]).toLowerCase() : '';
    if (action !== 'keypress' || !['enter', 'escape', 'esc'].includes(key)) fail('BROWSER_DIALOG_OPEN', 'use keypress Enter/Escape; type_text sets a prompt response');
    const accept = key === 'enter', userText = tab.dialog.text ?? tab.dialog.defaultValue;
    await this.connection.send('browsingContext.handleUserPrompt', { context: tab.context, accept, ...(accept && userText !== undefined && tab.dialog.type === 'prompt' ? { userText } : {}) });
    tab.dialog = null; await delay(80);
    return this.page(tab, action, await this.outline(tab), { handledDialog: accept ? 'accepted' : 'dismissed' });
  }
  async find(tab, args) {
    if (typeof args.query !== 'string' || !args.query.trim()) fail('INVALID_ARGUMENTS', 'find requires query');
    const outline = await this.outline(tab, 10000), query = args.query.toLowerCase();
    const aliases = { edit: 'textbox', text: 'text', combobox: 'combobox', checkbox: 'checkbox', hyperlink: 'link' };
    const role = args.controlType ? (aliases[args.controlType.toLowerCase()] ?? args.controlType.toLowerCase()) : null;
    const results = outline.rows.filter(row => (!role || role === row.role) && `${row.name} ${row.value}`.toLowerCase().includes(query)).slice(0, args.maxResults ?? 50);
    return { meta: { ok: true, channel: 'browser', action: 'find', count: results.length, results, truncated: outline.truncated }, text: results.map(row => `[${row.id}] ${row.role} ${JSON.stringify(row.name)}`).join('\n') };
  }
  async waitFor(tab, args, request) {
    if (!['text', 'element'].includes(args.condition)) fail('INVALID_ARGUMENTS', 'wait_for condition must be text or element');
    if (!args.query?.trim()) fail('INVALID_ARGUMENTS', 'wait_for requires query');
    const start = Date.now(), timeoutMs = args.timeoutMs ?? 5000, intervalMs = args.intervalMs ?? 100, appear = args.appear ?? true;
    for (;;) {
      check(request); if (tab.dialog) fail('BROWSER_DIALOG_OPEN', 'handle prompt before waiting');
      const found = (await this.find(tab, { ...args, maxResults: 1 })).meta.count > 0;
      if (found === appear) return { meta: { ok: true, channel: 'browser', action: 'wait_for', verification: 'observed', elapsedMs: Date.now() - start } };
      if (Date.now() - start >= timeoutMs) return { meta: { ok: false, channel: 'browser', action: 'wait_for', verification: 'timeout', elapsedMs: Date.now() - start } };
      await delay(Math.max(10, intervalMs));
    }
  }
  async screenshot(tab, maxWidth = 1600) {
    const { data } = await this.connection.send('browsingContext.captureScreenshot', { context: tab.context, origin: 'viewport', format: { type: 'image/png' } });
    const png = Buffer.from(data, 'base64');
    if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail('BROWSER_PROTOCOL', 'invalid screenshot PNG');
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    return { base64: data, mimeType: 'image/png', width, height, note: `BiDi viewport; prototype does not resize${maxWidth && width > maxWidth ? ` (requested maxWidth ${maxWidth})` : ''}.` };
  }
  async annotateWindows(result) {
    if (this.env.WCU_BROWSER_LANE === 'off') return result;
    if (this.launching) await this.launching;
    if (this.env.WCU_BROWSER_BIDI_URL) await this.ensure();
    if (this.connection && !this.connection.closed) await this.refresh();
    result.browserLane = { browsers: this.connection && !this.connection.closed ? [{ id: this.key, name: this.executable?.name ?? 'Gecko', source: this.owned ? 'agent' : 'configured', backend: 'bidi',
      processId: this.owned?.child.pid, visible: this.owned ? false : null, newTab: `${this.key}:new-tab`, tabs: [...this.tabs.values()].map(tab => this.describe(tab)) }] : [],
      use: 'set_value elementId new-tab with URL opens a background Gecko tab. DOM outline is heuristic. The Firefox that the plugin starts is headless (no window); WCU_BROWSER_BIDI_URL connects an explicitly configured endpoint.' };
    for (const window of result.windows ?? []) if (this.owned?.child.pid && window.processId === this.owned.child.pid && window.className === 'MozillaWindowClass') window.browser = this.key;
    return result;
  }
  async health() {
    if (!this.env.WCU_BROWSER_BIDI_URL) this.executable ??= await discoverGecko(this.env, this.progId);
    return { enabled: this.env.WCU_BROWSER_LANE !== 'off', app: 'firefox', resolvedApp: 'firefox', backend: 'bidi', experimental: true,
      agentBrowser: this.executable?.path ?? null, configuredEndpoint: Boolean(this.env.WCU_BROWSER_BIDI_URL), visible: this.env.WCU_BROWSER_BIDI_URL ? null : false, keepSignIns: this.env.WCU_BROWSER_SIGNIN === '1',
      connected: this.connection && !this.connection.closed ? [{ id: this.key, source: this.owned ? 'agent' : 'configured' }] : [], limitations: ['automatic launch is headless only', 'DOM outline', 'one session per browser; no sharing or reconnect broker', 'no indicator', 'unscaled screenshots'] };
  }
  async shutdown() {
    this.stopping = true;
    if (this.launching) await this.launching.catch(() => {});
    if (this.connection && !this.connection.closed && this.owned) {
      // browser.close asks Gecko to flush cookies. Always restrict to our child.
      await this.connection.send('browser.close', {}, 3000).catch(() => {});
      await Promise.race([this.owned.exit, delay(1500)]);
    } else if (this.sessionOwned && this.connection && !this.connection.closed) {
      // The caller owns the configured browser and its tabs/profile. Release
      // only the session created here, so another client may connect later.
      await this.connection.send('session.end', {}, 3000).catch(() => {});
    }
    this.sessionOwned = false;
    this.connection?.close(); await this.owned?.stop();
  }
  close() { this.stopping = true; this.connection?.close(); if (this.owned && !this.owned.exited) this.owned.child.kill(); }
}
