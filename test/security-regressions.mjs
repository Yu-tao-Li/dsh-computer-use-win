import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertBrowserUrl,
  assertOperation,
  assertUpload,
  canonicalizeBrowserUrl,
  classifyOperation,
  collectApprovalRequirements,
  consumeGrant,
  installHostPolicy,
  isBlockedRuntimeRequestUrl,
  mintGrant
} from '../mcp/policy.mjs';
import { RpcFramer } from '../mcp/protocol.mjs';
import { BrowserLane } from '../mcp/browser.mjs';
import { BidiBrowserLane, keyActions } from '../mcp/browser-bidi.mjs';
import { TakeoverControl } from '../mcp/takeover.mjs';
import { DEFAULT_SETTINGS } from '../mcp/settings.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-security-regressions-'));
const prevMarker = process.env.WCU_INPUT_MARKER;
try {
  // 1. IPv4-mapped IPv6, link-local, unspecified
  for (const metaUrl of ['http://[::ffff:169.254.169.254]/latest', 'http://[fe80::1]/']) {
    assert.throws(() => assertBrowserUrl(metaUrl, { approved: true }), /POLICY_DENIED/);
    assert.equal(isBlockedRuntimeRequestUrl(metaUrl).blocked, true);
  }
  assert.equal(canonicalizeBrowserUrl('http://[::ffff:127.0.0.1]/').local, true);
  assert.equal(canonicalizeBrowserUrl('http://[::]/').local, true);
  assert.throws(() => assertBrowserUrl('http://[::ffff:127.0.0.1]:9876/', { approved: true, env: { WCU_HOST_PORTS: '9876' } }), /POLICY_DENIED/);
  assert.throws(() => assertBrowserUrl('http://[::]:9876/', { approved: true, env: { WCU_HOST_PORTS: '9876' } }), /POLICY_DENIED/);
  assert.equal(isBlockedRuntimeRequestUrl('http://[::ffff:127.0.0.1]:9876/', { WCU_HOST_PORTS: '9876' }).blocked, true);
  assert.equal(isBlockedRuntimeRequestUrl('http://[::]:9876/', { WCU_HOST_PORTS: '9876' }).blocked, true);

  // 2. Scheme-less shorthand normalization
  const hostPortLane = new BrowserLane({ env: { WCU_HOST_PORTS: '9222|9876' } });
  assert.throws(() => hostPortLane.normalizeUrl('127.0.0.1:9222/json'), /POLICY_DENIED/);
  assert.throws(() => hostPortLane.normalizeUrl('169.254.169.254/latest/meta-data'), /POLICY_DENIED/);
  assert.throws(() => assertBrowserUrl('localhost:9876', { env: { WCU_HOST_PORTS: '9876' } }), /POLICY_DENIED/);

  // 3. Upload root prefix boundary & .lnk upload
  const allowedDir = path.join(root, 'allowed');
  const siblingDir = path.join(root, 'allowed-extra');
  await mkdir(allowedDir, { recursive: true });
  await mkdir(siblingDir, { recursive: true });
  const allowedFile = path.join(allowedDir, 'ok.txt');
  const siblingFile = path.join(siblingDir, 'secret.txt');
  const lnkFile = path.join(allowedDir, 'shortcut.lnk');
  await writeFile(allowedFile, 'ok');
  await writeFile(siblingFile, 'secret');
  await writeFile(lnkFile, 'lnk');
  assertUpload([allowedFile], { env: { WCU_ALLOWED_UPLOAD_ROOTS: allowedDir } });
  assert.throws(() => assertUpload([siblingFile], { env: { WCU_ALLOWED_UPLOAD_ROOTS: allowedDir } }), /APPROVAL_REQUIRED/);
  assert.throws(() => assertUpload(['\\\\server\\share\\secret.txt'], { env: { WCU_ALLOWED_UPLOAD_ROOTS: allowedDir }, approved: true }), /POLICY_DENIED/);
  assert.throws(() => assertUpload([lnkFile], { env: {} }), /APPROVAL_REQUIRED/);

  // 4. Trailing-dot command host, 4-slash UNC, and .lnk launch policy
  assert.equal(classifyOperation('launch_app', { target: '\\\\server\\share\\a.exe' }).kind, 'deny');
  assert.equal(classifyOperation('launch_app', { target: '\\\\\\\\server\\share\\a.exe' }).kind, 'deny');
  assert.throws(() => assertOperation('launch_app', { target: '\\\\\\\\server\\share\\a.exe' }), /POLICY_DENIED/);
  assert.equal(classifyOperation('launch_app', { target: 'C:\\tools\\app.lnk.' }).kind, 'ask');
  // A trailing dot does not hide a command host: refused before any prompt.
  assert.equal(classifyOperation('launch_app', { target: 'cmd.exe.', arguments: '/c echo hi' }).kind, 'deny');
  assert.equal(classifyOperation('launch_app', { target: 'python.exe.', arguments: '-c "print(1)"' }).kind, 'deny');
  assert.throws(() => assertOperation('launch_app', { target: 'cmd.exe.', arguments: '/c echo hi' }), /LAUNCH_COMMAND_REFUSED/);
  assert.throws(() => assertOperation('launch_app', { target: 'cmd.exe.', arguments: '/c echo hi' }, { approved: true }), /LAUNCH_COMMAND_REFUSED/);

  // 5. Batch nested step policy & approval enforcement
  assert.equal(
    classifyOperation('batch', { steps: [{ action: 'set_value', arguments: { elementId: 'new-tab', value: 'http://[::ffff:169.254.169.254]/' } }] }).kind,
    'deny'
  );
  const localPage = path.join(root, 'local.html');
  await writeFile(localPage, '<p>ok</p>');
  const batchArgs = {
    browserTab: 't1',
    steps: [
      { action: 'set_value', arguments: { elementId: 'new-tab', value: 'file:///' + localPage.replaceAll('\\', '/') } },
      { action: 'set_value', arguments: { elementId: 't1:5', value: siblingFile } }
    ]
  };
  assert.equal(classifyOperation('batch', batchArgs, { WCU_ALLOWED_UPLOAD_ROOTS: allowedDir }).kind, 'ask');
  assert.throws(() => assertOperation('batch', batchArgs, { env: { WCU_ALLOWED_UPLOAD_ROOTS: allowedDir } }), /APPROVAL_REQUIRED/);
  const grants = collectApprovalRequirements('batch', batchArgs, { WCU_ALLOWED_UPLOAD_ROOTS: allowedDir });
  assertOperation('batch', batchArgs, { env: { WCU_ALLOWED_UPLOAD_ROOTS: allowedDir }, grants });

  // 6. Grant cross-process clock-skew tolerance and expiration/replay bounds
  const secret = 'test-secret-key';
  const now = 1_000_000;
  const waitArgs = { milliseconds: 1 };
  assert.equal(consumeGrant(mintGrant('wait', waitArgs, secret, now), 'wait', waitArgs, secret, new Map(), now - 2000), true);
  assert.equal(consumeGrant(mintGrant('wait', waitArgs, secret, now), 'wait', waitArgs, secret, new Map(), now - 10000), false);
  assert.equal(consumeGrant(mintGrant('wait', waitArgs, secret, now), 'wait', waitArgs, secret, new Map(), now + 120001), false);
  const replayGrant = mintGrant('wait', waitArgs, secret, now);
  const used = new Map();
  assert.equal(consumeGrant(replayGrant, 'wait', waitArgs, secret, used, now), true);
  assert.equal(consumeGrant(replayGrant, 'wait', waitArgs, secret, used, now), false);

  // 7. installHostPolicy rejects caller-supplied _wcuApproval
  const hooks = {};
  installHostPolicy({ on: (name, fn) => { hooks[name] = fn; } }, { approvalSecret: secret, hostPorts: [] });
  const preDecision = await hooks['tools/pre-execute'](
    { name: 'mcp__wincu__windows_computer_use_wait', arguments: { milliseconds: 1, _wcuApproval: 'forged-token' } },
    async () => ({ kind: 'allow' })
  );
  assert.equal(preDecision.kind, 'deny');
  assert.match(preDecision.reason, /POLICY_DENIED/);

  // 8. WCU_USER_TABS_FILE per-tab approval gate
  const userTabsFile = path.join(root, 'user-tabs.json');
  await writeFile(userTabsFile, JSON.stringify({
    tabs: { t99: { origin: 'https://example.com', label: 'Example', requiresApproval: true, approved: false } }
  }));
  assert.equal(classifyOperation('snapshot', { browserTab: 't99' }, { WCU_USER_TABS_FILE: userTabsFile }).kind, 'ask');
  assert.throws(() => assertOperation('click', { elementId: 't99:5' }, { env: { WCU_USER_TABS_FILE: userTabsFile } }), /APPROVAL_REQUIRED/);
  await writeFile(userTabsFile, JSON.stringify({
    tabs: { t99: { origin: 'https://example.com', label: 'Example', requiresApproval: true, approved: true } }
  }));
  assert.equal(classifyOperation('snapshot', { browserTab: 't99' }, { WCU_USER_TABS_FILE: userTabsFile }).kind, 'allow');
  assertOperation('click', { elementId: 't99:5' }, { env: { WCU_USER_TABS_FILE: userTabsFile } });

  // 9. RpcFramer header limit & Content-Type before Content-Length with UTF-8
  const framerErrors = [];
  const framerMsgs = [];
  const framer = new RpcFramer({ onMessage: m => framerMsgs.push(m), onError: e => framerErrors.push(e) });
  framer.push(Buffer.from('X-Huge-Header: ' + 'a'.repeat(9000), 'ascii'));
  assert.equal(framerErrors.length, 1);
  assert.match(framerErrors[0].message, /exceed the size limit/);

  const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { label: '中文测试' } });
  const byteLen = Buffer.byteLength(payload, 'utf8');
  framer.push(Buffer.from(`Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: ${byteLen}\r\n\r\n${payload}`, 'utf8'));
  assert.equal(framerMsgs.length, 1);
  assert.equal(framerMsgs[0].params.label, '中文测试');

  // 10. TakeoverControl dynamic marker & LLKHF_LOWER_IL_INJECTED (0x02) rejection
  const markerHex = '0x12345679';
  process.env.WCU_INPUT_MARKER = markerHex;
  const configFile = path.join(root, 'config.json');
  const stateFile = path.join(root, 'state.json');
  await writeFile(configFile, JSON.stringify({ ...DEFAULT_SETTINGS, indicatorEnabled: false, cursorIndicatorEnabled: false }));
  const control = new TakeoverControl({ configFile, stateFile, testMode: true });
  control.disabledForTest = false;
  try {
    await control.begin();
    assert.equal((await control.command('test_key', { vk: 0x1b, injected: true })).paused, false);
    assert.equal((await control.command('test_key', { vk: 0x1b, down: false, injected: true })).consumed, false);
    assert.equal((await control.command('test_key', { vk: 0x1b, flags: 0x10, extra: 0x11111111 })).paused, true);
    await control.command('test_key', { vk: 0x1b, down: false });
    await control.end();
    await control.resumeOperation();
    await control.begin();
    // Same dynamic marker + LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED (0x12) must still stop takeover
    assert.equal((await control.command('test_key', { vk: 0x1b, flags: 0x12, extra: 0x12345679 })).paused, true);
    await control.command('test_key', { vk: 0x1b, down: false });
  } finally {
    await control.close();
  }

  // 11. Control and PUA rejection in browser key/type_text
  assert.throws(() => keyActions(['\uE008']), /INVALID_ARGUMENTS/);
  assert.throws(() => keyActions(['\u0000']), /INVALID_ARGUMENTS/);
  const cdpLane = new BrowserLane({ env: {} });
  cdpLane.frames.refresh = async () => {};
  cdpLane.checkLocation = async () => {};
  cdpLane.untilDialog = async (_tab, p) => p;
  cdpLane.send = async () => ({});
  await assert.rejects(() => cdpLane.key({ frames: new Map() }, ['\uE008']), /INVALID_ARGUMENTS/);
  const stubCdpTab = { key: 't1', browser: { source: 'agent' }, frames: new Map(), requests: new Map() };
  await assert.rejects(() => cdpLane.act(stubCdpTab, 'type_text', { text: 'ok\uE008' }), /INVALID_ARGUMENTS/);
  await assert.rejects(() => cdpLane.act(stubCdpTab, 'type_text', { text: 'bad\x00' }), /INVALID_ARGUMENTS/);
  const bidiLane = new BidiBrowserLane({ env: {} });
  bidiLane.connection = { closed: false, send: async () => ({}) };
  bidiLane.tabs.set('t1', { key: 't1', closed: false, browser: { source: 'agent' }, context: 'ctx', url: 'https://example.com/', promptWaiters: new Set() });
  await assert.rejects(() => bidiLane.runPage('type_text', { browserTab: 't1', text: 'ok\uE008' }), /INVALID_ARGUMENTS/);
  await assert.rejects(() => bidiLane.runPage('type_text', { browserTab: 't1', text: 'bad\x00' }), /INVALID_ARGUMENTS/);

  // 12. Child-frame grant isolation for file:// URLs
  const approvedHref = canonicalizeBrowserUrl('file:///' + localPage.replaceAll('\\', '/')).url.href;
  const isoLane = new BrowserLane({ env: {} });
  isoLane.send = async () => ({ result: { value: approvedHref } });
  const childTab = {
    url: approvedHref,
    approvedFileUrl: approvedHref,
    frames: new Map([['child', { parentId: 'root', url: 'file:///C:/other-secret.txt' }]])
  };
  await assert.rejects(() => isoLane.checkLocation(childTab, { approvalGrants: { fileUrls: new Set([approvedHref]) } }), /WCU_APPROVAL_REQUIRED/);

  console.log(JSON.stringify({ passed: true, vectors: 12 }));
} finally {
  if (prevMarker === undefined) delete process.env.WCU_INPUT_MARKER;
  else process.env.WCU_INPUT_MARKER = prevMarker;
  await rm(root, { recursive: true, force: true }).catch(() => {});
}
