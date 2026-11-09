// DSH owns MCP transport/cancellation. Display changes do not kill input.
import z from '@deepseek-ai/schemastery';
import { fileURLToPath } from 'node:url';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, normalizeSettings, enabledToolsForSettings, toolSelectionKey, STOP_SHORTCUT_PATTERN, TOOL_NAMES, BROWSER_APPS, repairStaleSettings } from './settings.mjs';
import { atomicJson } from './takeover.mjs';
import { installActivity } from './activity.mjs';
import { systemLocale } from './overlay-strings.mjs';

export const name = 'windows-computer-use';
export const inject = ['tools'];
export function createLiveReference(value){
  let current=Array.isArray(value)?Object.freeze([...value]):value;
  return Object.freeze({get:()=>current,[Symbol.for('cosmokit.volatile.write')]:next=>{current=next;}});
}
const fields = {
  browserFirst: z.boolean().default(true).description('网页优先使用浏览器通道 / Prefer browser use for web pages'),
  browserVisible: z.boolean().default(true).description('显示DSH浏览器窗口 / Show the DSH browser'),
  browserApp: z.union(BROWSER_APPS.map(value=>z.const(value))).default('default').description('使用的浏览器 / Browser'),
  browserSignIn: z.boolean().default(false).description('记住登录 / Keep sign-ins'),
  browserAttachUser: z.boolean().default(false).description('连接我自己的浏览器 / Attach to my own browser'),
  progressOverlayEnabled: z.boolean().default(true).description('思考与操作浮窗 / Progress overlay'),
  progressOverlayMode: z.union([z.const('source'),z.const('summary')]).default('source').description('浮窗内容：原文或 AI 总结 / Overlay content: source or AI summary'),
  progressOverlayOpacity: z.number().min(20).max(100).default(60).description('浮窗不透明度（%） / Overlay opacity (%)'),
  progressOverlayWidth: z.number().min(240).max(1600).default(360).description('浮窗宽度 / Overlay width'),
  progressOverlayHeight: z.number().min(160).max(1600).default(240).description('浮窗高度 / Overlay height'),
  progressOverlayPosition: z.union(['top-right','top-left','bottom-right','bottom-left','custom'].map(value=>z.const(value))).default('top-right').description('浮窗位置 / Overlay position'),
  progressOverlayX: z.number().min(-32768).max(32767).default(80).description('浮窗 X / Overlay X'),
  progressOverlayY: z.number().min(-32768).max(32767).default(80).description('浮窗 Y / Overlay Y'),
  progressOverlayLocked: z.boolean().default(true).description('锁定浮窗并穿透鼠标 / Lock overlay and pass through input'),
  progressLockShortcut: z.string().pattern(STOP_SHORTCUT_PATTERN).default('').description('浮窗锁定快捷键 / Overlay lock shortcut'),
  progressPreviewToken: z.number().min(0).default(0),
  mode: z.union([z.const('lite'),z.const('full')]).default('full').description('旧版工具模式 / Legacy tool mode'),
  toolPreset: z.union(['auto','full','lite','lazy','custom'].map(value=>z.const(value))).default('auto').description('工具加载方案 / Tool preset'),
  enabledTools: z.array(z.union(TOOL_NAMES.map(name=>z.const(name)))).max(TOOL_NAMES.length).default([...TOOL_NAMES]).description('启用的工具 / Enabled tools'),
  indicatorEnabled: z.boolean().default(true).description('接管提示 / Takeover indicator'),
  cursorIndicatorEnabled: z.boolean().default(true).description('鼠标指示 / Pointer indicator'),
  remoteIndicatorVisible: z.boolean().default(true).description('远程与录屏可见 / Visible in remote sessions and recordings'),
  indicatorText: z.string().default(DEFAULT_SETTINGS.indicatorText).description('提示文字 / Banner text'),
  indicatorPosition: z.union([z.const('top'),z.const('bottom')]).default('top').description('提示位置 / Banner position'),
  indicatorIdleMs: z.number().min(200).max(3000).default(800).description('结束后隐藏延时（毫秒） / Hide delay (ms)'),
  stopShortcut: z.string().pattern(STOP_SHORTCUT_PATTERN).default('').description('自定义停止快捷键 / Custom stop shortcut'),
  communityNote: z.union([z.const('full'),z.const('link')]).default('full').description('项目支持说明 / Project support note'),
  resumeToken: z.number().min(0).default(0),
  previewToken: z.number().min(0).default(0)
};
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
    if(repair.repaired.length){const retry=validation.validate(repair.value);if(!retry.issues){result=retry;repaired=repair.repaired;}}
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
export function removeControlDir(dir){
  try{if(!lstatSync(dir).isDirectory())return false;rmSync(dir,{recursive:true,force:true,maxRetries:2,retryDelay:100});}
  catch(error){if(error.code!=='ENOENT')return false;}
  return !existsSync(dir);
}
export function sweepControlDirs({tmp=os.tmpdir(),keep,now=Date.now(),maxAgeMs=CONTROL_MAX_AGE_MS,alive=processAlive}={}){
  const removed=[];let names;
  try{names=readdirSync(tmp);}catch{return removed;}
  for(const name of names){
    if(!name.startsWith(CONTROL_PREFIX))continue;
    const dir=path.join(tmp,name);if(dir===keep)continue;
    const owner=/^dsh-wcu-control-(\d+)-[^-]+$/.exec(name);
    let orphan=false;
    try{
      if(owner){const pid=Number(owner[1]);orphan=pid!==process.pid&&!alive(pid);}
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
  return {
    serverName: 'wincu', transport: 'stdio', command: process.execPath,
    args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
    env: { ELECTRON_RUN_AS_NODE: '1', WCU_IMAGE_MODE: 'file', WCU_BROWSER_ATTACH_USER: settings.browserAttachUser?'1':'0', WCU_BROWSER_HEADLESS: settings.browserVisible?'0':'1', WCU_BROWSER_APP: settings.browserApp, WCU_BROWSER_SIGNIN: settings.browserSignIn?'1':'0', WCU_TOOL_MODE: settings.toolPreset==='lazy'?'lazy':settings.mode, WCU_ENABLED_TOOLS: JSON.stringify(enabledToolsForSettings(settings)), WCU_SETTINGS_JSON: JSON.stringify(settings),
      ...(runtime.configFile ? { WCU_CONFIG_FILE: runtime.configFile, WCU_STATE_FILE: runtime.stateFile } : {}),
      ...(runtime.activityFile ? {WCU_ACTIVITY_FILE:runtime.activityFile}: {}),
      ...(runtime.layoutFile ? {WCU_LAYOUT_FILE:runtime.layoutFile}: {}),
      ...(runtime.notices ? {WCU_ADAPTER_NOTICES:JSON.stringify(runtime.notices)}: {}) },
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? 90000,
    failOnStartupError: config.failOnStartupError ?? false
  };
}
export async function apply(ctx, config) {
  const bridge = await import('@deepseek-ai/dsh-mcp-client');
  const root = mkdtempSync(path.join(os.tmpdir(), `${CONTROL_PREFIX}${process.pid}-`));
  const runtime = { configFile: path.join(root,'settings.json'), stateFile: path.join(root,'state.json'), activityFile:path.join(root,'activity.json'), layoutFile:path.join(root,'overlay-layout.json') };
  // The MCP server polls these files until DSH has closed its connection, which
  // runs alongside this adapter's disposal, and its next write would recreate a
  // removed directory. Remove it once the server has had time to exit; the
  // next start sweeps whatever a crash or a quit left behind.
  ctx.effect(() => () => { for (const delay of [1500, 6000]) setTimeout(() => removeControlDir(root), delay).unref(); });
  setTimeout(() => { try { sweepControlDirs({ keep: root }); } catch {} }, 3000).unref();
  const logError = limitedErrorLog(ctx.logger);
  // Reset settings go to the DSH log and, through the server, into the health
  // and tools results the agent reads. Which duplicate's tools DSH keeps is
  // up to the host, so a duplicate entry is reported in the log only.
  const self = {};
  if (config?.[REPAIRED_SETTINGS]?.length) {
    runtime.notices = { settingsRepaired: [...config[REPAIRED_SETTINGS]] };
    ctx.logger.warn('dsh-computer-use-win: saved settings this version does not offer were reset to their defaults: %s', runtime.notices.settingsRepaired.join('; '));
  }
  liveAdapters.add(self); ctx.effect(() => () => { liveAdapters.delete(self); });
  if (liveAdapters.size > 1) ctx.logger.warn('dsh-computer-use-win: %d entries of this plugin run in one profile, and DSH keeps only one set of mcp__wincu tools. Remove the extra entry from dsh.profile.bundles in the profile package.json or from its cordis.patch.yml.', liveAdapters.size);
  let desired = normalizeSettings(config), runningSelection, connection, stopped = false;
  // Read only when the overlay asks, at most every 5 s and again after DSH's
  // change notice: the locale entry may start after this plugin, and an idle
  // plugin never calls describe(), which announces every entry the first time.
  let settingsService, uiLocale = systemLocale(), localeReadAt = 0;
  const getLocale = () => {
    if (Date.now() - localeReadAt > 5000) { uiLocale = readDshLocale(settingsService); localeReadAt = Date.now(); }
    return uiLocale;
  };
  installActivity(ctx,runtime.activityFile,{getSettings:()=>desired,getLocale});
  let updates = Promise.resolve();
  let saveOverlayPatch, layoutId, layoutSaving = false, layoutRetry = { id: undefined, at: 0, delay: 0 };
  atomicJson(runtime.configFile, desired);
  ctx.effect(() => () => { stopped = true; });
  const applySettings = next => {
    const nextSettings = normalizeSettings(next);
    atomicJson(runtime.configFile, nextSettings);
    // Windows readers can briefly deny replacement. Keep desired unchanged
    // on a failed write so the next poll retries the pending settings.
    desired = nextSettings;
    const pending = updates.then(async () => {
      if (!connection || stopped) return;
      await connection.await();
      const nextSelection=toolSelectionKey(nextSettings);
      if (stopped || runningSelection === nextSelection) return;
      const deadline = Date.now() + 65000;
      for (;;) {
        let active = false;
        try { active = JSON.parse(readFileSync(runtime.stateFile,'utf8')).active > 0; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!active || stopped) break;
        if (Date.now() > deadline) throw new Error('Tool selection change is waiting for the current desktop action to finish');
        await new Promise(resolve => setTimeout(resolve,100));
      }
      if (stopped) return;
      await connection.update(bridgeConfig({ ...config, ...nextSettings }, runtime), true);
      await connection.await(); runningSelection = nextSelection;
    });
    updates = pending.catch(() => {});
    return pending;
  };
  // Volatile references belong to this adapter. Keep their polling lifetime
  // with the owner rather than a settings-service injection child.
  ctx.effect(() => {
    const timer = setInterval(()=>{
      if(saveOverlayPatch&&!layoutSaving)try{
        const layout=JSON.parse(readFileSync(runtime.layoutFile,'utf8'));
        // A failed save is retried with backoff (0.5 s, doubling up to 60 s) and
        // a newer layout at once. A patch that cannot apply is dropped.
        if(layout.id!==layoutId&&!(layout.id===layoutRetry.id&&Date.now()<layoutRetry.at)){
          const allowed=['progressOverlayWidth','progressOverlayHeight','progressOverlayPosition','progressOverlayX','progressOverlayY','progressOverlayLocked','progressOverlayEnabled'];
          let usable=false;
          try{
            if(!layout.patch||typeof layout.patch!=='object'||Object.keys(layout.patch).some(key=>!allowed.includes(key)))throw Error('Invalid overlay layout patch');
            normalizeSettings({...desired,...layout.patch});
            usable=!(layout.base&&Object.entries(layout.base).some(([key,value])=>!allowed.includes(key)||desired[key]!==value));
          }finally{if(!usable)layoutId=layout.id;}
          if(usable){
            layoutSaving=true;
            Promise.resolve().then(()=>saveOverlayPatch(layout.patch)).then(()=>{layoutId=layout.id;layoutRetry={id:undefined,at:0,delay:0};},error=>{
              const delay=layoutRetry.id===layout.id?Math.min(layoutRetry.delay*2,60000):500;
              layoutRetry={id:layout.id,at:Date.now()+delay,delay};logError(error);
            }).finally(()=>{layoutSaving=false;});
          }
        }
      }catch(error){if(error.code!=='ENOENT')logError(error);}
      // Older validators keep plain values rather than volatile references.
      // The Loader still commits the validated raw options for those hosts.
      // The raw entry still holds any value the validator reset; reset it here too.
      try {const next=normalizeSettings({...config,...repairStaleSettings(ctx.fiber.entry?.options?.config).value});if(JSON.stringify(next)!==JSON.stringify(desired))applySettings(next).catch(logError);}
      catch(error){logError(error);}
    },250);
    timer.unref(); return ()=>clearInterval(timer);
  });
  ctx.inject(['settings'], settingsContext => {
    settingsService = settingsContext.settings; localeReadAt = 0;
    settingsContext.effect(() => () => { settingsService = undefined; localeReadAt = 0; });
    settingsContext.on?.('settings/document-updated', ns => { if (String(ns) === 'locale') localeReadAt = 0; });
    if (typeof settingsContext.settings.register !== 'function') {
      if(typeof settingsContext.settings.update==='function')settingsContext.inject(['configEditor'],owner=>{
        // DSH 0.2.2's Loader (cordis 4.1) keeps a wrapper of the plugin's fiber
        // on its entry where 0.2.1 kept the fiber itself; the fiber knows its
        // entry either way (#72).
        saveOverlayPatch=patch=>{
          const entries=owner.configEditor.entries();
          const entry=entries.find(entry=>entry===ctx.fiber.entry)??entries.find(entry=>entry.fiber===ctx.fiber||entry.fiber?.ctx?.fiber===ctx.fiber);
          if(!entry)throw Error('DSH lists no editable profile entry for this plugin (is it listed twice, or inside another entry?), so overlay moves and resizes are not saved.');
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
    saveOverlayPatch=patch=>scope.update(patch);
    desired = normalizeSettings(scope.get()); atomicJson(runtime.configFile, desired);
    settingsContext.effect(() => scope.watch(applySettings));
    if (connection) return applySettings(desired);
  });
  runningSelection = toolSelectionKey(desired);
  connection = ctx.plugin(bridge, bridgeConfig({ ...config, ...desired }, runtime));
  await connection;
  await applySettings(desired);
}
