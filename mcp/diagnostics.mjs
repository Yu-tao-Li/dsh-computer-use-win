// Problem reports. "Report a problem" on the settings page writes one plain
// text file to the user's Downloads folder: the environment, the plugin's
// self-test, its recent computer-use calls and its lines from the DSH log. It
// then opens the Downloads folder and GitHub's new-issue page, and the user
// drags the file there. Nothing leaves this computer unless the user attaches
// it. Local paths, the user name and the computer name are replaced, typed
// text is kept as its length only, and no screenshot is added.
// Patterns: DSH Desktop's own diagnostics export (logs plus system facts in one
// archive), dshmarket's home-path redaction, VS Code's issue reporter and
// electron-util's debugInfo + openNewGitHubIssue (the material attached to a
// new issue).
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETTINGS_SCHEMA, STOP_SHORTCUT_PATTERN } from './settings-schema.mjs';

export const ISSUE_URL = 'https://github.com/Yu-tao-Li/dsh-computer-use-win/issues/new';
export const DIAGNOSTICS_ROUTE = '/dsh-computer-use-win/api/diagnostics';
const CALL_LIMIT = 30;
const LOG_LINE_LIMIT = 200;
const LOG_TAIL_BYTES = 2 * 1024 * 1024;
// Argument values that can carry what the user typed or read: kept as a length.
const VALUE_KEYS = new Set(['text', 'value', 'keys', 'thenKeys', 'query', 'url', 'path', 'paths', 'title', 'windowTitle', 'name', 'content', 'password', 'script', 'arguments', 'args', 'prompt', 'filter']);
const LABEL_KEYS = new Set(['action', 'button', 'direction', 'elementId', 'scope', 'browserTab']);
const PLUGIN_MARKERS = ['windows-computer-use', 'dsh-computer-use-win', 'wincu', 'WCU_'];
const CREDENTIAL_HEADER = 'cookie|set-cookie|authorization|proxy-authorization';
// A field named token, alone or with a prefix: token, access_token, idToken, csrftoken.
const TOKEN_FIELD = '[a-z]*[_-]?token';
const CREDENTIAL_FIELD = CREDENTIAL_HEADER + `|cookies|${TOKEN_FIELD}|api[_-]?key|password|secret`;
const SENSITIVE_FIELD = new RegExp(`^(?:${CREDENTIAL_FIELD})$`, 'i');
const QUOTED_CREDENTIAL = new RegExp(`(["'](?:${CREDENTIAL_FIELD})["'][ \\t]*[:=][ \\t]*)(?:"(?:\\\\.|[^"\\\\\\r\\n])*"|'(?:\\\\.|[^'\\\\\\r\\n])*')`, 'gi');
const RAW_CREDENTIAL = new RegExp(`(\\b(?:${CREDENTIAL_HEADER})[ \\t]*[:=][ \\t]*)[^\\r\\n]*(?:\\r?\\n[ \\t]+[^\\r\\n]*)*`, 'gi');
const MASKED_CREDENTIAL = new RegExp(`(?:["'](?:${CREDENTIAL_FIELD})["']|\\b(?:${CREDENTIAL_FIELD}))\\s*[:=]\\s*(?:"<secret>"|<secret>)`, 'gi');
const LABELED_SECRET = new RegExp(`(["']?(?:${TOKEN_FIELD}|api[_-]?key|password|secret)["']?\\s*[:=]\\s*)(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s,;]+)(?=\\s|[,;}]|$)`, 'gi');
const STRUCTURED_CREDENTIAL = new RegExp(`["'](?:${CREDENTIAL_FIELD})["']\\s*[:,=]|[=:]\\s*["'](?:${CREDENTIAL_HEADER})["']|\\b(?:${CREDENTIAL_FIELD})\\s*[:=]\\s*[\\[{]`, 'i');
// Unquoted Windows paths can contain spaces. In a free-form message, remove
// the whole ambiguous path span up to a quote or line boundary.
const WINDOWS_PATH = /(?<![\w])(?:[A-Z]:[\\/]+|\\\\+[^\\/\s"<>|]+[\\/]+|%USERPROFILE%[\\/]+)[^"<>|\r\n]*/gi;
const WINDOWS_PATH_ON_SLASHES = /(?:\b[A-Z]:\/|\/\/[^/\s"<>|]+\/|%USERPROFILE%\/)/i;

// Inspect common nested JSON encodings without printing the decoded payload.
// If a credential container or an encoded path survives the scalar masks,
// there is no reliable boundary in the free-form line to keep safely.
function omitSensitiveLine(line) {
  const normalized = line
    .replace(/\\+u([\da-f]{4})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\+(?=["'/])/g, '');
  return STRUCTURED_CREDENTIAL.test(normalized.replace(MASKED_CREDENTIAL, ''))
    || (normalized !== line && (normalized.search(WINDOWS_PATH) >= 0 || WINDOWS_PATH_ON_SLASHES.test(normalized)));
}

const desktopCall = name => /^(?:mcp__wincu__)?windows_computer_use_[a-z_]+$/.test(String(name ?? ''));
const shortName = name => String(name ?? '').replace(/^(?:mcp__wincu__)?windows_computer_use_/, '');
const parseArgs = value => {
  if (typeof value === 'string') try { return JSON.parse(value); } catch { return {}; }
  return value && typeof value === 'object' ? value : {};
};
const clip = (text, max) => text.length > max ? text.slice(0, max - 1) + '…' : text;

// Redact complete credential headers and absolute Windows paths before making
// free-form errors or logs available for public feedback.
export function makeRedactor({ user = safeUserName(), host = os.hostname(), home = os.homedir(), secrets = [] } = {}) {
  const words = [];
  for (const [value, mark] of [[user, '<user>'], [host, '<computer>']]) {
    if (typeof value === 'string' && value.trim().length >= 3) words.push([new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(value.trim())}(?![A-Za-z0-9])`, 'gi'), mark]);
  }
  const hidden = secrets.filter(secret => typeof secret === 'string' && secret.length >= 8);
  const homePath = home && new RegExp(home.split(/[\\/]+/).map(escapeRegExp).join('[\\\\/]+') + '[^"\'<>|\\r\\n]*', 'gi');
  return value => {
    let text = String(value ?? '');
    for (const secret of hidden) text = text.split(secret).join('<secret>');
    text = text.replace(QUOTED_CREDENTIAL, '$1"<secret>"').replace(RAW_CREDENTIAL, '$1<secret>');
    if (text.split('\n').some(omitSensitiveLine)) return '<redacted diagnostic entry>';
    text = text.replace(/\b(?:https?|wss?|file):\/\/[^\s"'<>]+/gi, '<url>');
    text = text.replace(WINDOWS_PATH, '<path>');
    if (homePath) text = text.replace(homePath, '<path>');
    text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email>');
    // Bearer tokens, GitHub and npm tokens, and sk- API keys (DeepSeek, OpenAI, Anthropic) even without a label.
    text = text.replace(/\b(?:Bearer\s+[A-Za-z0-9._~+\/-]+|(?:gh[pousr]_|github_pat_|npm_)[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9][A-Za-z0-9_-]{15,})/gi, '<secret>');
    text = text.replace(LABELED_SECRET, '$1<secret>');
    for (const [pattern, mark] of words) text = text.replace(pattern, mark);
    return text;
  };
}
function safeUserName() { try { return os.userInfo().username; } catch { return process.env.USERNAME ?? ''; } }
function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function redactDiagnosticValue(value, redact) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(item => redactDiagnosticValue(item, redact));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    redact(key), SENSITIVE_FIELD.test(key) ? '<secret>' : redactDiagnosticValue(item, redact),
  ]));
  return value;
}

// The shape of a call, never what it typed: value-like strings become their
// length, other strings are clipped, nested steps are described the same way.
export function describeArgs(value, redact = text => text, depth = 0) {
  const args = parseArgs(value);
  const out = {};
  for (const [key, item] of Object.entries(args)) {
    if (item === undefined) continue;
    if (VALUE_KEYS.has(key) && (typeof item === 'string' || Array.isArray(item))) out[key] = typeof item === 'string' ? `<${[...item].length} chars>` : `<${item.length} items>`;
    else if (typeof item === 'string') out[key] = LABEL_KEYS.has(key) && /^[\w:-]{1,64}$/.test(item) ? redact(item) : `<${[...item].length} chars>`;
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
const windowsDir = () => process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
const powershellPath = () => path.join(windowsDir(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

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
try{$o.desktopVersions=@(Get-Process -Name 'DSH Desktop' | ForEach-Object {$_.FileVersion} | Where-Object {$_ -match '^\\d+(\\.\\d+){1,3}$'} | Sort-Object -Unique)}catch{}
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
  for (const root of roots) {
    try {
      const version = /^Version=([0-9.]+[a-z\d]*)\r?$/im.exec(readFileSync(path.join(root, 'Mozilla Firefox', 'application.ini'), 'utf8'))?.[1];
      if (version) { found.firefox = version; break; }
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
      virtualScreen: backend.virtualScreen, error: backend.error,
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
    try {
      names = readdirSync(dir).filter(name => name.endsWith('.log')).flatMap(name => {
        try { return [{name,at:statSync(path.join(dir,name)).mtimeMs}]; }
        catch { return []; }
      }).sort((a,b)=>b.at-a.at).slice(0,2).map(item=>item.name).reverse();
    } catch { continue; }
    for (const name of names) {
      const file = path.join(dir, name);
      let text = '';
      try {
        const size = statSync(file).size, start = Math.max(0, size - LOG_TAIL_BYTES), buffer = Buffer.alloc(size - start), fd = openSync(file, 'r');
        try { readSync(fd, buffer, 0, buffer.length, start); } finally { closeSync(fd); }
        text = buffer.toString('utf8');
        if (start > 0) {
          const nextLine = text.indexOf('\n');
          text = nextLine < 0 ? '' : text.slice(nextLine + 1);
        }
      } catch { continue; }
      for (const line of text.split(/\r?\n/)) {
        if (!line || !markers.some(marker => line.includes(marker)) || seen.has(line)) continue;
        seen.add(line);
        lines.push(`${path.basename(dir)}/${name}: ${line}`);
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

// The environment in a few lines, at the top of the file.
export function environmentSummary(facts) {
  const s = facts.settings ?? {};
  const rows = [
    `插件 / Plugin: ${facts.version}${facts.installSource ? ` (${facts.installSource})` : ''}`,
    `宿主 / Host: ${facts.host ?? 'unknown'}${facts.desktopVersions?.length ? ` ${facts.desktopVersions.join(' / ')}` : ''}${facts.mcpClient ? `, dsh-mcp-client ${facts.mcpClient}` : ''}${facts.electron ? `, Electron ${facts.electron}` : ''}, Node ${facts.node}`,
    `Windows: ${[facts.windows?.product, facts.windows?.display, facts.windows?.build ? `build ${facts.windows.build}${facts.windows.ubr != null ? '.' + facts.windows.ubr : ''}` : ''].filter(Boolean).join(' ') || facts.osRelease}${facts.arch ? ` (${facts.arch})` : ''}`,
    `PowerShell: ${facts.powershell ?? 'unknown'}${facts.pwsh ? ' (pwsh available)' : ''}`,
    `屏幕 / Screens: ${(facts.screens ?? []).map(screen => screen.bounds + (screen.primary ? '*' : '')).join(' ') || 'unknown'}${facts.systemDpi ? `, ${facts.systemDpi} dpi` : ''}`,
    `语言 / Locale: DSH ${facts.dshLocale ?? '?'}, ${facts.culture ?? '?'} / UI ${facts.uiCulture ?? '?'}`,
    `浏览器 / Browsers: default ${facts.defaultBrowser ?? '?'}${Object.entries(facts.browsers ?? {}).map(([key, version]) => `, ${key} ${version}`).join('')}`,
    `设置 / Settings: tools ${s.toolPreset ?? '?'}, browser ${s.browserApp ?? '?'}, visible ${s.browserVisible}, sign-ins ${s.browserSignIn}, attach ${s.browserAttachUser}, overlay ${s.progressOverlayEnabled}`,
    `__COMPAT_LAYER: ${facts.compatLayer ? facts.compatLayer : 'not set'}`,
    `自检 / Self-test: ${facts.selfTest ? (facts.selfTest.ok ? 'ok' : 'failed') + (facts.selfTest.backend?.powershell ? `, backend ${facts.selfTest.backend.powershell}` : '') + (facts.selfTest.backend?.uiAutomation === false ? ', no UIA' : '') + (facts.selfTest.inputDesktopAvailable === false ? ', input desktop unavailable' : '') : 'not run'}`,
  ];
  return rows.join('\n');
}

// The file is plain text (Notepad opens it on any Windows): a heading line
// per section, one call per line.
export function diagnosticsText(facts, { calls = [], logs = [], at = new Date() } = {}) {
  const oneLine = text => String(text ?? '').replace(/\s*\r?\n\s*/g, ' ');
  const section = (title, body) => ['', `== ${title} ==`, body];
  const callLines = calls.length
    ? calls.map(call => [call.at, call.tool, `${call.ms ?? '?'} ms`, call.ok ? 'ok' : `error: ${oneLine(call.error)}`, JSON.stringify(call.args ?? {})].join('  ')).join('\n')
    : '这次启动 DSH 后还没有电脑操控调用。/ No computer-use calls since DSH started.';
  return [
    'dsh-computer-use-win 诊断信息 / diagnostics',
    `导出时间 / Exported: ${at.toISOString()} · 插件 / plugin ${facts.version}`,
    '上传前请检查日志和错误信息。工具输入文字只保留长度，报告不包含截图。',
    'Review the logs and errors before attaching this file. Tool input text is kept as its length; screenshots are excluded.',
    ...section('环境 / Environment', environmentSummary(facts)),
    ...section('设置 / Settings', JSON.stringify(facts.settings ?? {}, null, 2)),
    ...(facts.bridge ? section('宿主 MCP 注册 / Host MCP registration', JSON.stringify(facts.bridge, null, 2)) : []),
    ...section('自检 / Self-test', JSON.stringify(facts.selfTest ?? { ok: false, error: 'not run' }, null, 2)),
    ...section(`最近的电脑操控调用 / Recent computer-use calls (${calls.length})`, callLines),
    ...section(`DSH 日志里和本插件相关的行 / Plugin lines in the DSH log (${logs.length})`, logs.length ? logs.join('\n') : '没有找到。/ None found.'),
    '',
  ].join('\n');
}

const stamp = (at = new Date()) => {
  const pad = number => String(number).padStart(2, '0');
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
};

function diagnosticSettings(settings) {
  const result = {};
  for (const [key, field] of Object.entries(SETTINGS_SCHEMA)) {
    if (field.command || key === 'communityNote' || key === 'hypervVm') continue;
    const value = settings[key];
    if (field.type === 'text' && typeof value === 'string') result[key] = `<${[...value].length} chars>`;
    if (field.type === 'boolean' && typeof value === 'boolean') result[key] = value;
    if (field.type === 'integer' && Number.isSafeInteger(value)) result[key] = value;
    if (field.type === 'enum' && field.values.includes(value)) result[key] = value;
    if (field.type === 'shortcut' && typeof value === 'string' && STOP_SHORTCUT_PATTERN.test(value)) result[key] = value;
    if (field.type === 'tools' && settings.toolPreset === 'custom' && Array.isArray(value)) result[key] = value.filter(tool => field.default.includes(tool));
  }
  return result;
}

// Collects, writes and returns { file, fileName }. Settings keep their shape;
// the banner text the user wrote is kept as its length.
export async function exportDiagnostics({ version, settings = {}, calls = [], host, mcpClient, bridge, dshLocale, installSpec, serverPath, defaultBrowser, env = process.env, secrets = [], at = new Date(), outDir, selfTest, facts: given, saveAs = saveDiagnosticsAs } = {}) {
  const redact = makeRedactor({ secrets: [...secrets, env.WCU_APPROVAL_SECRET] });
  const [system,health] = await Promise.all([
    given?.system ?? systemFacts(),
    selfTest ?? (serverPath ? runSelfTest(serverPath, { env }) : undefined),
  ]);
  const installSource = !installSpec ? undefined : /^(?:file|link):/.test(installSpec) ? 'local' : /^(?:git|https?:|github:)/.test(installSpec) ? 'git' : 'registry';
  const facts = {
    version, host, mcpClient, bridge, dshLocale, installSource, settings: diagnosticSettings(settings),
    desktopVersions: host === 'DSH Desktop' ? system.desktopVersions : undefined,
    node: process.versions.node, electron: process.versions.electron, arch: process.arch, osRelease: `${os.type()} ${os.release()}`,
    windows: system.windows, powershell: system.powershell, pwsh: system.pwsh, screens: system.screens, systemDpi: system.systemDpi,
    culture: system.culture, uiCulture: system.uiCulture, browsers: given?.browsers ?? browserVersions(env), defaultBrowser: defaultBrowser ?? system.defaultBrowser,
    compatLayer: Object.entries(env).find(([key]) => key.toUpperCase() === '__COMPAT_LAYER')?.[1],
    selfTest: health,
  };
  const logs = (given?.logs ?? pluginLogLines(dshLogDirs(env))).map(line => clip(redact(line), 600));
  // A BOM and CRLF line ends, so every Notepad shows the Chinese and the lines right.
  const text = diagnosticsText(redactDiagnosticValue(facts, redact), {
    calls: redactDiagnosticValue(calls, redact), logs, at,
  }).replace(/\r?\n/g, '\r\n');
  const fileName = `wincu-diagnostics-${stamp(at)}.txt`;
  const contents = '\ufeff' + text;
  try {
    const folder = path.resolve(outDir ?? (system.downloads || path.join(os.homedir(), 'Downloads')));
    mkdirSync(folder, { recursive: true });
    for (let index = 1; ; index++) {
      const name = index === 1 ? fileName : fileName.slice(0, -4) + '-' + index + '.txt';
      const file = path.join(folder, name);
      try { writeFileSync(file, contents, { encoding: 'utf8', flag: 'wx' }); }
      catch (error) { if (error.code === 'EEXIST' && index < 100) continue; throw error; }
      return { file, fileName: name };
    }
  } catch (error) {
    if (!saveAs) throw error;
    const file = await saveAs({ fileName, contents, dshLocale });
    return file === null ? { cancelled: true } : { file, fileName: path.basename(file) };
  }
}

const saveDialogScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
$owner = [Windows.Forms.Form]::new()
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'FixedToolWindow'
$owner.StartPosition = 'CenterScreen'
$owner.Opacity = 0
$owner.TopMost = $true
$dialog = [Windows.Forms.SaveFileDialog]::new()
try {
  $owner.Show()
  $dialog.Title = $request.title
  $dialog.FileName = $request.fileName
  $dialog.Filter = 'TXT (*.txt)|*.txt'
  $dialog.DefaultExt = 'txt'
  $dialog.AddExtension = $true
  $dialog.RestoreDirectory = $true
  while ($dialog.ShowDialog($owner) -eq [Windows.Forms.DialogResult]::OK) {
    try {
      [IO.File]::WriteAllText($dialog.FileName, $request.contents, [Text.UTF8Encoding]::new($false))
      [Console]::WriteLine((@{file=$dialog.FileName} | ConvertTo-Json -Compress))
      exit 0
    } catch {
      [void][Windows.Forms.MessageBox]::Show($owner, $request.writeError, $request.title)
    }
  }
  [Console]::WriteLine('null')
} finally { $dialog.Dispose(); $owner.Dispose() }
`;

export function saveDiagnosticsAs({ fileName, contents, dshLocale }) {
  if (process.platform !== 'win32') throw new Error('Windows Save As is unavailable in this host');
  const zh = /^zh\b/i.test(dshLocale ?? '');
  const command = Buffer.from(saveDialogScript, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn(powershellPath(), ['-NoProfile', '-STA', '-EncodedCommand', command], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Diagnostics Save As timed out'));
    }, 90_000);
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { if (output.length < 128 * 1024) output += chunk; });
    child.stdin.on('error', () => {});
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error('Windows Save As failed');
        const result = JSON.parse(output);
        if (result !== null && (typeof result?.file !== 'string' || !path.isAbsolute(result.file))) throw new Error('Windows Save As returned no file');
        resolve(result === null ? null : result.file);
      } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify({
      fileName, contents,
      title: zh ? '另存诊断文件' : 'Save diagnostics as',
      writeError: zh ? '无法保存到此位置，请选择其他位置。' : 'This location is not writable. Choose a different location.',
    }), 'utf8');
  });
}

async function launch(command, args, { waitForExit = false } = {}) {
  if (waitForExit) return !(await runFile(command, args, { timeout: 10000 })).error;
  return new Promise(resolve => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('spawn', () => { child.unref(); resolve(true); });
  });
}

// ShellExecute uses the registered HTTPS handler, including an already-open
// browser. The wrapper reports an error if Windows rejects the URL request.
const issueOpenScript = `
$ErrorActionPreference='Stop'
$start=[System.Diagnostics.ProcessStartInfo]::new()
$start.FileName='${ISSUE_URL}'
$start.UseShellExecute=$true
$start.WindowStyle=[System.Diagnostics.ProcessWindowStyle]::Normal
[void][System.Diagnostics.Process]::Start($start)
`;

// Two windows and no more: File Explorer on the Downloads folder with the file
// selected, and the default browser on the new-issue page.
export async function revealAndOpen({ file }, run = launch) {
  if (process.platform !== 'win32') return { folderOpened: false, issueOpened: false };
  const opened = (command, args, options) => Promise.resolve().then(() => run(command, args, options)).catch(() => false);
  const folderOpened = Boolean(file) && await opened(path.join(windowsDir(), 'explorer.exe'), ['/select,', file]);
  const issueOpened = await opened(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', issueOpenScript], { waitForExit: true });
  return { folderOpened, issueOpened };
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
  if (host === undefined) return false;
  try {
    const page = new URL(origin);
    return ['http:','https:'].includes(page.protocol) && page.host === new URL(page.protocol+'//'+host).host;
  } catch { return false; }
}

const sendJson = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
};

// POST runs one export at a time. The issue page remains available if saving fails.
export function createDiagnosticsHandler({ collect, open = revealAndOpen, logger } = {}) {
  let running = false;
  return async (request, response) => {
    if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return; }
    if (!trustedRequest(request)) { sendJson(response, 403, { ok: false, error: 'untrusted request' }); return; }
    if (running) { sendJson(response, 409, { ok: false, error: 'an export is already running' }); return; }
    running = true;
    try {
      let result;
      try { result = await collect(); }
      catch (error) { logger?.warn?.('dsh-computer-use-win: diagnostics export failed: %s', error?.message ?? error); }
      if (result?.cancelled) { sendJson(response, 200, { ok: false, cancelled: true }); return; }
      let opened;
      try { opened = await open(result ?? {}); }
      catch (error) { logger?.warn?.('dsh-computer-use-win: could not open the diagnostics: %s', error?.message ?? error); }
      sendJson(response, result ? 200 : 500, { ok: Boolean(result), fileName: result?.fileName, filePath: result?.file, ...opened });
    } finally { running = false; }
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
