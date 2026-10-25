// Run against the supplied installed DSH modules, in an isolated profile fixture.
// The settings and MCP services are real; the config editor writes this fixture
// only, and commits volatile references with DSH's own cosmokit implementation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cp, mkdtemp, mkdir, symlink, writeFile, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
const modules = process.argv[2];
if (!modules) throw new Error('Pass the installed DSH node_modules directory');
const require = createRequire(path.join(modules, '../package.json'));
const load = name => import(pathToFileURL(require.resolve(name)).href);
const [{Context},{ToolRuntime},{SettingsForms},{updateVolatile}] = await Promise.all([
  load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-tools'),load('@deepseek-ai/dsh-settings'),load('@deepseek-ai/cosmokit')
]);
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-host-settings-'));
const packageRoot=path.join(root,'plugin'), peerRoot=path.join(packageRoot,'node_modules/@deepseek-ai');
await mkdir(peerRoot,{recursive:true});
for(const entry of ['mcp','scripts','package.json','docs'])await cp(new URL('../'+entry,import.meta.url),path.join(packageRoot,entry),{recursive:true});
for(const name of ['schemastery','cosmokit','dsh-mcp-client'])await symlink(path.dirname(require.resolve('@deepseek-ai/'+name+'/package.json')),path.join(peerRoot,name),'junction');
const adapter=await import(pathToFileURL(path.join(packageRoot,'mcp/dsh-plugin.mjs')).href);
const previousTemp=process.env.TEMP, previousTmp=process.env.TMP;process.env.TEMP=root;process.env.TMP=root;
let raw={mode:'lite',indicatorEnabled:false},entry;
const editor={documentPath:path.join(root,'profile-patch.json'),entries:()=>entry?[entry]:[],configuration:()=>entry?[{entry,inherited:{},override:raw}]:[],edit:async(target,change)=>{
  const next=change(raw,{}),parsed=adapter.Config(next);
  // Validate before persisting, as ConfigEditor does before profile reconciliation.
  for(const key of Object.keys(parsed))if(typeof parsed[key]?.get==='function')updateVolatile(target.fiber.config[key],parsed[key]);
  raw=next;target.options.config=raw;
  await writeFile(editor.documentPath,JSON.stringify(raw,null,2));
}};
const ctx=new Context();
ctx.provide('systemPrompt',{tools(){return ()=>{}},section(){return ()=>{}},getSectionOrder(){return 0}});
ctx.provide('profileContext',{home:root,dir:root,name:'isolated-wcu-test'});
ctx.provide('configEditor',editor);ctx.provide('loader',{await:async()=>{}});
const tools=new ToolRuntime(ctx),settings=new SettingsForms(ctx);
const fiber=ctx.plugin(adapter,raw);entry={id:1,options:{id:'mcp-dsh-computer-use-win',name:'dsh-computer-use-win/mcp/dsh-plugin.mjs',config:raw},fiber:fiber.ctx.fiber};
const until=async test=>{const deadline=Date.now()+30000;while(!await test()){if(Date.now()>deadline)throw Error('Host integration condition timed out; fixture='+root);await new Promise(r=>setTimeout(r,40))}};
try {
  await fiber;
  await until(()=>tools.schemas().length===24);
  await until(()=>settings.describe().some(x=>x.ns===entry.options.id&&x.autoGenerate===false));
  const row=settings.describe().find(x=>x.ns===entry.options.id);
  assert.ok(row,'Modern DSH must expose the plugin Config form');
  assert.equal(row.autoGenerate,false,'Use the purpose-built settings page');
  assert.equal(row.value.enabledTools.length,24,'Even legacy profiles default to all tools until a selection is saved');
  const originalFiber=fiber.uid;
  await settings.mutate(entry.options.id,[{op:'set',path:['indicatorPosition'],value:'bottom'},{op:'set',path:['indicatorIdleMs'],value:1200}],row.revision);
  assert.equal(fiber.uid,originalFiber,'Volatile settings must keep the owner instance alive');
  const controlRoot=(await readdir(root)).find(x=>x.startsWith('dsh-wcu-control-'));
  assert.ok(controlRoot);
  const liveFile=path.join(root,controlRoot,'settings.json');
  await until(async()=>JSON.parse(await readFile(liveFile,'utf8')).indicatorPosition==='bottom');
  await settings.update(entry.options.id,{cursorIndicatorEnabled:false});
  await until(async()=>JSON.parse(await readFile(liveFile,'utf8')).cursorIndicatorEnabled===false);
  assert.equal(JSON.parse(await readFile(editor.documentPath,'utf8')).cursorIndicatorEnabled,false);
  await settings.update(entry.options.id,{cursorIndicatorEnabled:true});
  await until(async()=>JSON.parse(await readFile(liveFile,'utf8')).cursorIndicatorEnabled===true);
  await settings.update(entry.options.id,{remoteIndicatorVisible:false});
  await until(async()=>JSON.parse(await readFile(liveFile,'utf8')).remoteIndicatorVisible===false);
  assert.equal(JSON.parse(await readFile(editor.documentPath,'utf8')).remoteIndicatorVisible,false);
  await settings.update(entry.options.id,{remoteIndicatorVisible:true});
  await until(async()=>JSON.parse(await readFile(liveFile,'utf8')).remoteIndicatorVisible===true);
  await settings.update(entry.options.id,{stopShortcut:'Ctrl+Alt+K'});
  assert.equal(entry.fiber.config.stopShortcut.get(),'Ctrl+Alt+K','Host must commit the shortcut volatile reference');
  await until(async()=>JSON.parse(await readFile(liveFile,'utf8')).stopShortcut==='Ctrl+Alt+K');
  assert.equal(JSON.parse(await readFile(editor.documentPath,'utf8')).stopShortcut,'Ctrl+Alt+K');
  for(const stopShortcut of ['Esc','Ctrl','F25','Ctrl+Ctrl+K'])await assert.rejects(settings.update(entry.options.id,{stopShortcut}));
  await settings.update(entry.options.id,{stopShortcut:''});
  await until(async()=>JSON.parse(await readFile(liveFile,'utf8')).stopShortcut==='');
  const releasePath=path.join(root,'release-lock');
  const locker=spawn('powershell.exe',['-NoProfile','-File',fileURLToPath(new URL('./host-settings-lock.ps1',import.meta.url)),'-ConfigPath',liveFile,'-ReleasePath',releasePath],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const lockReleased=new Promise((resolve,reject)=>{locker.once('error',reject);locker.once('exit',code=>code===0?resolve():reject(Error('Fixture lock failed: '+code)));});
  await new Promise((resolve,reject)=>{locker.stdout.once('data',chunk=>String(chunk).includes('locked')?resolve():reject(Error('Lock marker missing')));locker.once('error',reject);});
  try {
    await settings.update(entry.options.id,{stopShortcut:'F9'});
    await new Promise(resolve=>setTimeout(resolve,450));
    assert.equal(JSON.parse(await readFile(liveFile,'utf8')).stopShortcut,'','Locked file must retain the previous complete config');
  } finally { await writeFile(releasePath,'release'); }
  await lockReleased;
  await until(async()=>JSON.parse(await readFile(liveFile,'utf8')).stopShortcut==='F9');
  assert.ok(!(await readdir(path.dirname(liveFile))).some(name=>name.endsWith('.tmp')),'Failed writes must not leave temporary files');
  await settings.update(entry.options.id,{stopShortcut:''});
  await until(async()=>JSON.parse(await readFile(liveFile,'utf8')).stopShortcut==='');
  await settings.update(entry.options.id,{toolPreset:'custom',enabledTools:['screenshot','wait']});
  await until(()=>tools.schemas().length===2);
  assert.equal(JSON.parse(await readFile(editor.documentPath,'utf8')).enabledTools.length,2);
  await settings.update(entry.options.id,{enabledTools:[]});
  await until(()=>tools.schemas().length===0);
  await assert.rejects(settings.update(entry.options.id,{enabledTools:['unknown']}));
  assert.deepEqual(settings.describe().find(x=>x.ns===entry.options.id).value.enabledTools,[]);
  await settings.update(entry.options.id,{enabledTools:row.value.enabledTools});
  await until(()=>tools.schemas().length===24);
  await settings.update(entry.options.id,{toolPreset:'custom',enabledTools:['wait']});
  await until(()=>tools.schemas().length===1);
  await settings.update(entry.options.id,{toolPreset:'lite'});
  await until(()=>tools.schemas().length===10);
  await settings.update(entry.options.id,{toolPreset:'full'});
  await until(()=>tools.schemas().length===24);
  assert.deepEqual(settings.describe().find(x=>x.ns===entry.options.id).value.enabledTools,['wait'],'Changing a preset must preserve the custom list');
  await settings.update(entry.options.id,{toolPreset:'custom'});
  await until(()=>tools.schemas().length===1);
  await settings.update(entry.options.id,{toolPreset:'full',enabledTools:row.value.enabledTools});
  await until(()=>tools.schemas().length===24);
  for (const key of ['browserFirst','browserVisible']) {
    assert.equal(settings.describe().find(x=>x.ns===entry.options.id).value[key],true);
    await settings.update(entry.options.id,{[key]:false});
    await until(async()=>JSON.parse(await readFile(liveFile,'utf8'))[key]===false);
    assert.equal(JSON.parse(await readFile(editor.documentPath,'utf8'))[key],false);
    await settings.update(entry.options.id,{[key]:true});
    await until(async()=>JSON.parse(await readFile(liveFile,'utf8'))[key]===true);
  }
  // The browser follows the Windows default and sign-ins stay off until chosen.
  assert.deepEqual((({browserApp,browserSignIn})=>[browserApp,browserSignIn])(settings.describe().find(x=>x.ns===entry.options.id).value),['default',false]);
  await settings.update(entry.options.id,{browserApp:'edge',browserSignIn:true});
  await until(async()=>{const live=JSON.parse(await readFile(liveFile,'utf8'));return live.browserApp==='edge'&&live.browserSignIn===true;});
  await settings.update(entry.options.id,{browserApp:'default',browserSignIn:false});
  await until(async()=>{const live=JSON.parse(await readFile(liveFile,'utf8'));return live.browserApp==='default'&&live.browserSignIn===false;});
  await settings.update(entry.options.id,{toolPreset:'lazy'});
  await until(()=>tools.schemas().length===1&&tools.schemas()[0].name.endsWith('windows_computer_use_tools'));
  assert.equal(JSON.parse(await readFile(editor.documentPath,'utf8')).toolPreset,'lazy');
  const manage=async args=>{
    const result=await tools.execute({callId:'lazy-'+Date.now(),name:'mcp__wincu__windows_computer_use_tools',arguments:args,signal:new AbortController().signal});
    assert.ok(!result.isError,JSON.stringify(result));return result;
  };
  await manage({operation:'enable',names:['wait','health']});
  await until(()=>tools.schemas().length===3);
  await manage({operation:'enable',names:['*']});
  await until(()=>tools.schemas().length===24);
  // Restart a fresh official bridge from the persisted settings, not runtime state.
  const restarted=new Context();
  restarted.provide('systemPrompt',{tools(){return ()=>{}},section(){return ()=>{}},getSectionOrder(){return 0}});
  const restartedTools=new ToolRuntime(restarted);
  try{
    await restarted.plugin(adapter,JSON.parse(await readFile(editor.documentPath,'utf8')));
    await until(()=>restartedTools.schemas().length===1);
    assert.ok(restartedTools.schemas()[0].name.endsWith('windows_computer_use_tools'));
  }finally{await restarted.fiber.dispose();}
  await manage({operation:'disable',names:['*']});
  await until(()=>tools.schemas().length===1);
  await manage({operation:'enable',names:['wait']});
  await until(()=>tools.schemas().length===2);
  await manage({operation:'reset'});
  await until(()=>tools.schemas().length===1);
  await settings.update(entry.options.id,{toolPreset:'full'});
  await until(()=>tools.schemas().length===24);
  await settings.update(entry.options.id,{toolPreset:'lazy'});
  await until(()=>tools.schemas().length===1);
  await settings.update(entry.options.id,{toolPreset:'custom',enabledTools:['wait']});
  await until(()=>tools.schemas().length===1&&tools.schemas()[0].name.endsWith('windows_computer_use_wait'));
  await settings.update(entry.options.id,{toolPreset:'full'});
  await until(()=>tools.schemas().length===24);
  await assert.rejects(settings.update(entry.options.id,{toolPreset:'unknown'}));
  assert.equal(fiber.uid,originalFiber,'Tool changes keep the adapter owner while refreshing its bridge');
  await settings.update(entry.options.id,{resumeToken:1,previewToken:1});
  await until(async()=>JSON.parse(await readFile(liveFile,'utf8')).resumeToken===1);
  const report={passed:true,hostVersion:require('@deepseek-ai/dsh/package.json').version,bridgeVersion:require('@deepseek-ai/dsh-mcp-client/package.json').version,
    namespace:entry.options.id,volatileSettings:true,liveDisplayConfig:true,toolSelectionReload:[24,2,0,24],presetReload:[1,10,24,1,24,1,24,1,1,24],lazyPresetPersistence:true,lazyWorkerRestart:true,lazyDynamicRegistry:[1,3,24,1,2,1],customSelectionPreserved:true,allToolsDefault:true,toolSelectionPersistence:true,invalidToolRejected:true,
    remoteVisibilityPersistence:true,remoteVisibilityLiveConfig:true,previewAndResumeSignals:true,cursorIndicatorPersistence:true,cursorIndicatorLiveConfig:true,shortcutPersistence:true,shortcutValidation:true,shortcutClear:true,lockedConfigWriteRetried:true,existingUserProfilesModified:false,physicalInputSent:false,profileFixture:root};
  await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await ctx.fiber.dispose();process.env.TEMP=previousTemp;process.env.TMP=previousTmp;}
