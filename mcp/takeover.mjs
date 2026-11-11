import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings.mjs';
import { helperStrings, indicatorText, overlayLocale, overlayStrings, systemLocale } from './overlay-strings.mjs';

export const STOPPED = 'COMPUTER_USE_STOPPED_BY_USER: The user stopped this operation series with Esc or their custom shortcut. Do not retry desktop input in this turn. A new user turn, including a request to continue, can use the desktop automatically; no settings change is required.';
const helperScript = fileURLToPath(new URL('../scripts/windows-takeover.ps1', import.meta.url));

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

export function atomicJson(file, value) {
  if (!file) return;
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value) + '\n', 'utf8');
    replaceFile(temporary, file);
  } catch (error) {
    // This temporary file belongs to this failed write and has no further use.
    try { unlinkSync(temporary); } catch { }
    throw error;
  }
}

export class TakeoverControl {
  constructor({ powershell = 'powershell.exe', onStop = () => {}, configFile = process.env.WCU_CONFIG_FILE,
    stateFile = process.env.WCU_STATE_FILE, activityFile=process.env.WCU_ACTIVITY_FILE,testMode = false, config = {}, locale } = {}) {
    this.powershell = powershell; this.onStop = onStop; this.configFile = configFile; this.stateFile = stateFile;
    // The overlay's language: the DSH interface language the host writes into
    // the activity file, unless a caller fixes one; standalone, the system's.
    this.fixedLocale = locale; this.locale = overlayLocale(locale ?? systemLocale());
    this.testMode = testMode; this.config = normalizeSettings(config); this.active = 0; this.shown = 0; this.paused = false;
    this.layoutFile=process.env.WCU_LAYOUT_FILE;
    this.progressPreviewToken=this.config.progressPreviewToken;
    this.activityFile=activityFile;this.seriesHeld=false;this.seriesIndicator=false;this.seriesKey=null;this.stoppedSeriesKey=null;this.blockedSeries=new Map();
    this.eventName = `Local\\DSH-WCU-${randomUUID()}`; this.waiters = new Map(); this.nextId = 0;
    this.resumeToken = this.config.resumeToken; this.previewToken = this.config.previewToken; this.pauseMessage = STOPPED;
    this.disabledForTest = process.env.NODE_ENV === 'test' && process.env.WCU_TEST_NO_TAKEOVER === '1';
    try {
      const saved = JSON.parse(readFileSync(this.stateFile, 'utf8'));
      this.paused = saved.paused === true;
      this.pauseMessage = saved.pauseMessage ?? STOPPED;
      this.resumeToken = saved.resumeToken ?? this.resumeToken;
      this.stoppedSeriesKey=saved.stoppedSeriesKey??null;
      this.blockedSeries=new Map(Object.entries(saved.blockedSeries??(this.stoppedSeriesKey?{[this.stoppedSeriesKey]:this.pauseMessage}:{})));
    } catch (error) { if (this.stateFile && error.code !== 'ENOENT') throw error; }
    if (configFile||activityFile) {
      this.poll = setInterval(() => { this.sync().catch(error => this.fail(error)); }, 250);
      this.poll.unref();
    }
  }
  persist(reason) {
    atomicJson(this.stateFile, { paused: this.paused, active: this.active, seriesActive:this.seriesHeld,reason: reason ?? null,
      resumeToken: this.resumeToken,stoppedSeriesKey:this.stoppedSeriesKey,blockedSeries:Object.fromEntries(this.blockedSeries),pauseMessage: this.paused ? this.pauseMessage : null, updatedAt: new Date().toISOString() });
  }
  async resumeOperation(clearScope=true){
    if(this.child)await this.command('resume');
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
    if (this.configFile) this.config = normalizeSettings(JSON.parse(readFileSync(this.configFile, 'utf8')));
    if(this.activityFile){
      const activity=JSON.parse(readFileSync(this.activityFile,'utf8'));
      if(this.fixedLocale===undefined&&typeof activity.locale==='string')this.locale=overlayLocale(activity.locale);
      const held=activity.active===true&&Number.isFinite(activity.expiresAt)&&activity.expiresAt>Date.now();
      const key=held?JSON.stringify([activity.sessionId,activity.turn]):this.seriesKey;
      // A failure while this read is still under way belongs to this series:
      // blocking the previous one would let the next read resume and retry.
      this.syncKey=key;
      // A series of browser-lane calls is held for turn tracking but shows
      // nothing; the indicator starts with the series' first desktop call.
      const indicator=held&&activity.indicator!==false;
      // After the turn ends the overlay keeps showing its final state for a
      // short time; that holds no series, indicator or stop key.
      const lingering=!held&&!!activity.progress&&Number.isFinite(activity.lingerUntil)&&activity.lingerUntil>Date.now();
      const progress=JSON.stringify({enabled:this.config.progressOverlayEnabled&&(held||lingering),remoteIndicatorVisible:this.config.remoteIndicatorVisible,locale:this.locale,settings:this.config,progress:{...activity.progress,status:this.paused&&held?'stopped':activity.progress?.status??'waiting'}});
      // After the helper failed, the overlay does not start it again in this
      // series: the poll would launch PowerShell four times a second.
      if(!this.disabledForTest&&this.sentProgress!==progress&&(this.child||(!this.helperFailed&&this.config.progressOverlayEnabled&&(held||lingering)))){
        await this.command('progress',JSON.parse(progress));this.sentProgress=progress;
      }
      if(held&&!this.blockedSeries.has(key)&&this.paused&&this.active===0)await this.resumeOperation();
      if(held!==this.seriesHeld||key!==this.seriesKey||indicator!==this.seriesIndicator){
        this.seriesKey=key;
        this.seriesHeld=held;this.seriesIndicator=indicator;
        if(!this.paused&&!this.blockedSeries.has(key)&&!this.disabledForTest){
          if(indicator)await this.command('begin',this.config);
          else if(this.shown===0&&this.child)await this.command('end');
        }
        this.persist();
      }
    }
    const presentation=JSON.stringify([this.config.indicatorEnabled,this.config.cursorIndicatorEnabled,this.config.remoteIndicatorVisible,this.config.indicatorText,this.config.indicatorPosition,this.config.indicatorIdleMs,this.config.stopShortcut,this.locale]);
    if (this.child && this.sentPresentation!==presentation) {
      await this.command(((this.seriesHeld&&this.seriesIndicator)||this.shown>0)&&!this.paused&&!this.blockedSeries.has(this.seriesKey)?'begin':'configure', this.config);
      this.sentPresentation=presentation;
      this.sentShortcut = this.config.stopShortcut; this.sentCursorIndicator = this.config.cursorIndicatorEnabled;this.sentRemoteVisible=this.config.remoteIndicatorVisible;
    }
    if (this.config.resumeToken !== this.resumeToken && this.active === 0) {
      if (this.child) await this.command('resume');
      this.resumeToken = this.config.resumeToken; this.paused = false;this.stoppedSeriesKey=null;this.blockedSeries.clear(); this.persist('resumed-by-user');
      if(this.seriesHeld&&this.seriesIndicator&&!this.disabledForTest)await this.command('begin',this.config);
    }
    if (this.config.previewToken !== this.previewToken) {
      this.previewToken = this.config.previewToken;
      if(this.paused&&this.active===0&&!this.seriesHeld)await this.resumeOperation(false);
      if (!this.paused && this.active === 0 && !this.disabledForTest) await this.command('preview', this.config);
    }
    if(this.config.progressPreviewToken!==this.progressPreviewToken){
      this.progressPreviewToken=this.config.progressPreviewToken;
      if(!this.disabledForTest&&this.progressPreviewToken>0)await this.command('progress',{enabled:true,preview:true,settings:this.config,remoteIndicatorVisible:this.config.remoteIndicatorVisible,progress:previewProgress(this.locale)});
    }
  }
  // The helper's Windows process id, which the backend watches during input.
  // Under WSL the child's own pid is that of the interop process (#79).
  get helperProcessId() { return this.child ? (this.helperPid || this.child.pid || 0) : 0; }
  // A quiet lease (browser-lane calls) checks the stopped state and counts as an
  // action in progress, but neither shows the indicator nor arms the stop keys.
  // Quiet calls send no real input, so they need no stop listener: when the
  // listener failed (it did not start, or it exited), they keep working and
  // only real input stays refused. A stop by the user refuses everything (#79).
  async begin({ quiet = false } = {}) {
    // A read that found the helper failing has paused the series; the checks
    // below then decide.
    try { await this.sync(); } catch (error) { if (!this.paused) throw error; }
    const refuses = message => !(quiet && message !== STOPPED);
    if(this.seriesHeld&&this.blockedSeries.has(this.seriesKey)&&refuses(this.blockedSeries.get(this.seriesKey)))throw new Error(this.blockedSeries.get(this.seriesKey));
    if(this.paused&&!this.activityFile&&this.active===0)await this.resumeOperation();
    if (this.paused&&refuses(this.pauseMessage)) throw new Error(this.pauseMessage);
    if (this.closed) throw new Error('COMPUTER_USE_STOPPING');
    if (!quiet&&!this.disabledForTest&&(!this.seriesHeld||!this.seriesIndicator||!this.child)) {
      try { await this.command('begin', this.config); this.sentShortcut = this.config.stopShortcut; this.sentCursorIndicator = this.config.cursorIndicatorEnabled;this.sentRemoteVisible=this.config.remoteIndicatorVisible; }
      catch (error) { this.fail(error); throw new Error(this.paused ? this.pauseMessage : error.message); }
    }
    if (this.paused&&refuses(this.pauseMessage)) throw new Error(this.pauseMessage);
    this.active++; if (!quiet) this.shown++; this.persist();
  }
  async end({ quiet = false } = {}) {
    this.active = Math.max(0, this.active - 1); if (!quiet) this.shown = Math.max(0, this.shown - 1); this.persist(this.paused ? 'stopped-by-user' : null);
    if (!quiet && this.shown === 0 && !(this.seriesHeld&&this.seriesIndicator)&&this.child && !this.paused) await this.command('end').catch(error => this.fail(error));
  }
  fail(error) {
    if (this.closed || this.paused) return;
    this.paused = true;
    const key=this.syncKey??this.seriesKey;
    this.stoppedSeriesKey=key;
    this.pauseMessage = error?.message === STOPPED ? STOPPED : `COMPUTER_USE_PAUSED: ${error?.message ?? error}. Desktop input is paused for this operation series; reading the screen and browser-lane calls still work. Do not retry desktop input in this turn; a new user turn retries the desktop connection.`;
    if(key!==null)this.blockedSeries.set(key,this.pauseMessage);
    this.persist(String(error?.message ?? error));
    // This also covers a control-file or presentation failure while input runs.
    this.child?.stdin.write(JSON.stringify({command:'stop'})+'\n',()=>{});
    this.onStop(new Error(this.pauseMessage));
  }
  async start() {
    if (this.starting) return this.starting;
    if (this.child) return;
    this.starting = new Promise((resolve, reject) => {
      let buffer = '', diagnostic = '', ready = false;
      this.helperPid = 0;
      const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', windowsScript(helperScript), '-CancelEvent', this.eventName];
      if (this.testMode) args.push('-TestMode');
      const child = this.child = spawn(this.powershell, args, { cwd: path.dirname(helperScript), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      const deadline = setTimeout(() => { reject(new Error('Takeover stop listener startup timed out')); child.kill(); }, 15000);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-6000); });
      child.stdout.on('data', chunk => {
        buffer += chunk;
        for (;;) {
          const at = buffer.indexOf('\n'); if (at < 0) break;
          const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1); if (!line) continue;
          let message; try { message = JSON.parse(line); } catch { continue; }
          if (message.kind === 'ready') { ready = true; this.helperPid = Number.isSafeInteger(message.pid) && message.pid > 0 ? message.pid : 0; clearTimeout(deadline); resolve(); }
          else if (message.kind === 'stopped') this.fail(new Error(STOPPED));
          else if (message.kind === 'progress-layout') {
            if(this.layoutFile)try{atomicJson(this.layoutFile,{id:randomUUID(),patch:message.patch,base:message.base});}catch(error){process.stderr.write('Overlay settings sync failed: '+error.message+'\n');}
          }
          else {
            const pending = this.waiters.get(message.id); if (!pending) continue;
            clearTimeout(pending.timer); this.waiters.delete(message.id);
            message.ok ? pending.resolve(message) : pending.reject(new Error(message.error));
          }
        }
      });
      const died = error => {
        clearTimeout(deadline);
        if (this.child === child) this.child = null;
        const failure = error ?? new Error(`Takeover stop listener exited${diagnostic ? ': ' + diagnostic : ''}`);
        if (!ready) reject(failure);
        for (const [id, pending] of this.waiters) { clearTimeout(pending.timer); pending.reject(failure); this.waiters.delete(id); }
        if (!this.closed) { this.helperFailed = true; this.fail(failure); }
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
    if (command !== 'progress') sent.indicatorText = indicatorText(params.indicatorText, this.locale);
    return sent;
  }
  async command(command, params = {}) {
    if(this.closed&&command!=='close')throw Error('COMPUTER_USE_STOPPING');
    await this.start();
    params = this.withWords(command, params);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(id); reject(new Error(`Takeover ${command} timed out`)); }, 5000);
      this.waiters.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...params, id, command }) + '\n', error => {
        if (error) { clearTimeout(timer); this.waiters.delete(id); reject(error); }
      });
    });
  }
  async close() {
    this.closed = true; clearInterval(this.poll);
    if (this.child) {
      const child = this.child;
      await this.command('close').catch(() => {});
      child.stdin.end();
      const force = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 1000); force.unref();
    }
  }
}
