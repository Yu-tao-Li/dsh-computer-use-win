// Problem reports. "Report a problem" on the settings page writes one readable
// Markdown file to the user's Downloads folder: the environment, the plugin's
// self-test, its recent computer-use calls and its lines from the DSH log. It
// then opens a GitHub issue page whose form arrives with the environment filled
// in, and the user drags the file there. Nothing leaves this computer unless
// the user attaches it. User folders, the user name and the computer name are
// replaced, typed text is kept as its length only, and no screenshot is added.
// Patterns: DSH Desktop's own diagnostics export (logs plus system facts in one
// archive), dshmarket's home-path redaction, VS Code's issue reporter and
// electron-util's debugInfo + openNewGitHubIssue (short facts in the issue URL,
// the long material attached), GitHub's issue-form URL prefill.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ISSUE_URL = 'https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/new';
export const DIAGNOSTICS_ROUTE = '/dsh-computer-use-win/api/diagnostics';
const CALL_LIMIT = 30;
const LOG_LINE_LIMIT = 200;
const LOG_TAIL_BYTES = 2 * 1024 * 1024;
// GitHub answers 414 for long URLs; the environment block stays well below it.
const URL_ENVIRONMENT_LIMIT = 1800;
// Argument values that can carry what the user typed or read: kept as a length.
const VALUE_KEYS = new Set(['text', 'value', 'keys', 'thenKeys', 'query', 'url', 'path', 'paths', 'title', 'windowTitle', 'name', 'content', 'password', 'script', 'arguments', 'args', 'prompt', 'filter']);
const PLUGIN_MARKERS = ['windows-computer-use', 'dsh-computer-use-win', 'wincu', 'WCU_'];

const desktopCall = name => /^(?:mcp__wincu__)?windows_computer_use_[a-z_]+$/.test(String(name ?? ''));
const shortName = name => String(name ?? '').replace(/^(?:mcp__wincu__)?windows_computer_use_/, '');
const parseArgs = value => {
  if (typeof value === 'string') try { return JSON.parse(value); } catch { return {}; }
  return value && typeof value === 'object' ? value : {};
};
const clip = (text, max) => text.length > max ? text.slice(0, max - 1) + '…' : text;

// Replaces every Windows user-profile path (8.3 short forms and forward
// slashes too), then the user and computer names as whole words.
export function makeRedactor({ user = safeUserName(), host = os.hostname(), secrets = [] } = {}) {
  const words = [];
  for (const [value, mark] of [[user, '<user>'], [host, '<computer>']]) {
    if (typeof value === 'string' && value.trim().length >= 3) words.push([new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(value.trim())}(?![A-Za-z0-9])`, 'gi'), mark]);
  }
  const hidden = secrets.filter(secret => typeof secret === 'string' && secret.length >= 8);
  return value => {
    let text = String(value ?? '');
    for (const secret of hidden) text = text.split(secret).join('<secret>');
    text = text.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'<>|*?]+/gi, '%USERPROFILE%');
    for (const [pattern, mark] of words) text = text.replace(pattern, mark);
    return text;
  };
}
function safeUserName() { try { return os.userInfo().username; } catch { return process.env.USERNAME ?? ''; } }
function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// The shape of a call, never what it typed: value-like strings become their
// length, other strings are clipped, nested steps are described the same way.
export function describeArgs(value, redact = text => text, depth = 0) {
  const args = parseArgs(value);
  const out = {};
  for (const [key, item] of Object.entries(args)) {
    if (item === undefined) continue;
    if (VALUE_KEYS.has(key) && (typeof item === 'string' || Array.isArray(item))) out[key] = typeof item === 'string' ? `<${[...item].length} chars>` : `<${item.length} items>`;
    else if (typeof item === 'string') out[key] = clip(redact(item), 80);
    else if (typeof item === 'number' || typeof item === 'boolean' || item === null) out[key] = item;
    else if (Array.isArray(item)) out[key] = depth < 2 ? item.slice(0, 12).map(entry => entry && typeof entry === 'object' ? describeArgs(entry, redact, depth + 1) : typeof entry === 'string' ? `<${[...entry].length} chars>` : entry) : `<${item.length} items>`;
    else if (typeof item === 'object') out[key] = depth < 2 ? describeArgs(item, redact, depth + 1) : '<object>';
  }
  return out;
}

function errorText(result) {
  const text = Array.isArray(result?.content) ? result.content.filter(part => part?.type === 'text').map(part => part.text).join('\n') : '';
  return text || String(result?.error?.message ?? '');
}

// The last computer-use calls in this DSH run, in memory only.
export function installCallLog(ctx, { limit = CALL_LIMIT, redact = makeRedactor() } = {}) {
  const calls = [];
  ctx.on('tools/execute', async (exec, next) => {
    if (!desktopCall(exec?.name)) return next();
    const started = Date.now();
    const entry = { at: new Date(started).toISOString(), tool: shortName(exec.name), args: describeArgs(exec.arguments, redact) };
    const finish = patch => {
      Object.assign(entry, { ms: Date.now() - started }, patch);
      calls.push(entry);
      if (calls.length > limit) calls.splice(0, calls.length - limit);
    };
    try {
      const result = await next();
      finish(result?.isError ? { ok: false, error: clip(redact(errorText(result)), 400) } : { ok: true });
      return result;
    } catch (error) {
      finish({ ok: false, error: clip(redact(String(error?.message ?? error)), 400) });
      throw error;
    }
  }, { global: true });
  return { list: () => calls.map(call => ({ ...call })) };
}

const runFile = (file, args, { timeout = 15000, env } = {}) => new Promise(resolve => {
  execFile(file, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', ...(env ? { env } : {}) },
    (error, stdout, stderr) => resolve({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
});
const powershellPath = () => path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

// Facts only Windows knows: where Downloads really is (users move it), the
// Windows release, the screens and the browsers. Base64 keeps non-ASCII paths
// intact whatever the console code page.
const SYSTEM_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
# Per-monitor DPI aware first, so screens report physical pixels and the real DPI.
try{Add-Type -Namespace WcuDiag -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr v);';[void][WcuDiag.Dpi]::SetProcessDpiAwarenessContext([IntPtr](-4))}catch{}
$o=[ordered]@{}
try{$o.downloads=(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path}catch{}
$cv=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
$o.windows=[ordered]@{product=$cv.ProductName;display=$cv.DisplayVersion;build=$cv.CurrentBuild;ubr=$cv.UBR;edition=$cv.EditionID}
$o.powershell=$PSVersionTable.PSVersion.ToString()
$o.pwsh=[bool](Get-Command pwsh -ErrorAction SilentlyContinue)
try{Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$g=[System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero);$o.systemDpi=[int]$g.DpiX;$g.Dispose();$o.screens=@([System.Windows.Forms.Screen]::AllScreens|ForEach-Object{[ordered]@{primary=$_.Primary;bounds="$($_.Bounds.Width)x$($_.Bounds.Height)@$($_.Bounds.X),$($_.Bounds.Y)"}})}catch{}
$k='HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https'
$o.defaultBrowser=(Get-ItemProperty "$k\\UserChoiceLatest\\ProgId").ProgId
if(-not $o.defaultBrowser){$o.defaultBrowser=(Get-ItemProperty "$k\\UserChoice").ProgId}
$o.uiCulture=(Get-UICulture).Name
$o.culture=(Get-Culture).Name
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($o|ConvertTo-Json -Depth 4 -Compress)))
`;
export async function systemFacts() {
  if (process.platform !== 'win32') return {};
  const { stdout } = await runFile(powershellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SYSTEM_SCRIPT], { timeout: 20000 });
  let facts;
  try { facts = JSON.parse(Buffer.from(stdout.trim().split(/\s+/).pop() ?? '', 'base64').toString('utf8')); } catch { return {}; }
  // Windows 11 still calls itself "Windows 10" in ProductName; its build says otherwise.
  if (/^Windows 10/.test(facts.windows?.product ?? '') && Number(facts.windows?.build) >= 22000) facts.windows.product = facts.windows.product.replace(/^Windows 10/, 'Windows 11');
  return facts;
}

// Browser versions from their install folders (each version has a folder).
export function browserVersions(env = process.env) {
  const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
  const apps = { edge: 'Microsoft/Edge/Application', chrome: 'Google/Chrome/Application' };
  const found = {};
  for (const [key, rel] of Object.entries(apps)) for (const root of roots) {
    try {
      const versions = readdirSync(path.join(root, rel)).filter(name => /^\d+\.\d+\.\d+\.\d+$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      if (versions.length) { found[key] = versions[0]; break; }
    } catch { }
  }
  return found;
}

// The plugin's own self-test (backend health and a test capture), in a
// separate process so a busy session is not disturbed. The active window's
// title and the capture's path stay out.
export async function runSelfTest(serverPath, { timeout = 45000, env = process.env } = {}) {
  const { error, stdout } = await runFile(process.execPath, [serverPath, '--self-test'], { timeout, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } });
  let data;
  try { data = JSON.parse(stdout); } catch { return { ok: false, error: clip(String(error?.message ?? 'no output'), 300) }; }
  const backend = data.backend ?? {};
  return {
    ok: data.ok === true,
    serverVersion: data.server?.version,
    tools: data.tools,
    inputDesktopAvailable: data.inputDesktopAvailable,
    backend: {
      ok: backend.ok, powershell: backend.powershell, mode: backend.mode, uiAutomation: backend.uiAutomation,
      screenshot: backend.screenshot, sendInput: backend.sendInput, postmessage: backend.postmessage, ocr: backend.ocr,
      homing: backend.homing, targetResponsive: backend.targetResponsive, inputDesktopAvailable: backend.inputDesktopAvailable,
      virtualScreen: backend.virtualScreen, activeWindowClass: backend.activeWindow?.className, error: backend.error,
    },
    capture: { ok: data.screenshot?.ok, bytes: data.screenshot?.bytes, bounds: data.screenshot?.bounds },
  };
}

// The plugin's lines from DSH's own log files (newest two per folder, their
// last 2 MiB), the last 200 of them. DSH writes warnings to its main log and
// its error log alike, so a line already taken from one file is not repeated.
export function pluginLogLines(dirs, { limit = LOG_LINE_LIMIT, markers = PLUGIN_MARKERS } = {}) {
  const lines = [], seen = new Set();
  for (const dir of dirs) {
    let names = [];
    try { names = readdirSync(dir).filter(name => name.endsWith('.log')).map(name => ({ name, at: statSync(path.join(dir, name)).mtimeMs })).sort((a, b) => b.at - a.at).slice(0, 2).map(item => item.name).reverse(); } catch { continue; }
    for (const name of names) {
      const file = path.join(dir, name);
      let text = '';
      try {
        const size = statSync(file).size, start = Math.max(0, size - LOG_TAIL_BYTES), buffer = Buffer.alloc(size - start), fd = openSync(file, 'r');
        try { readSync(fd, buffer, 0, buffer.length, start); } finally { closeSync(fd); }
        text = buffer.toString('utf8');
      } catch { continue; }
      for (const line of text.split(/\r?\n/)) {
        if (!line || !markers.some(marker => line.includes(marker)) || seen.has(line)) continue;
        seen.add(line);
        lines.push(`${path.basename(dir)}/${name}: ${clip(line, 600)}`);
      }
    }
  }
  return lines.slice(-limit);
}

export function dshLogDirs(env = process.env) {
  const dirs = [];
  if (env.APPDATA) for (const sub of ['DSH Desktop/logs', 'DSH Desktop/logs/host']) dirs.push(path.join(env.APPDATA, sub));
  const home = env.DSH_HOME || path.join(os.homedir(), '.dsh');
  dirs.push(path.join(home, 'logs'));
  return dirs.filter(dir => { try { return statSync(dir).isDirectory(); } catch { return false; } });
}

const fence = (text, lang = 'text') => '```' + lang + '\n' + String(text).replace(/```/g, '``\u200b`') + '\n```';

// The short environment block the issue form gets in its URL.
export function environmentSummary(facts) {
  const s = facts.settings ?? {};
  const rows = [
    `插件 / Plugin: ${facts.version}${facts.installSpec ? ` (${facts.installSpec})` : ''}`,
    `宿主 / Host: ${facts.host ?? 'unknown'}${facts.mcpClient ? `, dsh-mcp-client ${facts.mcpClient}` : ''}${facts.electron ? `, Electron ${facts.electron}` : ''}, Node ${facts.node}`,
    `Windows: ${[facts.windows?.product, facts.windows?.display, facts.windows?.build ? `build ${facts.windows.build}${facts.windows.ubr != null ? '.' + facts.windows.ubr : ''}` : ''].filter(Boolean).join(' ') || facts.osRelease}`,
    `PowerShell: ${facts.powershell ?? 'unknown'}${facts.pwsh ? ' (pwsh available)' : ''}`,
    `屏幕 / Screens: ${(facts.screens ?? []).map(screen => screen.bounds + (screen.primary ? '*' : '')).join(' ') || 'unknown'}${facts.systemDpi ? `, ${facts.systemDpi} dpi` : ''}`,
    `语言 / Locale: DSH ${facts.dshLocale ?? '?'}, ${facts.culture ?? '?'} / UI ${facts.uiCulture ?? '?'}`,
    `浏览器 / Browsers: default ${facts.defaultBrowser ?? '?'}${Object.entries(facts.browsers ?? {}).map(([key, version]) => `, ${key} ${version}`).join('')}`,
    `设置 / Settings: tools ${s.toolPreset ?? '?'}, browser ${s.browserApp ?? '?'}, visible ${s.browserVisible}, sign-ins ${s.browserSignIn}, attach ${s.browserAttachUser}, overlay ${s.progressOverlayEnabled}`,
    `__COMPAT_LAYER: ${facts.compatLayer ? facts.compatLayer : 'not set'}`,
    `自检 / Self-test: ${facts.selfTest ? (facts.selfTest.ok ? 'ok' : 'failed') + (facts.selfTest.backend?.powershell ? `, backend ${facts.selfTest.backend.powershell}` : '') + (facts.selfTest.backend?.uiAutomation === false ? ', no UIA' : '') + (facts.selfTest.inputDesktopAvailable === false ? ', input desktop unavailable' : '') : 'not run'}`,
  ];
  return clip(rows.join('\n'), URL_ENVIRONMENT_LIMIT);
}

export function issueUrl(summary, { title = '' } = {}) {
  const query = new URLSearchParams({ template: 'bug_report.yml', ...(title ? { title } : {}), environment: summary });
  return `${ISSUE_URL}?${query.toString()}`;
}

export function diagnosticsMarkdown(facts, { calls = [], logs = [], at = new Date() } = {}) {
  const callRows = calls.length
    ? ['| 时间 / Time | 工具 / Tool | 耗时 / ms | 结果 / Result | 参数 / Arguments |', '|---|---|---|---|---|',
      ...calls.map(call => `| ${call.at} | ${call.tool} | ${call.ms ?? ''} | ${call.ok ? 'ok' : 'error: ' + String(call.error ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')} | \`${JSON.stringify(call.args).replace(/\|/g, '\\|').replace(/`/g, "'")}\` |`)].join('\n')
    : '这次启动 DSH 后还没有电脑操控调用。/ No computer-use calls since DSH started.';
  return [
    `# dsh-computer-use-win 诊断信息 / diagnostics`,
    '',
    `导出时间 / Exported: ${at.toISOString()} · 插件 / plugin ${facts.version}`,
    '',
    '> 用户目录、用户名和计算机名已经替换；输入的文字只保留长度；文件里没有截图。上传前可以先看一遍。/ User folders, the user name and the computer name are replaced; typed text is kept as its length only; there are no screenshots. Look it over before you upload it.',
    '',
    '## 环境 / Environment',
    '',
    fence(environmentSummary(facts)),
    '',
    '## 设置 / Settings',
    '',
    fence(JSON.stringify(facts.settings ?? {}, null, 2), 'json'),
    '',
    '## 自检 / Self-test',
    '',
    fence(JSON.stringify(facts.selfTest ?? { ok: false, error: 'not run' }, null, 2), 'json'),
    '',
    `## 最近的电脑操控调用 / Recent computer-use calls (${calls.length})`,
    '',
    callRows,
    '',
    `## DSH 日志里和本插件相关的行 / Plugin lines in the DSH log (${logs.length})`,
    '',
    logs.length ? fence(logs.join('\n')) : '没有找到。/ None found.',
    '',
  ].join('\n');
}

const stamp = (at = new Date()) => {
  const pad = number => String(number).padStart(2, '0');
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
};

// Collects, writes and returns { file, fileName, issueUrl }. Settings keep
// their shape; the banner text the user wrote is kept as its length.
export async function exportDiagnostics({ version, settings = {}, calls = [], host, mcpClient, dshLocale, installSpec, serverPath, defaultBrowser, env = process.env, at = new Date(), outDir, selfTest, facts: given } = {}) {
  const redact = makeRedactor({ secrets: [env.WCU_APPROVAL_SECRET].filter(Boolean) });
  const system = given?.system ?? await systemFacts();
  const cleanSettings = { ...settings };
  if (typeof cleanSettings.indicatorText === 'string') cleanSettings.indicatorText = `<${[...cleanSettings.indicatorText].length} chars>`;
  // Button tokens say nothing; a tool list matters only for a custom preset.
  for (const key of Object.keys(cleanSettings)) if (/Token$/.test(key)) delete cleanSettings[key];
  if (cleanSettings.toolPreset !== 'custom') delete cleanSettings.enabledTools;
  const facts = {
    version, host, mcpClient, dshLocale, installSpec: installSpec ? redact(installSpec) : undefined, settings: cleanSettings,
    node: process.versions.node, electron: process.versions.electron, osRelease: `${os.type()} ${os.release()}`,
    windows: system.windows, powershell: system.powershell, pwsh: system.pwsh, screens: system.screens, systemDpi: system.systemDpi,
    culture: system.culture, uiCulture: system.uiCulture, browsers: given?.browsers ?? browserVersions(env), defaultBrowser: defaultBrowser ?? system.defaultBrowser,
    compatLayer: Object.entries(env).find(([key]) => key.toUpperCase() === '__COMPAT_LAYER')?.[1],
    selfTest: selfTest ?? (serverPath ? await runSelfTest(serverPath, { env }) : undefined),
  };
  const logs = (given?.logs ?? pluginLogLines(dshLogDirs(env))).map(redact);
  const markdown = redact(diagnosticsMarkdown(facts, { calls, logs, at }));
  const folder = outDir ?? (system.downloads && existsSync(system.downloads) ? system.downloads : path.join(os.homedir(), 'Downloads'));
  mkdirSync(folder, { recursive: true });
  const fileName = `wincu-diagnostics-${stamp(at)}.md`;
  const file = path.join(folder, fileName);
  writeFileSync(file, '\ufeff' + markdown, 'utf8');
  return { file, fileName, issueUrl: issueUrl(redact(environmentSummary(facts))), bytes: Buffer.byteLength(markdown) };
}

// Explorer shows the file; the default browser opens the issue form.
export function revealAndOpen({ file, issueUrl: url }, run = (command, args) => { const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false }); child.on('error', () => { }); child.unref(); }) {
  if (process.platform !== 'win32') return false;
  if (file) run('explorer.exe', ['/select,', file]);
  if (url) run('explorer.exe', [url]);
  return true;
}

// A request from the DSH page itself: loopback host, not cross-site, the same
// origin when one is sent, and this plugin's own header, which a page on
// another site cannot add without a preflight that is never answered.
export function trustedRequest(request) {
  const headers = request?.headers ?? {};
  const host = headers.host;
  if (host !== undefined && !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(String(host))) return false;
  if (headers['sec-fetch-site'] === 'cross-site') return false;
  if (headers['x-wcu-request'] !== '1') return false;
  const origin = headers.origin;
  if (origin === undefined) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

const sendJson = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
};

// POST runs one export at a time and answers { ok, fileName, issueUrl }.
export function createDiagnosticsHandler({ collect, open = revealAndOpen, logger } = {}) {
  let running = null;
  return async (request, response) => {
    if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return; }
    if (!trustedRequest(request)) { sendJson(response, 403, { ok: false, error: 'untrusted request' }); return; }
    if (running) { sendJson(response, 409, { ok: false, error: 'an export is already running' }); return; }
    running = (async () => collect())();
    try {
      const result = await running;
      let opened = false;
      try { opened = open(result) !== false; } catch (error) { logger?.warn?.('dsh-computer-use-win: could not open the diagnostics: %s', error?.message ?? error); }
      sendJson(response, 200, { ok: true, fileName: result.fileName, issueUrl: result.issueUrl, opened });
    } catch (error) {
      logger?.warn?.('dsh-computer-use-win: diagnostics export failed: %s', error?.message ?? error);
      sendJson(response, 500, { ok: false, error: clip(String(error?.message ?? error), 300) });
    } finally { running = null; }
  };
}

// The dependency spec the profile installed this plugin with (a version, or a
// file: or link: path). pnpm keeps the package below node_modules/.pnpm, so
// the profile is found by walking up to the package.json that lists it.
export function readInstallSpec(pluginRoot, profileDir) {
  const candidates = profileDir ? [profileDir] : [];
  let dir = path.resolve(pluginRoot);
  for (let i = 0; i < 8; i++) { const parent = path.dirname(dir); if (parent === dir) break; dir = parent; candidates.push(dir); }
  for (const candidate of candidates) {
    try { const spec = JSON.parse(readFileSync(path.join(candidate, 'package.json'), 'utf8')).dependencies?.['dsh-computer-use-win']; if (typeof spec === 'string') return spec; } catch { }
  }
  return undefined;
}
