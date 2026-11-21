// Problem reports: redaction, the call log, the text file, the two windows it
// opens, the route. No desktop input; the export runs on given facts in a
// temporary folder, and the windows are recorded, not opened.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ISSUE_URL, createDiagnosticsHandler, describeArgs, diagnosticsText, environmentSummary, exportDiagnostics,
  installCallLog, makeRedactor, pluginLogLines, readInstallSpec, revealAndOpen, trustedRequest,
} from '../mcp/diagnostics.mjs';

// Absolute paths, credential headers and direct identifiers are redacted.
const redact = makeRedactor({ user: 'Alice', host: 'DESK-42', secrets: ['approval-secret-123456'] });
assert.equal(redact('"C:\\Users\\Alice\\AppData\\x.log" "c:/users/alice/y" "C:\\Users\\ALICE~1\\Temp\\z"'), '"<path>" "<path>" "<path>"');
assert.equal(redact('ENOENT: D:\\Private projects\\name\\notes.txt\nRead \\'+ '\\server\\shared folder\\secret.txt'), 'ENOENT: <path>\nRead <path>');
assert.equal(redact('Cookie: sid=SAMPLE-1; session=SAMPLE-2\nSet-Cookie: key=SAMPLE-3; SameSite=Lax\nProxy-Authorization: Basic SAMPLE-4'), 'Cookie: <secret>\nSet-Cookie: <secret>\nProxy-Authorization: <secret>');
assert.deepEqual(JSON.parse(redact('{"Cookie":"sid=SAMPLE-1; session=SAMPLE-2","status":403}')), {Cookie:'<secret>',status:403});
const sensitiveLogs = [
  JSON.stringify({ headers: { 'Set-Cookie': ['sid=fixture-private-array', 'session=fixture-private-array2'] }, status: 403 }),
  JSON.stringify({ message: JSON.stringify({ Authorization: { value: 'fixture-private-nested' } }) }),
  JSON.stringify({ headers: [['Cookie', 'sid=fixture-private-pair'], ['Accept', 'text/plain']] }),
  JSON.stringify({ headers: [{ name: 'Proxy-Authorization', value: 'fixture-private-header-object' }] }),
  JSON.stringify({ password: ['fixture-private-multiline'] }, null, 2),
  'Authorization: Basic fold\r\n  fixture-private-header-folded',
  String.raw`wincu: {"message":"Read D:\u005cPrivate folder\u005cfixture-private-path.txt"}`,
  String.raw`wincu: {"message":"Read D:\/Private folder\/fixture-private-slash.txt"}`,
  JSON.stringify({ token: 'fixture-private-bare-token' }),
  JSON.stringify({ auth: { idToken: 'fixture-private-id-token', csrftoken: 'fixture-private-csrf' } }),
  'wincu: request failed for key sk-fixture-private-0123456789abcdef',
];
for (const line of sensitiveLogs) assert.doesNotMatch(redact(line), /fixture-private/);
// Counts and ordinary words that merely contain "token" or "sk-" stay readable.
assert.equal(redact('{"maxTokens":4096,"tokenCount":12} Unexpected token } task-abcdefghijklmnopqrstu'), '{"maxTokens":4096,"tokenCount":12} Unexpected token } task-abcdefghijklmnopqrstu');
assert.equal(redact('Alice on DESK-42; Malice and Alice2 stay'), '<user> on <computer>; Malice and Alice2 stay');
assert.equal(redact('token approval-secret-123456 end'), 'token <secret> end');
assert.equal(redact('https://example.test/private?q=123 alice@example.test Bearer abc.123 api_key="private data"'), '<url> <email> <secret> api_key=<secret>');
assert.equal(makeRedactor({ user: 'li', host: '' })('li liang'), 'li liang', 'Names shorter than three characters are left alone');

// A call's shape, never what it typed.
assert.deepEqual(describeArgs({ text: '我的密码是 hunter2', elementId: 'uia:rt:42', x: 10, submit: true, title: 'Secret chat' }),
  { text: '<13 chars>', elementId: 'uia:rt:42', x: 10, submit: true, title: '<11 chars>' });
assert.deepEqual(describeArgs('{"steps":[{"action":"type_text","arguments":{"text":"abc"}}],"browserTab":"t1a2b"}'),
  { steps: [{ action: 'type_text', arguments: { text: '<3 chars>' } }], browserTab: 't1a2b' });
assert.deepEqual(describeArgs({ keys: ['ctrl', 'v'] }), { keys: '<2 items>' });
assert.deepEqual(describeArgs({ unexpectedText: 'private', nested: { clipboardText: 'too' } }), { unexpectedText: '<7 chars>', nested: { clipboardText: '<3 chars>' } });

// The call log keeps desktop calls only, the last thirty, errors redacted.
const handlers = [];
const fakeCtx = { on: (name, handler) => { assert.equal(name, 'tools/execute'); handlers.push(handler); } };
const log = installCallLog(fakeCtx, { redact });
assert.equal(handlers.length, 1);
const execute = (name, args, result, error) => handlers[0]({ name, arguments: args }, async () => { if (error) throw error; return result; });
assert.deepEqual(await execute('bash', {}, { ok: 1 }), { ok: 1 });
assert.equal(log.list().length, 0, 'Other tools are not recorded');
await execute('mcp__wincu__windows_computer_use_click', { elementId: 'uia:rt:1' }, { isError: true, content: [{ type: 'text', text: 'Error: denied at C:\\Users\\Alice\\file' }] });
await assert.rejects(execute('windows_computer_use_type_text', { text: 'hello' }, null, new Error('COMPUTER_USE_STOPPED by Alice')));
let [first, second] = log.list();
assert.deepEqual([first.tool, first.ok, first.error, first.args], ['click', false, 'Error: denied at <path>', { elementId: 'uia:rt:1' }]);
assert.deepEqual([second.tool, second.ok, second.error, second.args], ['type_text', false, 'COMPUTER_USE_STOPPED by <user>', { text: '<5 chars>' }]);
for (let i = 0; i < 31; i++) await execute('windows_computer_use_screenshot', {}, { content: [] });
assert.equal(log.list().length, 30, 'Only the last thirty calls stay');
assert.ok(log.list().every(call => call.tool === 'screenshot' && call.ok && Number.isFinite(call.ms)));

// The environment block at the top of the file.
const facts = {
  version: '0.6.1', installSpec: 'file:C:/Users/Alice/x.tgz', host: 'DSH Desktop (profile desktop)', mcpClient: '0.2.1-rc.2', node: '24.15.0', electron: '44.0.0',
  windows: { product: 'Windows 11 Pro', display: '25H2', build: '26200', ubr: 8655 }, powershell: '5.1.26100.8655', pwsh: false,
  screens: [{ primary: true, bounds: '2560x1440@0,0' }], systemDpi: 144, culture: 'zh-CN', uiCulture: 'zh-CN', dshLocale: 'zh-CN',
  browsers: { edge: '157.0.4341.60' }, defaultBrowser: 'MSEdgeHTM', compatLayer: 'RunAsInvoker',
  settings: { toolPreset: 'full', browserApp: 'default', browserVisible: true, browserSignIn: false, browserAttachUser: false, progressOverlayEnabled: true },
  selfTest: { ok: true, backend: { powershell: '5.1.26100.8655', uiAutomation: true }, inputDesktopAvailable: true },
};
const summary = environmentSummary(facts);
assert.match(summary, /Windows 11 Pro 25H2 build 26200\.8655/);
assert.match(summary, /__COMPAT_LAYER: RunAsInvoker/);
assert.equal(ISSUE_URL, 'https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/new', 'The plain new-issue page');

// The file is plain text: sections in order, one call per line, no Markdown.
const text = diagnosticsText(facts, { calls: [{ at: 't', tool: 'find', ms: 5, ok: false, error: 'a | b\nsecond line', args: { query: '<3 chars>' } }], logs: ['l1'] });
const headings = ['== 环境 / Environment ==', '== 设置 / Settings ==', '== 自检 / Self-test ==', '== 最近的电脑操控调用 / Recent computer-use calls (1) ==', '== DSH 日志里和本插件相关的行 / Plugin lines in the DSH log (1) =='];
assert.deepEqual(headings.map(heading => text.indexOf(heading)).every((at, i, all) => at > 0 && (i === 0 || at > all[i - 1])), true, 'Every section, in order');
assert.ok(text.split('\n').includes('t  find  5 ms  error: a | b second line  {"query":"<3 chars>"}'), 'One call per line');
assert.ok(!/```|^#|^\|/m.test(text), 'No Markdown fences, headings or tables');

const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-diagnostics-'));
try {
  // The export writes one .txt file (BOM, CRLF) and redacts it as a whole.
  const out = path.join(root, 'Downloads');
  const env = { ...process.env, WCU_APPROVAL_SECRET: 'approval-secret-abcdef', __COMPAT_LAYER: 'RunAsInvoker' };
  const result = await exportDiagnostics({
    bridge: { state: 'reconnecting', configuredToolCount: 26, registeredToolCount: 0, lastError: JSON.stringify({ Authorization: ['fixture-private-bridge'] }), peerMismatches: [{ name: 'dsh-tools', expected: '0.2.2-rc.5', actual: '0.2.2-rc.3' }] },
    version: '0.6.1', settings: { ...facts.settings, indicatorText: 'DSH 正在控制电脑', unknownField: 'private' }, calls: log.list().slice(-2), host: 'DSH Desktop', mcpClient: facts.mcpClient, dshLocale: 'zh-CN',
    installSpec: `file:${os.homedir()}\\x.tgz`, env, outDir: out, at: new Date(2026, 10, 18, 2, 3, 4),
    selfTest: { ok: true, backend: { powershell: '5.1', error: 'Read failed: D:\\Private project\\record.txt' } }, facts: { system: { windows: facts.windows, powershell: '5.1', screens: facts.screens, desktopVersions: ['2.0.18'] }, browsers: facts.browsers, logs: [`dsh.log: windows-computer-use ready at ${os.homedir()}\\a approval-secret-abcdef`, 'wincu: Cookie: first=fixture-private-a; second=fixture-private-b', ...sensitiveLogs] },
  });
  assert.equal(result.fileName, 'wincu-diagnostics-20261118-020304.txt');
  assert.equal(path.dirname(result.file), out);
  const saved = await readFile(result.file, 'utf8');
  assert.equal(saved.charCodeAt(0), 0xfeff, 'A BOM, so Notepad reads the Chinese right');
  assert.ok(!/(?<!\r)\n/.test(saved), 'CRLF line ends only');
  assert.ok(!saved.includes(os.homedir()), 'No home path in the file');
  assert.ok(!saved.includes('approval-secret-abcdef'), 'No secret in the file');
  assert.ok(!/fixture-private|Private project|record\.txt/.test(saved), 'Secondary cookie values and paths are absent from the full TXT');
  assert.ok(saved.includes('"indicatorText": "<10 chars>"'), 'The banner text is kept as a length');
  assert.ok(saved.includes('__COMPAT_LAYER: RunAsInvoker'));
  assert.ok(saved.includes('Windows: Windows 11 Pro 25H2'));
  assert.ok(saved.includes('DSH Desktop 2.0.18'));
  assert.ok(saved.includes('0.6.1 (local)'));
  assert.match(saved, /Host MCP registration[\s\S]+"state": "reconnecting"[\s\S]+"registeredToolCount": 0[\s\S]+"dsh-tools"[\s\S]+Self-test/);
  assert.ok(!saved.includes('unknownField') && !saved.includes('x.tgz'));

  const concurrent = await Promise.all([1, 2].map(() => exportDiagnostics({
    outDir: out, at: new Date(2026, 10, 18, 2, 3, 4),
    facts: { system: {}, browsers: {}, logs: [] },
    saveAs: () => assert.fail('An existing file should not open Save As'),
  })));
  assert.deepEqual(concurrent.map(report => report.fileName).sort(), [
    'wincu-diagnostics-20261118-020304-2.txt', 'wincu-diagnostics-20261118-020304-3.txt',
  ]);
  assert.equal(await readFile(result.file, 'utf8'), saved);

  // Explorer selects the TXT. The browser launcher reports ShellExecute's
  // result rather than treating the helper process starting as success.
  const runs = [];
  const shown = await revealAndOpen(result, (command, args, options) => { runs.push([path.basename(command).toLowerCase(),args,options]); return true; });
  if (process.platform === 'win32') {
    assert.deepEqual(shown, { folderOpened: true, issueOpened: true });
    assert.equal(runs.length,2);
    assert.deepEqual(runs[0], ['explorer.exe', ['/select,', result.file], undefined]);
    assert.equal(runs[1][0], 'powershell.exe');
    assert.deepEqual(runs[1][1].slice(0,3), ['-NoProfile', '-NonInteractive', '-Command']);
    assert.ok(runs[1][1][3].includes(ISSUE_URL) && runs[1][1][3].includes('UseShellExecute=$true'));
    assert.deepEqual(runs[1][2], {waitForExit:true});
    assert.deepEqual(await revealAndOpen(result, cmd => !cmd.endsWith('explorer.exe')), { folderOpened: false, issueOpened: true });
    assert.deepEqual(await revealAndOpen(result, cmd => !cmd.endsWith('powershell.exe')), { folderOpened: true, issueOpened: false });
  } else assert.deepEqual([shown, runs], [{ folderOpened: false, issueOpened: false }, []]);

  // The profile that lists the plugin is found from pnpm's nested folder.
  const profile = path.join(root, 'profile'), nested = path.join(profile, 'node_modules', '.pnpm', 'dsh-computer-use-win@file+x', 'node_modules', 'dsh-computer-use-win');
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ dependencies: { 'dsh-computer-use-win': '0.6.1' } }));
  await writeFile(path.join(nested, 'package.json'), JSON.stringify({ name: 'dsh-computer-use-win' }));
  assert.equal(readInstallSpec(nested), '0.6.1');

  // DSH log lines: only the plugin's, newest files last, a line DSH wrote to
  // both its main and its error log only once.
  const logs = path.join(root, 'logs');
  await mkdir(logs);
  await writeFile(path.join(logs, 'dsh-2026-11-18.error.log'), 'windows-computer-use MCP server 0.6.1 ready\n');
  await new Promise(resolve => setTimeout(resolve, 20));
  await writeFile(path.join(logs, 'dsh-2026-11-18.log'), 'other line\nwindows-computer-use MCP server 0.6.1 ready\nwincu: second\nanother\n');
  assert.deepEqual(pluginLogLines([logs]), ['logs/dsh-2026-11-18.error.log: windows-computer-use MCP server 0.6.1 ready', 'logs/dsh-2026-11-18.log: wincu: second']);

  // Settings in the file: no button tokens, and a tool list only for a custom preset.
  const second = await exportDiagnostics({ version: '0.6.1', settings: { toolPreset: 'full', enabledTools: ['click'], previewToken: 5, progressPreviewToken: 6 }, env, outDir: out, at: new Date(2026, 10, 18, 2, 3, 5), selfTest: { ok: true }, facts: { system: {}, browsers: {}, logs: [] } });
  const secondText = await readFile(second.file, 'utf8');
  assert.ok(!/Token|enabledTools/.test(secondText), 'Tokens and an unused tool list stay out');
  const custom = await exportDiagnostics({ version: '0.6.1', settings: { toolPreset: 'custom', enabledTools: ['click'] }, env, outDir: out, at: new Date(2026, 10, 18, 2, 3, 6), selfTest: { ok: true }, facts: { system: {}, browsers: {}, logs: [] } });
  assert.ok((await readFile(custom.file, 'utf8')).includes('"enabledTools"'), 'A custom tool list is kept');

  // A file where a directory should be makes automatic saving fail without
  // depending on the test runner's permissions or touching its Downloads.
  const rejectedFolder = path.join(root, 'blocked');
  const chosenFile = path.join(root, '用户选择.txt');
  await writeFile(rejectedFolder, 'unchanged');
  const fallbackOptions = { version: '0.6.1', dshLocale: 'zh-CN', outDir: rejectedFolder, facts: { system: {}, browsers: {}, logs: [] } };
  let shownSaveAs = 0;
  const savedAs = await exportDiagnostics({ ...fallbackOptions, saveAs: async ({ fileName, contents, dshLocale }) => {
    shownSaveAs++;
    assert.match(fileName, /^wincu-diagnostics-.*\.txt$/);
    assert.equal(dshLocale, 'zh-CN');
    await writeFile(chosenFile, contents, 'utf8');
    return chosenFile;
  } });
  assert.deepEqual(savedAs, { file: chosenFile, fileName: '用户选择.txt' });
  assert.equal(shownSaveAs, 1);
  assert.equal(await readFile(rejectedFolder, 'utf8'), 'unchanged');
  assert.equal((await readFile(chosenFile, 'utf8')).charCodeAt(0), 0xfeff);
  assert.deepEqual(await exportDiagnostics({ ...fallbackOptions, saveAs: () => null }), { cancelled: true });
} finally {
  await rm(root, { recursive: true, force: true });
}

// The route answers only the DSH page itself.
const page = { host: '127.0.0.1:43120', origin: 'http://127.0.0.1:43120', 'x-wcu-request': '1', 'sec-fetch-site': 'same-origin' };
assert.equal(trustedRequest({ headers: page }), true);
assert.equal(trustedRequest({ headers: { ...page, 'x-wcu-request': undefined } }), false, 'Our header is required');
assert.equal(trustedRequest({ headers: { ...page, 'sec-fetch-site': 'cross-site' } }), false);
assert.equal(trustedRequest({ headers: { ...page, origin: 'https://evil.example' } }), false);
assert.equal(trustedRequest({ headers: { ...page, host: 'evil.example' } }), false, 'DNS rebinding');
assert.equal(trustedRequest({ headers: { 'x-wcu-request': '1' } }), true, 'A proxy that strips Host and Origin');
assert.equal(trustedRequest({ headers: { host:'LOCALHOST:80',origin:'http://localhost','x-wcu-request':'1' } }), true);
assert.equal(trustedRequest({ headers: { origin:'http://localhost','x-wcu-request':'1' } }), false);

const response = () => { const r = { status: 0, headers: {}, body: '' }; r.writeHead = (status, headers) => { r.status = status; r.headers = headers ?? {}; }; r.end = body => { r.body = body ?? ''; }; return r; };
let collected = 0, opened = [];
const handler = createDiagnosticsHandler({ collect: async () => { collected++; await new Promise(resolve => setTimeout(resolve, 30)); return { file: 'C:/x/wincu.txt', fileName: 'wincu.txt' }; }, open: result => { opened.push(result.fileName); return { folderOpened: true, issueOpened: true }; } });
let r = response(); await handler({ method: 'GET', headers: page }, r); assert.equal(r.status, 405);
r = response(); await handler({ method: 'POST', headers: { ...page, 'x-wcu-request': undefined } }, r); assert.equal(r.status, 403); assert.equal(collected, 0);
const [a, b] = [response(), response()];
await Promise.all([handler({ method: 'POST', headers: page }, a), handler({ method: 'POST', headers: page }, b)]);
assert.deepEqual([a.status, b.status].sort(), [200, 409], 'One export at a time');
const ok = JSON.parse([a, b].find(x => x.status === 200).body);
assert.deepEqual(ok, { ok: true, fileName: 'wincu.txt', filePath: 'C:/x/wincu.txt', folderOpened: true, issueOpened: true });
assert.deepEqual(opened, ['wincu.txt']);
const failing = createDiagnosticsHandler({ collect: async () => { throw new Error('disk full at C:\\Users\\Alice'); }, open: ({ file }) => { assert.equal(file, undefined); return { folderOpened: false, issueOpened: true }; } });
r = response(); await failing({ method: 'POST', headers: page }, r);
assert.equal(r.status, 500); assert.deepEqual(JSON.parse(r.body), { ok: false, folderOpened: false, issueOpened: true });
const cancelled = createDiagnosticsHandler({ collect: () => ({ cancelled: true }), open: () => assert.fail('Cancelling Save As must not open the browser') });
r = response(); await cancelled({ method: 'POST', headers: page }, r);
assert.equal(r.status, 200); assert.deepEqual(JSON.parse(r.body), { ok: false, cancelled: true });
const notWindows = createDiagnosticsHandler({ collect: async () => ({ fileName: 'f.txt' }), open: () => ({ folderOpened: false, issueOpened: false }) });
r = response(); await notWindows({ method: 'POST', headers: page }, r);
assert.equal(JSON.parse(r.body).issueOpened, false, 'The page can offer the issue link when the plugin could not open it');

console.log(JSON.stringify({ passed: true, redaction: true, callLog: true, textFile: true, windows: true, export: true, route: true }));
