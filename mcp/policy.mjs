import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {realpathSync, readFileSync, statSync, openSync, writeFileSync, closeSync, unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {atomicJson} from './takeover.mjs';
import {formatText, overlayStrings, systemLocale} from './overlay-strings.mjs';

const short = name => String(name ?? '').replace(/^(?:mcp__[^_]+__|web:)?windows_computer_use_/, '');
export const isWincuTool = name => /^(?:mcp__[^_]+__|web:)?windows_computer_use_[a-z_]+$/.test(name);
export const parseArguments = value => {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' ? value : {};
};
const list = value => String(value ?? '').split('|').map(x => x.trim()).filter(Boolean);
const absolute = value => path.isAbsolute(value) || path.win32.isAbsolute(value);
const unc = value => {
  const text = String(value ?? '').trim();
  return /^(?:[\\/]{2}|[\\/]\?[\\/])/.test(text) || /^file:\/\/(?!\/|localhost(?:\/|$))/i.test(text);
};
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const verdict = (kind, reason, displayReason = reason) => ({kind, reason, displayReason});

const ALLOWED_NAV_SCHEMES = new Set(['http:', 'https:', 'file:', 'about:', 'data:']);
const BLOCKED_SCRIPT_OR_INTERNAL_SCHEMES = new Set([
  'javascript:', 'blob:', 'vbscript:', 'filesystem:',
  'chrome:', 'chrome-untrusted:', 'edge:', 'devtools:', 'view-source:',
  'about:config', 'moz-extension:'
]);
const SHORTHAND_HOST_URL = /^[\w-]+(\.[\w-]+)+(?::\d+)?(?:[/?#]\S*)?$/;
function coerceNavUrl(value) {
  const text = String(value ?? '').trim();
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text) && SHORTHAND_HOST_URL.test(text)) return `https://${text}`;
  return text;
}

function ipv4Octets(host) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split('.').map(Number);
  return parts.every(n => n >= 0 && n <= 255) ? parts : null;
}

function expandIpv6(raw) {
  let host = String(raw).toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!host.includes(':')) return null;
  const lastColon = host.lastIndexOf(':');
  const tail = host.slice(lastColon + 1);
  let tailGroups = null;
  if (tail.includes('.')) {
    const v4 = ipv4Octets(tail);
    if (!v4) return null;
    tailGroups = [((v4[0] << 8) | v4[1]).toString(16), ((v4[2] << 8) | v4[3]).toString(16)];
    host = host.slice(0, lastColon);
  }
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const suffix = tailGroups ? [...right, ...tailGroups] : right;
  const missing = 8 - (left.length + suffix.length);
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...suffix];
  if (groups.length !== 8 || !groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map(g => parseInt(g, 16));
}

function classifyHost(rawHost) {
  const host = String(rawHost ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '').replace(/\.+$/, '');
  const metadata =
    host === 'metadata' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.metadata.google.internal') ||
    host === 'metadata.goog' ||
    host === 'instance-data';
  let local = host === 'localhost' || host.endsWith('.localhost');
  const checkV4 = o => ({
    local: o[0] === 127 || o[0] === 0,
    metadata: (o[0] === 169 && o[1] === 254) || (o[0] === 100 && o[1] === 100 && o[2] === 100 && o[3] === 200)
  });
  const v4 = ipv4Octets(host);
  if (v4) {
    const r = checkV4(v4);
    return {host, local: local || r.local, metadata: metadata || r.metadata};
  }
  const g = expandIpv6(host);
  if (g) {
    const zero5 = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
    const isUnspecified = zero5 && g[5] === 0 && g[6] === 0 && g[7] === 0;
    const isLoopback6 = zero5 && g[5] === 0 && g[6] === 0 && g[7] === 1;
    const isAwsImds6 = g[0] === 0xfd00 && g[1] === 0x0ec2 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 && g[6] === 0 && g[7] === 0x0254;
    const isLinkLocal6 = (g[0] & 0xffc0) === 0xfe80;
    if (isUnspecified || isLoopback6) local = true;
    let meta6 = metadata || isAwsImds6 || isLinkLocal6;
    const isMapped = zero5 && g[5] === 0xffff;
    const isCompat = zero5 && g[5] === 0 && !(g[6] === 0 && g[7] <= 1);
    const isNat64 = g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
    if (isMapped || isCompat || isNat64) {
      const r = checkV4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
      if (r.local) local = true;
      if (r.metadata) meta6 = true;
    }
    return {host, local, metadata: meta6};
  }
  return {host, local, metadata};
}

let cachedHostPortFile;
const browserPrivateEnv = new Set(['WCU_APPROVAL_SECRET','WCU_APPROVAL_LEDGER','WCU_INPUT_MARKER','WCU_CANCEL_EVENT','WCU_READY_EVENT','__COMPAT_LAYER']);

export function browserChildEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key])=>!browserPrivateEnv.has(key.toUpperCase())));
}

function readHostPorts(env = process.env) {
  const ports = list(env.WCU_HOST_PORTS);
  let pending = false;
  const portFile = env.WCU_HOST_PORT_FILE;
  if (portFile) {
    let stat;
    try { stat = statSync(portFile, {bigint: true}); }
    catch { throw Error('WCU_POLICY_UNAVAILABLE: host address policy could not be read.'); }
    if (cachedHostPortFile && cachedHostPortFile.file === portFile && cachedHostPortFile.ino === stat.ino && cachedHostPortFile.mtimeNs === stat.mtimeNs && cachedHostPortFile.size === stat.size) {
      if (cachedHostPortFile.ports.length) ports.push(...cachedHostPortFile.ports);
      return {ports, pending: false};
    }
    let state;
    try { state = JSON.parse(readFileSync(portFile, 'utf8')); }
    catch { throw Error('WCU_POLICY_UNAVAILABLE: host address policy could not be read.'); }
    const filePorts = Array.isArray(state?.ports) ? state.ports.map(String) : [];
    pending = Boolean(state?.pending);
    cachedHostPortFile = pending ? undefined : {file: portFile, ino: stat.ino, mtimeNs: stat.mtimeNs, size: stat.size, ports: filePorts};
    if (filePorts.length) ports.push(...filePorts);
  }
  return {ports, pending};
}

function readUserTabs(env = process.env) {
  if (!env.WCU_USER_TABS_FILE) return {};
  try {
    const parsed = JSON.parse(readFileSync(env.WCU_USER_TABS_FILE, 'utf8'));
    return parsed?.tabs && typeof parsed.tabs === 'object' ? parsed.tabs : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw Error('WCU_POLICY_UNAVAILABLE: user tab approval state could not be read.');
  }
}

export function canonicalizeBrowserUrl(value) {
  const url = new URL(coerceNavUrl(value));
  const scheme = url.protocol.toLowerCase();
  const {host, local, metadata} = classifyHost(url.hostname);
  const defaultPort = scheme === 'https:' || scheme === 'wss:' ? '443' : (scheme === 'http:' || scheme === 'ws:' ? '80' : '');
  const effectivePort = url.port || defaultPort;
  return {url, scheme, host, local, metadata, effectivePort};
}

export function isBlockedRuntimeRequestUrl(value, env = process.env, options) {
  if (options === undefined && ['env','hostPortFile','isNavigation','allowLocalFile','approvedFileUrl','checkFileRoots'].some(key=>Object.hasOwn(env,key))) {
    options=env;
    env=options.env ?? process.env;
  }
  const {isNavigation=false,allowLocalFile=false,approvedFileUrl,checkFileRoots=false,hostPortFile}=options??{};
  if (hostPortFile) env={...env,WCU_HOST_PORT_FILE:hostPortFile};
  let info;
  try {
    info = canonicalizeBrowserUrl(value);
  } catch {
    return {blocked: true, reason: 'WCU_POLICY_DENIED: invalid request URL.'};
  }
  const {url, scheme, host, local, metadata, effectivePort} = info;
  if (scheme === 'about:') {
    const href = url.href.toLowerCase();
    if (href === 'about:blank' || href === 'about:srcdoc') return {blocked: false};
    return {blocked: true, reason: 'WCU_POLICY_DENIED: internal browser about URLs are blocked.'};
  }
  if (scheme === 'file:') {
    if (host && host !== 'localhost') return {blocked: true, reason: 'WCU_POLICY_DENIED: network file URLs are blocked.'};
    let file;
    try { file=localFilePath(url); }
    catch { return {blocked:true,reason:'WCU_POLICY_DENIED: invalid or network file URL.'}; }
    if (allowLocalFile || (approvedFileUrl && canonicalFileUrl(url)===canonicalFileUrl(approvedFileUrl)) ||
        (checkFileRoots && inRoots(file,list(env.WCU_ALLOWED_FILE_ROOTS)))) return {blocked:false};
    return {blocked: true, reason: 'WCU_POLICY_DENIED: unapproved file URL navigation is blocked.'};
  }
  if (scheme === 'data:' || (!isNavigation && ['blob:','chrome-extension:','extension:'].includes(scheme))) return {blocked: false};
  if (BLOCKED_SCRIPT_OR_INTERNAL_SCHEMES.has(scheme) || (isNavigation && !ALLOWED_NAV_SCHEMES.has(scheme)) || !['http:', 'https:', 'ws:', 'wss:'].includes(scheme)) {
    return {blocked: true, reason: `WCU_POLICY_DENIED: ${scheme} URLs are blocked.`};
  }
  if (metadata) return {blocked: true, reason: 'WCU_POLICY_DENIED: cloud metadata addresses are blocked.'};
  if (local) {
    const {ports, pending} = readHostPorts(env);
    if (pending) throw Error('WCU_POLICY_UNAVAILABLE: host address policy is starting.');
    if (ports.includes(effectivePort)) return {blocked: true, reason: 'WCU_POLICY_DENIED: this address belongs to the DSH host.'};
  }
  return {blocked: false};
}

function localFilePath(url) {
  const decoded=decodeURIComponent(url.pathname);
  if ((url.hostname && url.hostname!=='localhost') || decoded.startsWith('//') || /[\\\x00]/.test(decoded)) {
    throw new Error('WCU_POLICY_DENIED: invalid or network file URL.');
  }
  const file=fileURLToPath(url);
  return process.platform === 'win32' ? file : file.replace(/^\/([A-Za-z]:\/)/,'$1');
}

export const canonicalFileUrl = value => {
  const parsed = new URL(String(value));
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/^\/[A-Za-z]:/, m => m.toLowerCase());
  return parsed.href;
};

const normalizeUploadPath = value => {
  const resolved = path.win32.resolve(String(value).trim());
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const isConnectId = id => /^(?:web:)?b[0-9a-z]+:connect$/i.test(String(id ?? ''));
const isNavId = id => /(?:^|:)(?:new-tab|address)$/.test(String(id ?? ''));
const isPageId = id => /^(?:web:)?(?:t[a-z0-9]+:|page:)/i.test(String(id ?? ''));
const targetTabKey = args => {
  if (!args || typeof args !== 'object') return '';
  const raw = typeof args.browserTab === 'string' && args.browserTab
    ? args.browserTab
    : (/^(?:web:)?(t[0-9a-z]+):/i.exec(String(args.elementId ?? ''))?.[1] ?? '');
  return raw.replace(/^web:/i, '').toLowerCase();
};
const uploadFilesOf = value => String(value ?? '').split(/\r?\n|\|/).map(x => x.trim()).filter(Boolean);
const existingLocalFile = file => {
  const text = String(file ?? '').trim();
  if (!text || text.includes('\0') || unc(text)) return false;
  if (!absolute(text)) return false;
  try { return statSync(text).isFile(); } catch { return false; }
};
const isLnkTarget = value => /\.lnk$/i.test(String(value ?? '').trim().replace(/[. ]+$/, ''));
// The backend's list (Invoke-LaunchApp): these run the commands in their
// arguments and are refused with arguments even after an approval, so asking
// the user first would show a prompt whose answer cannot matter.
const COMMAND_HOSTS = new Set(['cmd', 'powershell', 'pwsh', 'wt', 'wsl', 'bash', 'sh', 'conhost', 'wscript', 'cscript', 'mshta', 'rundll32', 'regsvr32', 'msiexec', 'forfiles', 'schtasks', 'pcalua', 'ftp', 'python', 'pythonw', 'node', 'deno', 'bun', 'perl', 'ruby', 'php']);
const commandHostName = (target, env) => {
  let expanded = String(target ?? '').trim().replace(/^"|"$/g, '').replace(/%([^%]+)%/g, (whole, name) => env?.[name] ?? process.env[name] ?? whole);
  if (absolute(expanded) && !unc(expanded)) {
    try { expanded=(realpathSync.native??realpathSync)(expanded); } catch {}
  }
  const name = path.win32.basename(expanded).split(':',1)[0].replace(/[. ]+$/, '').replace(/\.(?:exe|com)$/i, '').toLowerCase();
  return COMMAND_HOSTS.has(name) ? name : null;
};
const launchKey = args => `${String(args.target ?? '').trim().toLowerCase()}\0${String(args.arguments ?? '').trim()}`;

export function classifyOperation(name, args = {}, env = process.env, locale = env?.WCU_LOCALE || systemLocale(), seenTabs) {
  const action = short(name);
  const strings = overlayStrings(locale);
  const tabAsk = (operationArgs, seen) => {
    const tabKey = targetTabKey(operationArgs);
    if (!tabKey || (seen && seen.has(tabKey))) return null;
    const entry = readUserTabs(env)[tabKey];
    if (!entry || !entry.requiresApproval || entry.approved) return null;
    if (seen) seen.add(tabKey);
    const label = entry.label || entry.origin || tabKey;
    return verdict('ask', 'WCU_APPROVAL_REQUIRED: accessing this existing browser tab requires approval.', formatText(strings.approveUserTab, label));
  };
  if (action === 'batch') {
    const asks = [];
    const tabs = seenTabs ?? new Set();
    const topTabAsk = tabAsk(args, tabs);
    if (topTabAsk) asks.push(topTabAsk);
    for (const step of Array.isArray(args.steps) ? args.steps : []) {
      if (!step || typeof step !== 'object') continue;
      const stepArgs = {...args, ...(step.arguments && typeof step.arguments === 'object' ? step.arguments : {}), steps: undefined};
      const next = classifyOperation(step.action, stepArgs, env, locale, tabs);
      if (next.kind === 'deny') return next;
      if (next.kind === 'ask') asks.push(next);
    }
    if (asks.length) return verdict('ask', 'WCU_APPROVAL_REQUIRED: this batch includes sensitive operations.', asks.map(x => x.displayReason).join('\n\n'));
    return verdict('allow');
  }
  const userTabNeed = tabAsk(args, seenTabs);
  if (action === 'launch_app') {
    if (unc(args.target) || unc(args.workingDirectory)) return verdict('deny', 'WCU_POLICY_DENIED: network application paths are not supported.');
    const argText = String(args.arguments ?? '').trim();
    const commandHost = argText ? commandHostName(args.target, env) : null;
    if (commandHost) return verdict('deny', `LAUNCH_COMMAND_REFUSED: ${commandHost} runs the commands in its arguments. launch_app starts command interpreters and script hosts only without arguments; run commands with DSH's own shell tool.`);
    if (argText || isLnkTarget(args.target)) {
      const prompt = argText
        ? formatText(strings.approveLaunchArgs, String(args.target ?? ''), argText)
        : formatText(strings.approveLaunch, String(args.target ?? ''));
      const reason = argText
        ? 'WCU_APPROVAL_REQUIRED: launching an application with arguments requires approval.'
        : 'WCU_APPROVAL_REQUIRED: launching a shortcut (.lnk) requires approval.';
      return verdict('ask', reason, prompt);
    }
  }
  if (action === 'set_value') {
    if (isConnectId(args.elementId)) return verdict('ask', 'WCU_APPROVAL_REQUIRED: connecting a personal browser requires approval.', strings.approveConnectBrowser);
    if (isNavId(args.elementId)) {
      let urlDecision;
      try { urlDecision = classifyUrl(args.value, env, locale); } catch (error) { if (error.code === 'ERR_INVALID_URL') return userTabNeed ?? verdict('allow'); throw error; }
      if (urlDecision.kind === 'deny') return urlDecision;
      if (urlDecision.kind === 'ask' && userTabNeed) return verdict('ask', userTabNeed.reason, `${userTabNeed.displayReason}\n\n${urlDecision.displayReason}`);
      if (urlDecision.kind === 'ask') return urlDecision;
      return userTabNeed ?? urlDecision;
    }
    const files = uploadFilesOf(args.value);
    if (files.some(unc)) return verdict('deny', 'WCU_POLICY_DENIED: network file paths are not supported.');
    if (files.length && files.every(existingLocalFile) && isPageId(args.elementId)) {
      const uploadVerdict = verdict('ask', 'WCU_APPROVAL_REQUIRED: sending local files to a page requires approval.', formatText(strings.approveUpload, files.join('\n')));
      return userTabNeed ? verdict('ask', userTabNeed.reason, `${userTabNeed.displayReason}\n\n${uploadVerdict.displayReason}`) : uploadVerdict;
    }
  }
  return userTabNeed ?? verdict('allow');
}

function classifyUrl(value, env = process.env, locale = env?.WCU_LOCALE || systemLocale()) {
  const {url, scheme, host, local, metadata, effectivePort} = canonicalizeBrowserUrl(value);
  if (!ALLOWED_NAV_SCHEMES.has(scheme)) return verdict('deny', `WCU_POLICY_DENIED: ${scheme} URLs are blocked.`);
  if (scheme === 'about:') {
    if (url.href.toLowerCase() === 'about:blank') return verdict('allow');
    return verdict('deny', 'WCU_POLICY_DENIED: internal browser about URLs are blocked.');
  }
  if (metadata) return verdict('deny', 'WCU_POLICY_DENIED: cloud metadata addresses are blocked.');
  if (local) {
    const {ports, pending} = readHostPorts(env);
    if (pending) throw Error('WCU_POLICY_UNAVAILABLE: host address policy is starting.');
    if (ports.includes(effectivePort)) return verdict('deny', 'WCU_POLICY_DENIED: this address belongs to the DSH host.');
  }
  if (scheme === 'file:') {
    if (host && host !== 'localhost') return verdict('deny', 'WCU_POLICY_DENIED: network file URLs are blocked.');
    if (process.platform === 'win32') {
      try { if (unc(fileURLToPath(url))) return verdict('deny', 'WCU_POLICY_DENIED: network file URLs are blocked.'); }
      catch { return verdict('deny', 'WCU_POLICY_DENIED: invalid file URL.'); }
    }
    return verdict('ask', 'WCU_APPROVAL_REQUIRED: reading a local file in a browser requires approval.', formatText(overlayStrings(locale).approveOpenFile, url.href));
  }
  return verdict('allow');
}

const inRoots = (file, roots) => roots.some(root => {
  try { file = realpathSync(file); root = realpathSync(root); } catch { return false; }
  const impl = /^[a-z]:/i.test(file) || /^[a-z]:/i.test(root) ? path.win32 : path;
  const relative = impl.relative(impl.resolve(root), impl.resolve(file));
  return relative === '' || (!relative.startsWith('..' + impl.sep) && relative !== '..' && !impl.isAbsolute(relative));
});

export function collectApprovalRequirements(name, args = {}, env = process.env) {
  const reqs = {
    launches: new Set(),
    fileUrls: new Set(),
    uploads: new Set(),
    connectTargets: new Set(),
    userTabs: new Set()
  };
  const visit = (opName, opArgs) => {
    if (!opArgs || typeof opArgs !== 'object') return;
    const action = short(opName);
    const tabKey = targetTabKey(opArgs);
    if (tabKey) reqs.userTabs.add(tabKey);
    if (action === 'batch') {
      for (const step of Array.isArray(opArgs.steps) ? opArgs.steps : []) {
        if (!step || typeof step !== 'object') continue;
        visit(step.action, {...opArgs, ...(step.arguments && typeof step.arguments === 'object' ? step.arguments : {}), steps: undefined});
      }
      return;
    }
    if (action === 'launch_app') {
      if (String(opArgs.arguments ?? '').trim() || isLnkTarget(opArgs.target)) {
        reqs.launches.add(launchKey(opArgs));
      }
      return;
    }
    if (action === 'set_value') {
      if (isConnectId(opArgs.elementId)) {
        reqs.connectTargets.add(String(opArgs.elementId).toLowerCase());
        return;
      }
      if (isNavId(opArgs.elementId)) {
        try {
          const parsed = new URL(coerceNavUrl(opArgs.value));
          if (parsed.protocol.toLowerCase() === 'file:') reqs.fileUrls.add(canonicalFileUrl(parsed.href));
        } catch {}
        return;
      }
      const files = uploadFilesOf(opArgs.value);
      if (files.length && isPageId(opArgs.elementId) && !files.some(unc) && files.every(existingLocalFile)) {
        for (const file of files) reqs.uploads.add(normalizeUploadPath(file));
      }
    }
  };
  visit(name, args);
  return reqs;
}

export function assertBrowserUrl(value, {env = process.env, approved = false, approvedFileUrl, grants} = {}) {
  const decision = classifyUrl(value, env);
  if (decision.kind === 'deny') throw Error(decision.reason);
  if (decision.kind === 'ask') {
    const url = new URL(String(value));
    const file = localFilePath(url);
    const canonical = canonicalFileUrl(url.href);
    const granted = approved || grants?.fileUrls?.has(canonical) || (approvedFileUrl && canonical === canonicalFileUrl(approvedFileUrl));
    if (!granted && !inRoots(file, list(env.WCU_ALLOWED_FILE_ROOTS))) throw Error(decision.reason);
  }
  return value;
}

export function assertUpload(files, {env = process.env, approved = false, grants} = {}) {
  if (files.some(unc)) throw Error('WCU_POLICY_DENIED: network upload paths are blocked.');
  const allGranted = grants?.uploads && files.length > 0 && files.every(file => grants.uploads.has(normalizeUploadPath(file)));
  if (!approved && !allGranted && !files.every(file => inRoots(file, list(env.WCU_ALLOWED_UPLOAD_ROOTS)))) {
    throw Error('WCU_APPROVAL_REQUIRED: uploading local files requires approval.');
  }
}

function assertTabApproved(tabKey, userTabs, approved, grants) {
  if (!tabKey) return;
  const entry = userTabs[tabKey];
  if (entry?.requiresApproval && !entry.approved && !approved && !grants?.userTabs?.has(tabKey)) {
    throw Error('WCU_APPROVAL_REQUIRED: accessing this existing browser tab requires approval.');
  }
}

export function assertOperation(name, args, {env = process.env, approved = false, grants, _userTabs} = {}) {
  const action = short(name);
  const getUserTabs = () => _userTabs ?? (_userTabs = readUserTabs(env));
  if (action === 'batch') {
    const top = classifyOperation('batch', args, env);
    if (top.kind === 'deny') throw Error(top.reason);
    const topTab = targetTabKey(args);
    if (topTab) assertTabApproved(topTab, getUserTabs(), approved, grants);
    for (const step of Array.isArray(args?.steps) ? args.steps : []) {
      if (!step || typeof step !== 'object') continue;
      assertOperation(step.action, {...args, ...(step.arguments && typeof step.arguments === 'object' ? step.arguments : {}), steps: undefined}, {env, approved, grants, _userTabs});
    }
    return;
  }
  const decision = classifyOperation(name, args, env);
  if (decision.kind === 'deny') throw Error(decision.reason);
  if (decision.kind === 'ask' && !approved) {
    const tabKey = targetTabKey(args);
    if (tabKey) assertTabApproved(tabKey, getUserTabs(), false, grants);
    if (action === 'launch_app') {
      if (grants?.launches?.has(launchKey(args)) || env.WCU_ALLOW_LAUNCH_ARGUMENTS === '1' || list(env.WCU_ALLOWED_LAUNCH_PROGRAMS).some(p => p.toLowerCase() === String(args.target).toLowerCase())) return;
      throw Error(decision.reason);
    }
    if (action === 'set_value' && isConnectId(args.elementId)) {
      if (grants?.connectTargets?.has(String(args.elementId).toLowerCase()) || !env.WCU_APPROVAL_SECRET) return;
      throw Error(decision.reason);
    }
    if (action === 'set_value' && isNavId(args.elementId)) {
      assertBrowserUrl(args.value, {env, grants});
      return;
    }
    if (action === 'set_value') {
      const files = uploadFilesOf(args.value);
      if (files.length && files.every(existingLocalFile) && isPageId(args.elementId)) {
        assertUpload(files, {env, grants});
        return;
      }
      return;
    }
    if (tabKey) return;
    throw Error(decision.reason);
  }
}

// A grant exists only after DSH has passed its approval gate. It is bound to
// this call's exact arguments, expires quickly and is consumed once by MCP.
export function mintGrant(name, args, secret, now = Date.now()) {
  const body = {name: short(name), args, nonce: randomUUID(), expires: now + 120000};
  const payload = Buffer.from(stable(body)).toString('base64url');
  return payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
}
function reserveNonce(file, nonce, expires, now) {
  const lock = file + '.lock'; let handle;
  const unavailable = () => Object.assign(Error('WCU_APPROVAL_STATE_UNAVAILABLE: approval state is busy or unavailable; no action was executed.'), {code: 'WCU_APPROVAL_STATE_UNAVAILABLE'});
  try {
    // Do not reclaim a stale lock: two recovering workers could otherwise
    // unlink each other's newly acquired lock. Reloading the host adapter
    // creates a fresh control directory and secret after an interrupted write.
    handle = openSync(lock, 'wx');
    writeFileSync(handle, JSON.stringify({marker: 'wcu-approval', pid: process.pid}));
    let entries = [];
    try { entries = JSON.parse(readFileSync(file, 'utf8')).used; } catch (error) { if (error.code !== 'ENOENT') throw unavailable(); }
    if (!Array.isArray(entries) || entries.some(item => !Array.isArray(item) || typeof item[0] !== 'string' || !Number.isFinite(item[1]))) throw unavailable();
    entries = entries.filter(item => item[1] >= now);
    if (entries.some(item => item[0] === nonce)) return false;
    entries.push([nonce, expires]); atomicJson(file, {used: entries}); return true;
  } catch (error) { if (error.code === 'WCU_APPROVAL_STATE_UNAVAILABLE') throw error; throw unavailable(); }
  finally { if (handle !== undefined) { closeSync(handle); try { unlinkSync(lock); } catch {} } }
}
export function consumeGrant(token, name, args, secret, used, now = Date.now(), registryFile) {
  if (!secret || typeof token !== 'string') return false;
  try {
    const [payload, signature, extra] = token.split('.');
    if (extra !== undefined || !payload || !signature) return false;
    const want = createHmac('sha256', secret).update(payload).digest();
    const got = Buffer.from(signature, 'base64url');
    if (got.length !== want.length || !timingSafeEqual(want, got)) return false;
    const body = JSON.parse(Buffer.from(payload, 'base64url'));
    if (!Number.isFinite(body.expires) || typeof body.nonce !== 'string' || !body.nonce || body.expires < now || body.expires > now + 125000 || body.name !== short(name)) return false;
    for (const [nonce, expires] of used) if (expires < now) used.delete(nonce);
    if (used.has(body.nonce) || stable(body.args) !== stable(args)) return false;
    if (registryFile && !reserveNonce(registryFile, body.nonce, body.expires, now)) return false;
    used.set(body.nonce, body.expires);
    return true;
  } catch (error) { if (error.code === 'WCU_APPROVAL_STATE_UNAVAILABLE') throw error; return false; }
}

// DSH's "full access" preset: no approval prompts (policy never) and no file
// sandbox. DSH rejects every approval request under policy never, so asking
// would only break these operations for a user who chose not to be asked,
// in a session whose shell tool can already run any command. Restricted
// presets with policy never still get the ask, which DSH then rejects.
export function sessionSkipsApproval(ctx, exec) {
  const session = exec?.agent?.session;
  if (!session) return false;
  try {
    const approval = ctx.get('approval'), sandbox = ctx.get('sandboxPolicy');
    if (typeof approval?.effectivePolicy !== 'function' || typeof sandbox?.resolve !== 'function') return false;
    return approval.effectivePolicy(session) === 'never' && sandbox.resolve({session}).mode === 'danger-full-access';
  } catch { return false; }
}

export function installHostPolicy(ctx, runtime) {
  const gated = new WeakMap();
  const env = () => ({
    ...(runtime.usesGuestLoopback?.() ? {} : {
      WCU_HOST_PORTS: (runtime.hostPorts ?? []).join('|'),
      WCU_HOST_PORT_FILE: runtime.hostPortFile,
    }),
    WCU_USER_TABS_FILE: runtime.userTabsFile,
    WCU_LOCALE: runtime.getLocale?.() ?? runtime.locale ?? systemLocale()
  });
  const disposePreExecute = ctx.on('tools/pre-execute', async (exec, next) => {
    if (!isWincuTool(exec.name)) return next();
    if (runtime.desktopRoutePending?.()) return verdict('deny', 'WCU_DESKTOP_SWITCHING: wait for the chosen desktop to connect before running Computer Use again.');
    const args = parseArguments(exec.arguments);
    if (Object.hasOwn(args, '_wcuApproval')) return verdict('deny', 'WCU_POLICY_DENIED: approval credentials cannot be supplied by a tool caller.');
    const currentEnv = env();
    const decision = classifyOperation(exec.name, args, currentEnv, currentEnv.WCU_LOCALE);
    if (decision.kind === 'ask') gated.set(exec, stable(args));
    if (decision.kind === 'deny') return decision;
    const downstream = await next();
    if (decision.kind !== 'ask' || downstream.kind !== 'allow') return downstream;
    // The grant is still minted in tools/execute, bound to these arguments.
    return sessionSkipsApproval(ctx, exec) ? downstream : decision;
  }, {global: true});
  ctx.on('tools/execute', async (exec, next) => {
    if (!gated.has(exec)) return next();
    const approvedArguments = gated.get(exec);
    gated.delete(exec);
    const previous = exec.arguments;
    const args = parseArguments(previous);
    if (stable(args) !== approvedArguments) throw Error('WCU_APPROVAL_REQUIRED: arguments changed after the approval request.');
    exec.arguments = {...args, _wcuApproval: mintGrant(exec.name, args, runtime.approvalSecret)};
    try { return await next(); } finally { exec.arguments = previous; }
  }, {global: true});
  return {disposePreExecute};
}
