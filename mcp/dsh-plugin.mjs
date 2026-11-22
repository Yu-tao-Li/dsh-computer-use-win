// DSH owns MCP transport/cancellation. Display changes do not kill input.
import z from '@deepseek-ai/schemastery';
import { fileURLToPath } from 'node:url';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, normalizeSettings, enabledToolsForSettings, toolSelectionKey, repairStaleSettings } from './settings.mjs';
import {createSettingsFields} from './settings-schema.mjs';
import { atomicJson, atomicJsonAsync } from './takeover.mjs';
import { installActivity } from './activity.mjs';
import { systemLocale } from './overlay-strings.mjs';
import { randomBytes } from 'node:crypto';
import { installHostPolicy } from './policy.mjs';
import { settingsMode,findOwnEntry,bridgeSupport,bridgeDiagnostics } from './host-compat.mjs';
import { installCallLog, createDiagnosticsHandler, exportDiagnostics, DIAGNOSTICS_ROUTE, readInstallSpec } from './diagnostics.mjs';
import { createHypervSetupHandler, HYPERV_ROUTE } from './hyperv-relay.mjs';
import { createRestartHandler, RESTART_ROUTE } from './restart.mjs';
import { createUpdateReadyHandler, UPDATE_READY_ROUTE } from './update-guard.mjs';
import { backgroundRequestFile, startBackgroundDesktop } from './background-desktop.mjs';

export const name = 'windows-computer-use';
export const inject = ['tools'];
export function createLiveReference(value){
  let current=Array.isArray(value)?Object.freeze([...value]):value;
  return Object.freeze({get:()=>current,[Symbol.for('cosmokit.volatile.write')]:next=>{current=next;}});
}
const fields = createSettingsFields(z);
export const SettingsConfig = z.object(fields);
// Some Desktop loaders resolve Schemastery without the volatile() convenience
// method. Never silently omit the metadata the host uses to expose the form.
export const Config = z.object({ ...Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,typeof field.volatile === 'function' ? field.volatile() : field.extra('volatile',true)])),
  // wait_for accepts 60 s; leave room for backend startup and its final result.
  toolCallTimeoutMs: z.number().min(1).default(90000).description('工具调用超时（毫秒） / Tool timeout (ms)'),
  failOnStartupError: z.boolean().default(false)
});
// A mixed-version Desktop can understand volatile schema metadata while its
// selected validator still returns plain values. Give the Loader the official
// shared reference protocol for both initial and candidate validation. The
// fields are validated JSON scalars or an immutable array of tool names.
// The same validator also accepts a saved choice this version no longer offers
// (see repairStaleSettings): DSH would otherwise refuse the entry and every
// tool would vanish. What was reset rides along on the value for apply().
export const REPAIRED_SETTINGS=Symbol.for('dsh-computer-use-win.repairedSettings');
const validation=Config['~standard'];
Object.defineProperty(Config,'~standard',{value:{...validation,validate(input){
  let result=validation.validate(input),repaired=[];
  if(result.issues){
    const repair=repairStaleSettings(input);
    if(repair.repaired.length||repair.migrated){const retry=validation.validate(repair.value);if(!retry.issues){result=retry;repaired=repair.repaired;}}
  }
  if(!result.issues){
    try { normalizeSettings(result.value); } catch(error) { return {issues:[{message:error.message}]}; }
    for(const key of Object.keys(fields)){
      if(typeof result.value[key]?.get!=='function')result.value[key]=createLiveReference(result.value[key]);
    }
    if(repaired.length)Object.defineProperty(result.value,REPAIRED_SETTINGS,{value:Object.freeze(repaired)});
  }
  return result;
}}});
// Two entries of this plugin in one profile (a bundle listed twice, or an old
// manual entry beside the bundle) start two servers under one name, and DSH
// keeps one set of mcp__wincu tools. Report it instead of leaving it silent.
const liveAdapters=new Set();
// A failure seen by a 250 ms poll would otherwise fill the DSH log (#72): each
// distinct message is logged at most once a minute, then with a repeat count.
export function limitedErrorLog(logger,windowMs=60000,now=Date.now){
  const recent=new Map();
  return error=>{
    const key=String(error?.message??error),time=now(),seen=recent.get(key);
    if(seen&&time-seen.at<windowMs){seen.skipped++;return;}
    recent.delete(key);recent.set(key,{at:time,skipped:0});
    while(recent.size>16)recent.delete(recent.keys().next().value);
    logger.error(error);
    if(seen?.skipped)logger.warn?.('dsh-computer-use-win: the error above occurred %d more times in the last %d s.',seen.skipped,Math.round((time-seen.at)/1000));
  };
}
// Each adapter keeps its control files in a temp directory named after the
// DSH process, so a later start can tell a directory left by a crash from one
// in use (#71). Directories from versions before 0.5.5 carry no process id.
const CONTROL_PREFIX='dsh-wcu-control-',CONTROL_MAX_AGE_MS=7*24*3600*1000;
const processAlive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}};
const controlPipe=dir=>'\\\\.\\pipe\\'+path.basename(dir);
// A pipe belongs to this adapter lifetime; unlike a PID it cannot be reused
// by an unrelated process after a crash. No polling or process queries.
export async function holdControlDir(dir){
  const server=createServer(socket=>socket.destroy());
  await new Promise((resolve,reject)=>server.once('error',reject).listen(controlPipe(dir),resolve));
  server.on('error',()=>{});
  server.unref();
  try{writeFileSync(path.join(dir,'.pipe-owner'),'1');}catch(error){server.close();throw error;}
  return ()=>server.close();
}
function controlPipeAlive(dir){
  return new Promise(resolve=>{
    const socket=connect(controlPipe(dir));
    const finish=alive=>{socket.destroy();resolve(alive);};
    socket.once('connect',()=>finish(true));
    socket.once('error',error=>finish(!['ENOENT','ECONNREFUSED'].includes(error.code)));
    socket.setTimeout(250,()=>finish(true));
  });
}
export function removeControlDir(dir){
  try{if(!lstatSync(dir).isDirectory())return false;rmSync(dir,{recursive:true,force:true,maxRetries:2,retryDelay:100});}
  catch(error){if(error.code!=='ENOENT')return false;}
  return !existsSync(dir);
}
export async function sweepControlDirs({tmp=os.tmpdir(),keep,now=Date.now(),maxAgeMs=CONTROL_MAX_AGE_MS,alive=processAlive}={}){
  const removed=[];let names;
  try{names=readdirSync(tmp);}catch{return removed;}
  for(const name of names){
    if(!name.startsWith(CONTROL_PREFIX))continue;
    const dir=path.join(tmp,name);if(dir===keep)continue;
    const owner=/^dsh-wcu-control-(\d+)-[^-]+$/.exec(name);
    let orphan=false;
    try{
      if(!lstatSync(dir).isDirectory())continue;
      if(existsSync(path.join(dir,'.pipe-owner')))orphan=!await controlPipeAlive(dir);
      else if(owner){const pid=Number(owner[1]);orphan=pid!==process.pid&&!alive(pid);}
      else{let touched=lstatSync(dir).mtimeMs;for(const file of readdirSync(dir))touched=Math.max(touched,lstatSync(path.join(dir,file)).mtimeMs);orphan=now-touched>maxAgeMs;}
    }catch{continue;}
    if(orphan&&removeControlDir(dir))removed.push(name);
  }
  return removed;
}
// The overlay speaks the DSH interface language (#74): the language chosen in
// DSH, which every DSH line keeps as `preference` in its `locale` settings
// entry (DSH Desktop reads it the same way for its own menus), else the system
// locale, which is also what DSH follows while nothing is chosen.
export function readDshLocale(settings) {
  try {
    const preference = settings?.describe?.().find(entry => String(entry.ns) === 'locale')?.value?.preference;
    if (typeof preference === 'string' && preference.trim()) return preference.trim();
  } catch {}
  return systemLocale();
}
export function bridgeConfig(config = {}, runtime = {}) {
  const settings = normalizeSettings(config);
  const isolated = settings.desktopTarget === 'hyperv';
  const entry = fileURLToPath(new URL(isolated ? './hyperv-relay.mjs' : './server.mjs', import.meta.url));
  return {
    serverName: 'wincu', transport: 'stdio', command: process.execPath, args: [entry],
    env: { ELECTRON_RUN_AS_NODE: '1', WCU_IMAGE_MODE: 'file', WCU_BROWSER_ATTACH_USER: settings.browserAttachUser?'1':'0', WCU_BROWSER_HEADLESS: settings.browserVisible?'0':'1', WCU_BROWSER_APP: settings.browserApp, WCU_BROWSER_SIGNIN: settings.browserSignIn?'1':'0', WCU_TOOL_MODE: settings.toolPreset==='lazy'?'lazy':settings.mode, WCU_ENABLED_TOOLS: JSON.stringify(enabledToolsForSettings(settings)), WCU_SETTINGS_JSON: JSON.stringify(settings),
      ...(runtime.backgroundFile && !isolated ? {WCU_BACKGROUND_FILE:runtime.backgroundFile} : {}),
      ...(runtime.approvalSecret ? {WCU_APPROVAL_SECRET: runtime.approvalSecret,WCU_APPROVAL_LEDGER:runtime.approvalLedger, WCU_HOST_PID: String(process.pid),WCU_HOST_EXECUTABLE:process.execPath, WCU_HOST_PORTS: (runtime.hostPorts ?? []).join('|'), WCU_HOST_PORT_FILE:runtime.hostPortFile, WCU_USER_TABS_FILE:runtime.userTabsFile} : {}),
      ...(runtime.configFile ? { WCU_CONFIG_FILE: runtime.configFile, WCU_STATE_FILE: runtime.stateFile } : {}),
      ...(runtime.activityFile ? {WCU_ACTIVITY_FILE:runtime.activityFile}: {}),
      ...(runtime.layoutFile ? {WCU_LAYOUT_FILE:runtime.layoutFile}: {}),
      ...(isolated ? {WCU_HYPERV_VM:settings.hypervVm} : {}),
      ...(runtime.notices ? {WCU_ADAPTER_NOTICES:JSON.stringify(runtime.notices)}: {}) },
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? 90000,
    failOnStartupError: config.failOnStartupError ?? false
  };
}
export async function apply(ctx, config) {
  const bridge = await import('@deepseek-ai/dsh-mcp-client');
  const support = bridgeSupport();
  const root = mkdtempSync(path.join(os.tmpdir(), `${CONTROL_PREFIX}${process.pid}-`));
  // Without the pipe the directory falls back to the PID rule; never block loading.
  const releaseControlDir=await holdControlDir(root).catch(error=>{ctx.logger.warn('dsh-computer-use-win: control directory pipe unavailable: %s',error?.message??error);return ()=>{};});
  ctx.effect(()=>releaseControlDir);
  const runtime = { configFile: path.join(root,'settings.json'), stateFile: path.join(root,'state.json'), backgroundFile: path.join(root,'background-desktop.json'), activityFile:path.join(root,'activity.json'), layoutFile:path.join(root,'overlay-layout.json'), userTabsFile:path.join(root,'user-tabs.json'), getLocale: () => getLocale() };
  runtime.approvalSecret = randomBytes(32).toString('base64url');
  runtime.approvalLedger=path.join(root,'approval-grants.json');
  runtime.hostPorts = [];
  runtime.hostPortFile=path.join(root,'host-ports.json');atomicJson(runtime.hostPortFile,{ports:[],pending:true});let webServerSeen=false,hostPortsDisposed=false;const settleNoWebServer=setTimeout(()=>{if(!webServerSeen&&!hostPortsDisposed)atomicJsonAsync(runtime.hostPortFile,{ports:[]}).catch(()=>{});},1500);settleNoWebServer.unref?.();ctx.effect(()=>()=>{hostPortsDisposed=true;clearTimeout(settleNoWebServer);});
  // "Report a problem" on the settings page: the page posts here, the export
  // writes the diagnostics file, then opens the Downloads folder and the
  // new-issue page (diagnostics.mjs).
  const callLog = installCallLog(ctx);
  const pluginRoot = fileURLToPath(new URL('..', import.meta.url));
  let firstBridgeStartupMs;
  const collectDiagnostics = () => {
    const profiles = ctx.get?.('desktopProfiles');
    let current; try { current = profiles?.current; } catch {}
    let version = 'unknown'; try { version = JSON.parse(readFileSync(path.join(pluginRoot, 'package.json'), 'utf8')).version; } catch {}
    return exportDiagnostics({ version, settings: desired, calls: callLog.list(), host: current ? 'DSH Desktop' : 'DSH',
      mcpClient: support.version, bridge: { ...bridgeDiagnostics(bridge, connection, ctx.tools, enabledToolsForSettings(desired).length, support.peerMismatches),
        liveAdapterCount: liveAdapters.size, firstBridgeStartupMs },
      dshLocale: getLocale(), installSpec: readInstallSpec(pluginRoot, current?.dir),
      secrets: [runtime.approvalSecret], serverPath: fileURLToPath(new URL('./server.mjs', import.meta.url)) });
  };
  ctx.inject(['webServer'], owner => {
    webServerSeen=true;clearTimeout(settleNoWebServer);if(!owner.webServer.port)atomicJson(runtime.hostPortFile,{ports:[],pending:true});
    let timer;
    const update=async()=>{
      const port=owner.webServer.port;
      if (!port) return;
      if (!runtime.hostPorts.includes(String(port))) {
        const ports = [String(port)];
        if (hostPortsDisposed) return;
        await atomicJsonAsync(runtime.hostPortFile, { ports });
        if (hostPortsDisposed) return;
        runtime.hostPorts = ports;
      }
      clearInterval(timer);timer=undefined;
    };
    owner.effect(()=>{timer=setInterval(()=>{void update().catch(error=>owner.logger.warn(error));},250);timer.unref();return ()=>clearInterval(timer);});
    void update().catch(error=>owner.logger.warn(error));
    if (typeof owner.webServer.register === 'function') owner.effect(() => {
      try { return owner.webServer.register({ kind: 'exact', path: DIAGNOSTICS_ROUTE, handler: createDiagnosticsHandler({ collect: collectDiagnostics, logger: owner.logger }) }); }
      catch (error) { owner.logger.warn('dsh-computer-use-win: the problem-report route is unavailable: %s', error?.message ?? error); return () => {}; }
    });
    if (typeof owner.webServer.register === 'function') owner.effect(() => {
      try { return owner.webServer.register({ kind: 'exact', path: HYPERV_ROUTE,
        handler: createHypervSetupHandler({ settings: () => desired, reconnect: vm => applySettings(desired, desiredJson, vm) }),
      }); }
      catch (error) { owner.logger.warn('dsh-computer-use-win: the Hyper-V setup route is unavailable: %s', error?.message ?? error); return () => {}; }
    });
    if (typeof owner.webServer.register === 'function') owner.effect(() => {
      try { return owner.webServer.register({ kind: 'exact', path: RESTART_ROUTE, handler: createRestartHandler({ logger: owner.logger }) }); }
      catch (error) { owner.logger.warn('dsh-computer-use-win: the restart route is unavailable: %s', error?.message ?? error); return () => {}; }
    });
    if (typeof owner.webServer.register === 'function') owner.effect(() => {
      try { return owner.webServer.register({ kind: 'exact', path: UPDATE_READY_ROUTE, handler: createUpdateReadyHandler({ logger: owner.logger }) }); }
      catch (error) { owner.logger.warn('dsh-computer-use-win: the update check route is unavailable: %s', error?.message ?? error); return () => {}; }
    });
  });
  installHostPolicy(ctx, runtime);
  // The MCP server polls these files until DSH has closed its connection, which
  // runs alongside this adapter's disposal, and its next write would recreate a
  // removed directory. Remove it once the server has had time to exit; the
  // next start sweeps whatever a crash or a quit left behind.
  ctx.effect(() => () => { for (const delay of [1500, 6000]) setTimeout(() => removeControlDir(root), delay).unref(); });
  setTimeout(() => { void sweepControlDirs({ keep: root }).catch(()=>{}); }, 3000).unref();
  const logError = limitedErrorLog(ctx.logger);
  if(!support.tested){runtime.notices={hostBridgeUnverified:support.version};ctx.logger.warn('dsh-computer-use-win: bridge %s is unverified for this release; actions requiring approval fail closed if approval is unavailable.',support.version);}
  if(support.peerMismatches.length)ctx.logger.warn('dsh-computer-use-win: bridge %s resolved DSH peer versions outside its declared requirements: %s. Use the bridge supplied with this DSH Host.',support.version,support.peerMismatches.map(({name,expected,actual})=>name+' '+actual+' (expected '+expected+')').join(', '));
  if(support.legacyApprovalUiUnverified){runtime.notices={...runtime.notices,legacyApprovalUiUnverified:support.version};ctx.logger.warn('dsh-computer-use-win: legacy bridge %s does not support interactive web approval prompts; actions requiring approval will be blocked.',support.version);}
  // Reset settings go to the DSH log and, through the server, into the health
  // and tools results the agent reads. Which duplicate's tools DSH keeps is
  // up to the host, so a duplicate entry is reported in the log only.
  const self = {};
  if (config?.[REPAIRED_SETTINGS]?.length) {
    runtime.notices = {...runtime.notices, settingsRepaired: [...config[REPAIRED_SETTINGS]] };
    ctx.logger.warn('dsh-computer-use-win: saved settings this version does not offer were reset to their defaults: %s', runtime.notices.settingsRepaired.join('; '));
  }
  liveAdapters.add(self); ctx.effect(() => () => { liveAdapters.delete(self); });
  if (liveAdapters.size > 1) ctx.logger.warn('dsh-computer-use-win: %d entries of this plugin run in one profile, and DSH keeps only one set of mcp__wincu tools. Remove the extra entry from dsh.profile.bundles in the profile package.json or from its cordis.patch.yml.', liveAdapters.size);
  let desired = normalizeSettings(config), desiredJson = JSON.stringify(desired), desiredKey = toolSelectionKey(desired), lastWrittenConfigJson = desiredJson;
  let runningSelection, connection, stopped = false;
  const desktopRoute = settings => JSON.stringify(settings.desktopTarget === 'hyperv' ? ['hyperv', settings.hypervVm] : ['local', '']);
  let runningDesktop;
  runtime.desktopRoutePending = () => runningDesktop !== desktopRoute(desired);
  runtime.usesGuestLoopback = () => desired.desktopTarget === 'hyperv';
  const writeConfigIfChanged = (settings, json = JSON.stringify(settings)) => {
    if (json === lastWrittenConfigJson) return;
    atomicJson(runtime.configFile, settings);
    lastWrittenConfigJson = json;
  };
  // Read only when the overlay asks, at most every 5 s and again after DSH's
  // change notice: the locale entry may start after this plugin, and an idle
  // plugin never calls describe(), which announces every entry the first time.
  let settingsService, uiLocale = systemLocale(), localeReadAt = 0;
  const getLocale = () => {
    if (Date.now() - localeReadAt > 5000) { uiLocale = readDshLocale(settingsService); localeReadAt = Date.now(); }
    return uiLocale;
  };
  const activity = installActivity(ctx,runtime.activityFile,{getSettings:()=>desired,getLocale});
  // A new DSH language reaches the overlay while it is idle too. DSH sends its
  // change notice from inside describe(), so the language is read once that
  // call has returned.
  let localeRefresh;
  const refreshLocale = () => {
    localeReadAt = 0;
    if (localeRefresh) return;
    localeRefresh = setTimeout(() => { localeRefresh = undefined; activity.refresh(); }, 0);
    localeRefresh.unref?.();
  };
  ctx.effect(() => () => { clearTimeout(localeRefresh); localeRefresh = undefined; });
  let updates = Promise.resolve();
  // Low disruption opens the apps DSH starts on a hidden desktop of this
  // Windows session. The desktop belongs to this adapter, not to the server,
  // so its apps outlive an MCP restart (DSH restarts MCP for tool and browser
  // settings). It opens when the server first asks for it (a request file next
  // to backgroundFile, which then holds its name) and closes with DSH or when
  // the virtual machine is chosen; closing it ends the apps on it.
  let backgroundOwner;
  const backgroundRequest = backgroundRequestFile(runtime.backgroundFile);
  const closeBackground = () => {
    const owner = backgroundOwner;
    backgroundOwner = undefined;
    try { rmSync(runtime.backgroundFile, { force: true }); } catch {}
    return owner?.dispose();
  };
  const openBackground = () => {
    const owner = startBackgroundDesktop(error => {
      if (backgroundOwner !== owner) return;
      void closeBackground();
      logError(error);
    });
    backgroundOwner = owner;
    owner.ready.then(() => {
      if (backgroundOwner === owner) atomicJson(runtime.backgroundFile, { name: owner.name });
    }).catch(error => {
      if (backgroundOwner !== owner) return;
      backgroundOwner = undefined;
      try { atomicJson(runtime.backgroundFile, { error: String(error?.message ?? error).slice(0, 400), at: Date.now() }); } catch {}
      logError(error);
    });
  };
  async function prepareBridge(settings) { return bridgeConfig(settings, runtime); }
  // A settings change starts a new bridge rather than updating the running one.
  // cordis 4.0 (DSH Desktop 2.0) drops the promise of the restart that
  // Fiber.update() begins, so a desktop that cannot start, such as a VM whose
  // connection is not configured yet, rejected it unhandled, and DSH's
  // fail-loud handler then quit the host. Awaiting the new bridge keeps the
  // failure on this path, where it is logged and retried.
  async function replaceBridge(options) {
    const previous = connection;
    connection = undefined;
    if (previous) {
      try { await previous.dispose(); } catch (error) { logError(error); }
      // Unloading finishes after dispose() returns, and the bridge's server
      // name is free only then.
      try { await previous.await(); } catch {}
    }
    if (stopped) return;
    connection = ctx.plugin(bridge, options);
    await connection;
  }
  let saveOverlayPatch, settingsSource = 'entry', namespaceScope, layoutId, layoutStatKey = '', layoutSaving = false, layoutRetry = { id: undefined, at: 0, delay: 0 };
  let selectionPending=0,selectionRetry={at:0,delay:0};
  atomicJson(runtime.configFile, desired);
  ctx.effect(() => () => { stopped = true; void closeBackground(); });
  const isSelectedVm = vm => desired.desktopTarget === 'hyperv' && desired.hypervVm === vm;
  const applySettings = (next, nextJson, reconnectVm) => {
    const nextSettings = next === desired ? desired : normalizeSettings(next);
    const json = next === desired ? desiredJson : (nextJson ?? JSON.stringify(nextSettings));
    // A preview shows the DSH language of this moment. It goes into the
    // activity file before the server reads the new preview token.
    if (nextSettings.previewToken !== desired.previewToken || nextSettings.progressPreviewToken !== desired.progressPreviewToken) { localeReadAt = 0; activity.refresh(); }
    writeConfigIfChanged(nextSettings, json);
    // Windows readers can briefly deny replacement. Keep desired unchanged
    // on a failed write so the next poll retries the pending settings.
    if (nextSettings !== desired) {
      desired = nextSettings;
      desiredJson = json;
      desiredKey = toolSelectionKey(desired);
    }
    selectionPending++;
    const pending = updates.then(async () => {try{
      if (!connection || stopped || (reconnectVm && !isSelectedVm(reconnectVm))) return;
      const nextSelection = desiredKey;
      if (!reconnectVm && runningSelection === nextSelection) return;
      const deadline = Date.now() + 65000;
      while (runningDesktop !== undefined) {
        let active = false;
        try {
          const saved = JSON.parse(readFileSync(runtime.stateFile,'utf8'));
          const guest = JSON.parse(runningDesktop)[0] === 'hyperv';
          active = saved.active > 0 && (guest || !Number.isSafeInteger(saved.pid) || processAlive(saved.pid));
        } catch (error) {
          if (['EACCES','EBUSY','EPERM'].includes(error.code)) active = true;
          else if (error.code !== 'ENOENT') throw error;
        }
        if (!active || stopped) break;
        if (Date.now() > deadline) throw new Error('Tool selection change is waiting for the current desktop action to finish');
        await new Promise(resolve => setTimeout(resolve,100));
      }
      if (stopped || (reconnectVm && !isSelectedVm(reconnectVm))) return;
      const latest={...desired},latestSelection=desiredKey;
      const required = runningDesktop !== desktopRoute(latest) || Boolean(reconnectVm);
      const nextConfig = { ...config, ...latest };
      if (required) nextConfig.failOnStartupError = true;
      const nextBridge = await prepareBridge(nextConfig);
      if (stopped) return;
      // The virtual machine cannot reach the hidden desktop's apps: choosing it
      // closes them, whether or not the machine connects.
      if (latest.desktopTarget === 'hyperv') await closeBackground();
      runningSelection = runningDesktop = undefined;
      await replaceBridge(nextBridge);
      runningSelection = latestSelection; runningDesktop = desktopRoute(latest);selectionRetry={at:0,delay:0};
    }catch(error){
      const delay=Math.min((selectionRetry.delay||250)*2,60000);selectionRetry={at:Date.now()+delay,delay};throw error;
    }finally{selectionPending--;}
    });
    updates = pending.catch(() => {});
    return pending;
  };
  // Volatile references belong to this adapter. Keep their polling lifetime
  // with the owner rather than a settings-service injection child.
  ctx.effect(() => {
    const timer = setInterval(()=>{
      if(saveOverlayPatch&&!layoutSaving)try{
        const st = statSync(runtime.layoutFile, { bigint: true, throwIfNoEntry: false });
        const statKey = st ? `${st.ino}:${st.mtimeNs}:${st.size}` : '';
        // An unchanged file is skipped, except when its failed save is due for
        // a retry: the backoff ends without the file changing.
        const retryDue = layoutRetry.id !== undefined && Date.now() >= layoutRetry.at;
        if (st && (statKey !== layoutStatKey || retryDue)) {
          const layout=JSON.parse(readFileSync(runtime.layoutFile,'utf8'));
          layoutStatKey = statKey;
          // A failed save is retried with backoff (0.5 s, doubling up to 60 s) and
          // a newer layout at once. A patch that cannot apply is dropped.
          if(layout.id!==layoutId&&!(layout.id===layoutRetry.id&&Date.now()<layoutRetry.at)){
            const allowed=['progressOverlayWidth','progressOverlayHeight','progressOverlayPosition','progressOverlayX','progressOverlayY','progressOverlayLocked'];
            let usable=false;
            try{
              if(!layout.patch||typeof layout.patch!=='object'||Object.keys(layout.patch).some(key=>!allowed.includes(key)))throw Error('Invalid overlay layout patch');
              normalizeSettings({...desired,...layout.patch});
              usable=!(layout.base&&Object.entries(layout.base).some(([key,value])=>!allowed.includes(key)||desired[key]!==value));
            }finally{if(!usable){layoutId=layout.id;if(layoutRetry.id===layout.id)layoutRetry={id:undefined,at:0,delay:0};}}
            if(usable){
              layoutSaving=true;
              Promise.resolve().then(()=>saveOverlayPatch(layout.patch)).then(()=>{layoutId=layout.id;layoutRetry={id:undefined,at:0,delay:0};},error=>{
                const delay=layoutRetry.id===layout.id?Math.min(layoutRetry.delay*2,60000):500;
                layoutRetry={id:layout.id,at:Date.now()+delay,delay};layoutStatKey='';logError(error);
              }).finally(()=>{layoutSaving=false;});
            }
          }
        }
      }catch(error){if(error.code!=='ENOENT')logError(error);}
      try {
        if (existsSync(backgroundRequest)) {
          rmSync(backgroundRequest, { force: true });
          if (!backgroundOwner && desired.desktopTarget !== 'hyperv' && !stopped) openBackground();
        }
      } catch (error) { logError(error); }
      // Older validators keep plain values rather than volatile references.
      // The Loader still commits the validated raw options for those hosts.
      // The raw entry still holds any value the validator reset; reset it here too.
      try {
        const raw=settingsSource==='namespace'?namespaceScope?.get():{...config,...repairStaleSettings(ctx.fiber.entry?.options?.config).value};
        if(raw){const next=normalizeSettings(raw);const nextJson=JSON.stringify(next);if(nextJson!==desiredJson)applySettings(next,nextJson).catch(logError);}
        if(connection&&runningSelection!==desiredKey&&selectionPending===0&&Date.now()>=selectionRetry.at)applySettings(desired,desiredJson).catch(logError);
      }
      catch(error){logError(error);}
    },250);
    timer.unref(); return ()=>clearInterval(timer);
  });
  ctx.inject(['settings'], settingsContext => {
    settingsService = settingsContext.settings; localeReadAt = 0;
    settingsContext.effect(() => () => { settingsService = undefined; localeReadAt = 0; });
    settingsContext.on?.('settings/document-updated', ns => { if (String(ns) === 'locale') refreshLocale(); });
    if (settingsMode(settingsContext.settings) === 'entry') {
      if(typeof settingsContext.settings.update==='function')settingsContext.inject(['configEditor'],owner=>{
        // DSH 0.2.2's Loader (cordis 4.1) keeps a wrapper of the plugin's fiber
        // on its entry where 0.2.1 kept the fiber itself; the fiber knows its
        // entry either way (#72).
        saveOverlayPatch=patch=>{
          const entries=owner.configEditor.entries();
          const entry=findOwnEntry(entries,ctx.fiber);
          if(!entry)throw Error('DSH has no editable profile entry for this plugin (check if it is duplicated or nested inside another entry), so overlay position and size changes cannot be saved.');
          return owner.settings.update(entry.options.id,patch);
        };
        return ()=>{saveOverlayPatch=undefined;};
      });
      // DSH 0.2 uses volatile Config fields keyed by the profile entry id.
      if (settingsContext.settings.configure) settingsContext.effect(()=>settingsContext.settings.configure({auto:false},ctx.fiber));
      return;
    }
    const scope = settingsContext.settings.register('windows-computer-use', SettingsConfig, {
      base: normalizeSettings(config), applies: 'live', validate: normalizeSettings
    });
    settingsSource = 'namespace';
    namespaceScope=scope;
    settingsContext.effect(() => () => { settingsSource = 'entry';namespaceScope=undefined;saveOverlayPatch=undefined; });
    saveOverlayPatch=patch=>scope.update(patch);
    desired = normalizeSettings(scope.get()); desiredJson = JSON.stringify(desired); desiredKey = toolSelectionKey(desired); writeConfigIfChanged(desired, desiredJson);
    settingsContext.effect(() => scope.watch(next => {
      try { return applySettings(next).catch(logError); }
      catch (error) { logError(error); }
    }));
    if (connection) return applySettings(desired, desiredJson);
  });
  const initial = desired, initialSelection = desiredKey;
  const startupAt = performance.now();
  const startup = prepareBridge({ ...config, ...initial }).then(options => {
    if (stopped) return;
    connection = ctx.plugin(bridge, options);
    return connection;
  }).then(() => {
    runningSelection = initialSelection;
    runningDesktop = desktopRoute(initial);
  }).finally(() => { firstBridgeStartupMs = Math.round(performance.now() - startupAt); });
  updates = startup.catch(() => {});
  await startup;
  if (desiredKey !== runningSelection && !stopped) await applySettings(desired, desiredJson);
}
