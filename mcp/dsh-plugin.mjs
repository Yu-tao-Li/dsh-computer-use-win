// DSH owns MCP transport/cancellation. Display changes do not kill input.
import z from '@deepseek-ai/schemastery';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, normalizeSettings, enabledToolsForSettings, toolSelectionKey, STOP_SHORTCUT_PATTERN, TOOL_NAMES } from './settings.mjs';
import { atomicJson } from './takeover.mjs';
import { installActivity } from './activity.mjs';

export const name = 'windows-computer-use';
export const inject = ['tools'];
export function createLiveReference(value){
  let current=Array.isArray(value)?Object.freeze([...value]):value;
  return Object.freeze({get:()=>current,[Symbol.for('cosmokit.volatile.write')]:next=>{current=next;}});
}
const fields = {
  mode: z.union([z.const('lite'),z.const('full')]).default('full').description('旧版工具模式 / Legacy tool mode'),
  toolPreset: z.union(['auto','full','lite','lazy','custom'].map(value=>z.const(value))).default('auto').description('工具加载方案 / Tool preset'),
  enabledTools: z.array(z.union(TOOL_NAMES.map(name=>z.const(name)))).max(24).default([...TOOL_NAMES]).description('启用的工具 / Enabled tools'),
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
  toolCallTimeoutMs: z.number().min(1).default(60000).description('工具调用超时（毫秒） / Tool timeout (ms)'),
  failOnStartupError: z.boolean().default(false)
});
// A mixed-version Desktop can understand volatile schema metadata while its
// selected validator still returns plain values. Give the Loader the official
// shared reference protocol for both initial and candidate validation. The
// fields are validated JSON scalars or an immutable array of tool names.
const validation=Config['~standard'];
Object.defineProperty(Config,'~standard',{value:{...validation,validate(input){
  const result=validation.validate(input);
  if(!result.issues)for(const key of Object.keys(fields)){
    if(typeof result.value[key]?.get!=='function')result.value[key]=createLiveReference(result.value[key]);
  }
  return result;
}}});
export function bridgeConfig(config = {}, runtime = {}) {
  const settings = normalizeSettings(config);
  return {
    serverName: 'wincu', transport: 'stdio', command: process.execPath,
    args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
    env: { ELECTRON_RUN_AS_NODE: '1', WCU_TOOL_MODE: settings.toolPreset==='lazy'?'lazy':settings.mode, WCU_ENABLED_TOOLS: JSON.stringify(enabledToolsForSettings(settings)), WCU_SETTINGS_JSON: JSON.stringify(settings),
      ...(runtime.configFile ? { WCU_CONFIG_FILE: runtime.configFile, WCU_STATE_FILE: runtime.stateFile } : {}),
      ...(runtime.activityFile ? {WCU_ACTIVITY_FILE:runtime.activityFile}: {}) },
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? 60000,
    failOnStartupError: config.failOnStartupError ?? false
  };
}
export async function apply(ctx, config) {
  const bridge = await import('@deepseek-ai/dsh-mcp-client');
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-wcu-control-'));
  const runtime = { configFile: path.join(root,'settings.json'), stateFile: path.join(root,'state.json'), activityFile:path.join(root,'activity.json') };
  installActivity(ctx,runtime.activityFile);
  let desired = normalizeSettings(config), runningSelection, connection, stopped = false;
  let updates = Promise.resolve();
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
      // Older validators keep plain values rather than volatile references.
      // The Loader still commits the validated raw options for those hosts.
      try {const next=normalizeSettings({...config,...ctx.fiber.entry?.options?.config});if(JSON.stringify(next)!==JSON.stringify(desired))applySettings(next).catch(error=>ctx.logger.error(error));}
      catch(error){ctx.logger.error(error);}
    },250);
    timer.unref(); return ()=>clearInterval(timer);
  });
  ctx.inject(['settings'], settingsContext => {
    if (typeof settingsContext.settings.register !== 'function') {
      // DSH 0.2 uses volatile Config fields keyed by the profile entry id.
      if (settingsContext.settings.configure) settingsContext.effect(()=>settingsContext.settings.configure({auto:false},ctx.fiber));
      return;
    }
    const scope = settingsContext.settings.register('windows-computer-use', SettingsConfig, {
      base: normalizeSettings(config), applies: 'live', validate: normalizeSettings
    });
    desired = normalizeSettings(scope.get()); atomicJson(runtime.configFile, desired);
    settingsContext.effect(() => scope.watch(applySettings));
    if (connection) return applySettings(desired);
  });
  runningSelection = toolSelectionKey(desired);
  connection = ctx.plugin(bridge, bridgeConfig({ ...config, ...desired }, runtime));
  await connection;
  await applySettings(desired);
}
