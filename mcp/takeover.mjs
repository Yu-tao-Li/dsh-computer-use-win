import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings.mjs';
import { helperStrings, indicatorText, overlayLocale, overlayStrings, systemLocale } from './overlay-strings.mjs';
import { RpcFramer } from './protocol.mjs';

export const STOPPED = 'COMPUTER_USE_STOPPED_BY_USER: Stopped by user (Esc or custom shortcut). Do not retry desktop input in this turn; the next user turn resumes automatically with no settings change needed.';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAX_BLOCKED_SERIES = 32;
async function readControl(file) {
  for (let attempt = 0; ; attempt++) {
    try { return JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) {
      if (!BUSY_CODES.has(error.code) || attempt >= 4) throw error;
      await sleep(10 * (attempt + 1));
    }
  }
}
const helperScript = fileURLToPath(new URL('../scripts/windows-takeover.ps1', import.meta.url));
// Child processes start in the user's home folder, never inside this package.
// A process whose working folder is inside the plugin (or one of its child
// folders) keeps the plugin market from replacing the package, and a failed
// replacement can cost the plugin its place in the profile (update-guard.mjs).
export const WORK_DIR = os.homedir();
export const DEFAULT_POWERSHELL=process.platform==='win32'
  ? path.win32.join(process.env.SystemRoot||process.env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe')
  : 'powershell.exe';

// WSL (#79): DSH and this server can run inside WSL and reach powershell.exe
// through interop. A Windows process resolves a Linux path such as
// /home/me/x.ps1 against its own current drive, so started from /mnt/c it
// looked for C:\home\me\x.ps1. Scripts therefore get their Windows form
// (wslpath -w), Windows paths in results get their Linux form for DSH's file
// tools, and a variable set here reaches a Windows process only when WSLENV
// names it.
const readText = file => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
export const IN_WSL = process.platform === 'linux' && (!!process.env.WSL_DISTRO_NAME || !!process.env.WSL_INTEROP || /microsoft/i.test(readText('/proc/sys/kernel/osrelease')));
const wslpath = (flag, file) => execFileSync('wslpath', [flag, file], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
export function windowsPath(file, { wsl = IN_WSL, distro = process.env.WSL_DISTRO_NAME, convert = wslpath } = {}) {
  if (!wsl || typeof file !== 'string' || !file.startsWith('/')) return file;
  try { const converted = convert('-w', file); if (converted) return converted; } catch { }
  const drive = /^\/mnt\/([a-z])(?=\/|$)(.*)$/i.exec(file);
  if (drive) return `${drive[1].toUpperCase()}:${(drive[2] || '/').replaceAll('/', '\\')}`;
  return distro ? `\\\\wsl.localhost\\${distro}${file.replaceAll('/', '\\')}` : file;
}
export function linuxPath(file, { wsl = IN_WSL, convert = wslpath } = {}) {
  if (!wsl || typeof file !== 'string' || !/^[A-Za-z]:[\\/]/.test(file)) return file;
  try { const converted = convert('-u', file); if (converted) return converted; } catch { }
  return `/mnt/${file[0].toLowerCase()}${file.slice(2).replaceAll('\\', '/')}`;
}
// The variables named here reach Windows processes as they are (/w: only
// when WSL starts a Windows process; /u would mean the other way round).
export function windowsEnv(env, names, { wsl = IN_WSL } = {}) {
  if (!wsl) return env;
  const shared = String(env.WSLENV ?? '').split(':').filter(Boolean);
  const listed = new Set(shared.map(item => item.split('/')[0]));
  for (const name of names) if (!listed.has(name)) shared.push(name + '/w');
  return { ...env, WSLENV: shared.join(':') };
}
const windowsScripts = new Map();
export function windowsScript(file) {
  if (!windowsScripts.has(file)) windowsScripts.set(file, windowsPath(file));
  return windowsScripts.get(file);
}
// What "Open overlay to adjust" shows: the same layout as a real run.
export function previewProgress(locale) {
  const words = overlayStrings(locale), scroll = words.labels.scroll[0];
  return { step: 2, status: 'acting', tool: 'scroll', action: scroll, steps: [
    { step: 1, actions: [{ label: words.newTab, state: 'done' }], reasoning: words.previewFirst, reply: '' },
    { step: 2, actions: [{ label: scroll, state: 'running' }], reasoning: words.previewSecond, reply: '' }] };
}

// Windows refuses to replace a file that another process holds open without
// delete sharing (a reader, an antivirus scan) for a moment, with EPERM, EACCES
// or EBUSY. Retry the replace briefly, as graceful-fs does for rename on win32.
const BUSY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
function pause(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const end = Date.now() + ms; while (Date.now() < end) { } }
}
function replaceFile(from, to) {
  for (let delay = 10, waited = 0; ; delay = Math.min(delay * 2, 100)) {
    try { renameSync(from, to); return; }
    catch (error) {
      if (!BUSY_CODES.has(error?.code) || waited >= 1000) throw error;
      pause(delay); waited += delay;
    }
  }
}

const ensuredDirs = new Set();
const wellFormedReplacer = (_key, item) => typeof item === 'string' ? item.toWellFormed() : item;
const serializeJsonLine = value => JSON.stringify(value, wellFormedReplacer) + '\n';
const statVersionKey = file => {
  const st = statSync(file, { bigint: true, throwIfNoEntry: false });
  return st ? `${st.mtimeNs}:${st.size}` : '';
};

export function atomicJson(file, value) {
  if (!file) return;
  const dir = path.dirname(file);
  if (!ensuredDirs.has(dir)) { mkdirSync(dir, { recursive: true }); ensuredDirs.add(dir); }
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    // A stream may temporarily end with half an emoji. Keep its original
    // buffer in memory, but send well-formed strings to the .NET JSON reader.
    writeFileSync(temporary, serializeJsonLine(value), 'utf8');
    replaceFile(temporary, file);
  } catch (error) {
    ensuredDirs.delete(dir);
    // This temporary file belongs to this failed write and has no further use.
    try { unlinkSync(temporary); } catch { }
    throw error;
  }
}

async function replaceFileAsync(from, to) {
  for (let delay = 10, waited = 0; ; delay = Math.min(delay * 2, 100)) {
    try { await rename(from, to); return; }
    catch (error) {
      if (!BUSY_CODES.has(error?.code) || waited >= 1000) throw error;
      await sleep(delay); waited += delay;
    }
  }
}

export async function atomicJsonAsync(file, value) {
  if (!file) return;
  const dir = path.dirname(file);
  if (!ensuredDirs.has(dir)) { await mkdir(dir, { recursive: true }); ensuredDirs.add(dir); }
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, serializeJsonLine(value), 'utf8');
    await replaceFileAsync(temporary, file);
  } catch (error) {
    ensuredDirs.delete(dir);
    try { await unlink(temporary); } catch { }
    throw error;
  }
}

export class TakeoverControl {
  constructor({ powershell = DEFAULT_POWERSHELL, onStop = () => {}, configFile = process.env.WCU_CONFIG_FILE,
    stateFile = process.env.WCU_STATE_FILE, activityFile=process.env.WCU_ACTIVITY_FILE,testMode = false, config = {}, locale } = {}) {
    this.powershell = powershell; this.onStop = onStop; this.configFile = configFile; this.stateFile = stateFile;
    // The overlay's language: the DSH interface language the host writes into
    // the activity file, unless a caller fixes one; standalone, the system's.
    this.fixedLocale = locale; this.locale = overlayLocale(locale ?? systemLocale());
    this.testMode = testMode; this.config = normalizeSettings(config); this.active = 0; this.shown = 0; this.paused = false;
    this.layoutFile=process.env.WCU_LAYOUT_FILE;
    this.layoutWrite=Promise.resolve();
    this.progressPreviewToken=this.config.progressPreviewToken;
    this.suppressedLingerKey=null;
    this.activityFile=activityFile;this.seriesHeld=false;this.seriesIndicator=false;this.seriesKey=null;this.stoppedSeriesKey=null;this.blockedSeries=new Map();
    this.eventName = `Local\\DSH-WCU-${randomUUID()}`; this.waiters = new Map(); this.nextId = 0;
    this.armedChild = null;
    this.resumeToken = this.config.resumeToken; this.previewToken = this.config.previewToken; this.pauseMessage = STOPPED;
    this.backgroundOnly = process.env.WCU_BACKGROUND_DESKTOP === '1';
    this.disabledForTest = process.env.NODE_ENV === 'test' && process.env.WCU_TEST_NO_TAKEOVER === '1';
    try {
      const saved = JSON.parse(readFileSync(this.stateFile, 'utf8'));
      this.paused = saved.paused === true;
      this.stoppedAt = saved.stoppedAt ?? 0;
      this.stopReported = saved.stopReported === true;
      this.pauseMessage = saved.pauseMessage ?? STOPPED;
      this.resumeToken = saved.resumeToken ?? this.resumeToken;
      this.stoppedSeriesKey=saved.stoppedSeriesKey??null;
      this.blockedSeries=new Map(Object.entries(saved.blockedSeries??(this.stoppedSeriesKey?{[this.stoppedSeriesKey]:this.pauseMessage}:{})).slice(-MAX_BLOCKED_SERIES));
      if (saved.active > 0) this.persist('previous-worker-ended');
    } catch (error) { if (this.stateFile && error.code !== 'ENOENT') throw error; }
    if (configFile||activityFile) {
      this.poll = setInterval(() => { this.sync().catch(error => this.presentationError(error)); }, 250);
      this.poll.unref();
    }
  }
  get helperDisabled() { return this.backgroundOnly || this.disabledForTest; }
  persist(reason) {
    const body = {
      pid: process.pid, paused: this.paused, active: this.active, seriesActive: this.seriesHeld, reason: reason ?? null,
      stoppedAt: this.stoppedAt ?? 0, stopReported: this.stopReported === true, stoppedSeriesKey: this.stoppedSeriesKey,
      blockedSeries: Object.fromEntries(this.blockedSeries), pauseMessage: this.paused ? this.pauseMessage : null,
    };
    const key = JSON.stringify(body);
    if (this.lastStateKey === key) return;
    try {
      atomicJson(this.stateFile, { ...body, updatedAt: new Date().toISOString() });
      this.lastStateKey = key;
    } catch (error) {
      this.lastStateKey = undefined;
      this.presentationError(error);
    }
  }
  presentationError(error) {
    if (Date.now() - (this.lastPresentationWarning ?? 0) < 10000) return;
    this.lastPresentationWarning = Date.now();
    process.stderr.write('Computer Use display/state update failed: ' + error.message + '\n');
  }
  async resumeOperation(clearScope=true){
    const child = this.child;
    if (child) {
      try { await this.command('resume'); }
      catch (error) { this.killHelper(error, child, { failIfActive: false }); }
    }
    this.paused=false;this.helperFailed=false;if(clearScope)this.stoppedSeriesKey=null;
    this.persist('new-operation');
  }
  sync() {
    // Each caller needs a read after its own config/turn update. Reusing an
    // in-flight read can otherwise apply the previous turn's stopped state.
    const pending=(this.syncing??Promise.resolve()).catch(()=>{}).then(()=>this.syncInner());
    this.syncing=pending;
    return pending.finally(()=>{if(this.syncing===pending)this.syncing=null;});
  }
  async syncInner() {
    if (this.closed) return;
    // One synchronous read each: an async read keeps the file open across
    // event-loop turns, and a writer in the same process (tests run the host's
    // publisher here) retrying its replace synchronously would wait it out.
    if (this.configFile) {
      const configKey = statVersionKey(this.configFile);
      if (!configKey || configKey !== this.configStatKey) {
        this.config = normalizeSettings(await readControl(this.configFile));
        this.configStatKey = configKey;
      }
    }
    if(this.activityFile){
      const activityKey = statVersionKey(this.activityFile);
      if (!activityKey || activityKey !== this.activityStatKey) {
        this.cachedActivity = await readControl(this.activityFile);
        this.activityStatKey = activityKey;
      }
      const activity = this.cachedActivity;
      if(this.fixedLocale===undefined&&typeof activity.locale==='string')this.locale=overlayLocale(activity.locale);
      const now = Date.now();
      const held=activity.active===true&&Number.isFinite(activity.expiresAt)&&activity.expiresAt>now;
      const key=held?JSON.stringify([activity.sessionId,activity.turn]):this.seriesKey;
      // A failure while this read is still under way belongs to this series:
      // blocking the previous one would let the next read resume and retry.
      this.syncKey=key;
      // A series of browser-lane calls is held for turn tracking but shows
      // nothing; the indicator starts with the series' first desktop call.
      const indicator=held&&activity.indicator!==false;
      // After the turn ends the overlay keeps showing its final state for a
      // short time; that holds no series, indicator or stop key.
      const turnKey=`${activity.sessionId??''}:${activity.turn??''}:${activity.progress?.startedAt??0}`;
      const rawLingering=!held&&!!activity.progress&&Number.isFinite(activity.lingerUntil)&&activity.lingerUntil>now;
      if(this.config.progressPreviewToken!==this.progressPreviewToken&&this.config.progressPreviewToken>0&&rawLingering)this.suppressedLingerKey=turnKey;
      const lingering=rawLingering&&turnKey!==this.suppressedLingerKey;
      const progressPayload={enabled:this.config.progressOverlayEnabled&&(held||lingering),turnKey,remoteIndicatorVisible:this.config.remoteIndicatorVisible,locale:this.locale,settings:this.config,progress:{...activity.progress,status:this.paused&&held?'stopped':activity.progress?.status??'waiting'}};
      const progress=JSON.stringify(progressPayload);
      // After the helper failed, the overlay does not start it again in this
      // series: the poll would launch PowerShell four times a second.
      if(!this.helperDisabled&&this.sentProgress!==progress&&(this.child||(!this.helperFailed&&this.config.progressOverlayEnabled&&(held||lingering)))){
        try { await this.command('progress',progressPayload);this.sentProgress=progress; }
        catch (error) { this.presentationError(error); }
      }
      if(held&&!this.blockedSeries.has(key)&&this.paused&&this.active===0)await this.resumeOperation();
      const changed=held!==this.seriesHeld||key!==this.seriesKey||indicator!==this.seriesIndicator;
      if(changed || (indicator && (!this.child || this.armedChild !== this.child))){
        this.seriesKey=key;
        this.seriesHeld=held;this.seriesIndicator=indicator;
        if(!this.paused&&!this.blockedSeries.has(key)&&!this.helperDisabled){
          try {
            if(indicator)await this.command('begin',this.config);
            else if(this.shown===0&&this.child)await this.command('end');
          } catch (error) { this.fail(error); throw error; }
        }
        this.persist();
      }
    }
    const presentation=JSON.stringify([this.config.indicatorEnabled,this.config.cursorIndicatorEnabled,this.config.remoteIndicatorVisible,this.config.indicatorText,this.config.desktopTarget==='fast',this.config.indicatorPosition,this.config.indicatorIdleMs,this.config.stopShortcut,this.locale]);
    if (this.child && this.sentPresentation!==presentation) {
      await this.command(((this.seriesHeld&&this.seriesIndicator)||this.shown>0)&&!this.paused&&!this.blockedSeries.has(this.seriesKey)?'begin':'configure', this.config);
      this.sentPresentation=presentation;
      this.sentShortcut = this.config.stopShortcut; this.sentCursorIndicator = this.config.cursorIndicatorEnabled;this.sentRemoteVisible=this.config.remoteIndicatorVisible;
    }
    if (this.config.previewToken !== this.previewToken) {
      this.previewToken = this.config.previewToken;
      if (!this.paused && this.active === 0 && !this.helperDisabled) await this.command('preview', this.config);
    }
    if(this.config.progressPreviewToken!==this.progressPreviewToken){
      this.progressPreviewToken=this.config.progressPreviewToken;
      if(!this.helperDisabled&&this.progressPreviewToken>0)try { await this.command('progress',{enabled:true,preview:true,settings:this.config,remoteIndicatorVisible:this.config.remoteIndicatorVisible,progress:previewProgress(this.locale)}); } catch(error) { this.presentationError(error); }
    }
  }
  // The helper's Windows process id, which the backend watches during input.
  // Under WSL the child's own pid is that of the interop process (#79).
  get helperProcessId() { return this.child ? (this.helperPid || this.child.pid || 0) : 0; }
  // Whether the user is in the middle of input-method text (pinyin typed, not
  // committed yet), from the stop listener's keyboard hook. Null while the
  // helper is not running: it has seen no keys.
  async composing() {
    if (this.helperDisabled || !this.child) return null;
    try { return (await this.command('input_state')).composing === true; } catch { return null; }
  }
  // A quiet lease (browser-lane calls) checks the stopped state and counts as an
  // action in progress, but neither shows the indicator nor arms the stop keys.
  // Quiet calls send no real input, so they need no stop listener: when the
  // listener failed (it did not start, or it exited), they keep working and
  // only real input stays refused. A stop by the user refuses everything (#79).
  async begin({ quiet = false } = {}) {
    // A read that found the helper failing has paused the series; the checks
    // below then decide.
    try { await this.sync(); } catch (error) { this.presentationError(error); }
    const refuses = message => !(quiet && message !== STOPPED);
    if(this.seriesHeld&&this.blockedSeries.has(this.seriesKey)&&refuses(this.blockedSeries.get(this.seriesKey)))throw new Error(this.blockedSeries.get(this.seriesKey));
    if(this.paused&&!this.activityFile&&this.active===0) {
      const userStopped = this.pauseMessage === STOPPED;
      const reported = this.stopReported === true;
      if(userStopped) { this.stopReported=true; this.persist('stop-reported'); }
      if(!userStopped || (reported && Date.now()-(this.stoppedAt??0)>=30000))await this.resumeOperation();
    }
    if (this.paused&&refuses(this.pauseMessage)) throw new Error(this.pauseMessage);
    if (this.closed) throw new Error('COMPUTER_USE_STOPPING');
    this.active++; if (!quiet) this.shown++;
    try { if (!quiet&&!this.helperDisabled&&(!this.child||this.armedChild!==this.child)) {
      try { await this.command('begin', this.config); this.sentShortcut = this.config.stopShortcut; this.sentCursorIndicator = this.config.cursorIndicatorEnabled;this.sentRemoteVisible=this.config.remoteIndicatorVisible; }
      catch (error) { this.fail(error); throw new Error(this.paused ? this.pauseMessage : error.message); }
    }
    if (this.paused&&refuses(this.pauseMessage)) throw new Error(this.pauseMessage);
    this.persist();
    } catch(error) { this.active=Math.max(0,this.active-1);if(!quiet)this.shown=Math.max(0,this.shown-1);this.persist();throw error; }
  }
  async end({ quiet = false } = {}) {
    this.active = Math.max(0, this.active - 1); if (!quiet) this.shown = Math.max(0, this.shown - 1); this.persist(this.paused ? 'stopped-by-user' : null);
    if (!quiet && this.shown === 0 && !(this.seriesHeld&&this.seriesIndicator)&&this.child && !this.paused) await this.command('end').catch(error => this.fail(error));
  }
  fail(error) {
    if (this.closed || this.paused) return;
    this.armedChild = null;
    this.paused = true;
    if(error?.message === STOPPED){this.stoppedAt=Date.now();this.stopReported=false;}
    const key=this.syncKey??this.seriesKey;
    this.stoppedSeriesKey=key;
    this.pauseMessage = error?.message === STOPPED ? STOPPED : `COMPUTER_USE_PAUSED: ${error?.message ?? error}. Desktop input is paused for this series (reading the screen and browser-lane calls still work). Do not retry desktop input in this turn; the next user turn reconnects automatically.`;
    if(key!==null){
      this.blockedSeries.set(key,this.pauseMessage);
      if(this.blockedSeries.size>MAX_BLOCKED_SERIES)this.blockedSeries.delete(this.blockedSeries.keys().next().value);
    }
    this.persist(String(error?.message ?? error));
    // This also covers a control-file or presentation failure while input runs.
    this.child?.stdin.write(serializeJsonLine({command:'cancel_input'})+serializeJsonLine({command:'stop'}),()=>{});
    this.onStop(new Error(this.pauseMessage));
  }
  killHelper(error, child = this.child, { failIfActive = true } = {}) {
    if (!child) return;
    const current = this.child === child;
    if (current) {
      this.child = null;
      this.armedChild = null;
      this.helperPid = 0;
      this.sentProgress = undefined;
      this.sentPresentation = undefined;
      this.helperFailed = true;
    }
    for (const [id,pending] of this.waiters) {
      if (pending.child !== child) continue;
      clearTimeout(pending.timer);
      this.waiters.delete(id);
      pending.reject(error);
    }
    if (child.exitCode === null && child.signalCode === null) child.kill();
    if (current && !this.closed && failIfActive) {
      if (this.shown > 0 || this.seriesIndicator) this.fail(error);
      else this.presentationError(error);
    }
  }
  async start() {
    if (this.starting) return this.starting;
    if (this.child) return;
    this.starting = new Promise((resolve, reject) => {
      let diagnostic = '', ready = false;
      this.helperPid = 0;
      const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', windowsScript(helperScript), '-CancelEvent', this.eventName];
      if (this.testMode) args.push('-TestMode');
      const helperEnv={...process.env};delete helperEnv.WCU_APPROVAL_SECRET;delete helperEnv.WCU_APPROVAL_LEDGER;
      const child = this.child = spawn(this.powershell, args, { cwd: WORK_DIR, env:windowsEnv(helperEnv,Object.keys(helperEnv).filter(name=>name.startsWith('WCU_'))), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      const startupFailure = error => {
        clearTimeout(deadline);
        reject(error);
        this.killHelper(error, child, { failIfActive: false });
      };
      const deadline = setTimeout(() => startupFailure(new Error('Takeover stop listener startup timed out')), 15000);
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-6000); });
      const output = new RpcFramer({
        allowHeaders: false, maxBytes: 4*1024*1024,
        onError: error => {
          if (/size limit/.test(error.message)) {
            if (!ready) startupFailure(error);
            else this.killHelper(error, child);
          }
        },
        onMessage: message => {
          if (this.child !== child || !message || typeof message !== 'object') return;
          if (message.kind === 'ready') {
            if (message.hookActive !== true) { startupFailure(Error('Takeover stop listener is not ready')); return; }
            ready = true; this.helperFailed=false;this.helperPid = Number.isSafeInteger(message.pid) && message.pid > 0 ? message.pid : 0; clearTimeout(deadline); resolve(); }
          else if (message.kind === 'stopped') this.fail(new Error(STOPPED));
          else if (message.kind === 'progress-layout') {
            if(this.layoutFile){const entry={id:randomUUID(),patch:message.patch,base:message.base};this.layoutWrite=this.layoutWrite.then(()=>atomicJsonAsync(this.layoutFile,entry)).catch(error=>{process.stderr.write('Overlay settings sync failed: '+error.message+'\n');});}
          }
          else {
            const pending = this.waiters.get(message.id); if (!pending || pending.child !== child) return;
            clearTimeout(pending.timer); this.waiters.delete(message.id);
            if (message.ok && pending.command === 'begin' && !this.paused && !this.closed) this.armedChild = child;
            if (!message.ok && pending.command === 'begin') {
              const error = new Error(message.error || 'Takeover stop listener did not acknowledge arming');
              pending.reject(error);
              this.killHelper(error,child);
              return;
            }
            Promise.resolve(this.layoutWrite).then(() => {
              if (message.ok && this.child === child) pending.resolve(message);
              else pending.reject(new Error(message.error || 'Takeover stop listener disconnected'));
            });
          }
        },
      });
      child.stdout.on('data', chunk => { if (this.child === child) output.push(chunk); });
      let handledDeath=false;
      const died = error => {
        if(handledDeath)return;handledDeath=true;
        clearTimeout(deadline);
        const failure = error ?? new Error(`Takeover stop listener exited${diagnostic ? ': ' + diagnostic : ''}`);
        if (!ready) reject(failure);
        this.killHelper(failure, child, { failIfActive: ready });
      };
      child.once('error', died); child.once('exit', () => died());
      child.stdin.on('error', () => {});
    }).finally(() => { this.starting = null; });
    return this.starting;
  }
  // Every command that draws text carries the words in the overlay's language,
  // and an unchanged default banner text follows that language (#74).
  withWords(command, params) {
    if (!['begin', 'configure', 'preview', 'progress'].includes(command)) return params;
    const sent = { ...params, strings: helperStrings(this.locale) };
    if (command !== 'progress') sent.indicatorText = indicatorText(params.indicatorText, this.locale, this.config.desktopTarget === 'fast');
    return sent;
  }
  async command(command, params = {}) {
    if(this.closed&&command!=='close')throw Error('COMPUTER_USE_STOPPING');
    if (command !== 'close') await this.start();
    const child = this.child;
    if (!child || (this.closed && command !== 'close')) throw Error('Takeover stop listener is not available');
    if (['begin','end','resume','close'].includes(command)) this.armedChild = null;
    params = this.withWords(command, params);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const failIfActive = command !== 'resume' && command !== 'close';
      const timer = setTimeout(() => this.killHelper(new Error(`Takeover ${command} timed out`), child, { failIfActive }), 5000);
      this.waiters.set(id, { resolve, reject, timer, child, command });
      try {
        child.stdin.write(serializeJsonLine({ ...params, id, command }), error => {
          if (error) this.killHelper(error, child, { failIfActive });
        });
      } catch (error) { this.killHelper(error, child, { failIfActive }); }
    });
  }
  async close() {
    this.closed = true; clearInterval(this.poll);
    const child = this.child;
    if (child) {
      if (!this.starting) {
        let timer;
        const exited = new Promise(resolve => child.once('close',resolve));
        const stopping = this.command('close').catch(() => {}).finally(() => child.stdin.end()).then(() => exited);
        await Promise.race([stopping,new Promise(resolve => { timer=setTimeout(resolve,1000); })]);
        clearTimeout(timer);
      }
      this.killHelper(new Error('Computer Use is shutting down'), child, { failIfActive: false });
    }
    await this.layoutWrite;
  }
}
