// Real MCP + Explorer launch test, including a kill-on-close Job negative control.
// Only dedicated, no-window fixtures are launched; no user app or registry writes.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,writeFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {McpTestClient} from './mcp-test-client.mjs';
const server=path.resolve(import.meta.dirname,'../mcp/server.mjs');
const powershell=process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe';
const prefix='windows_computer_use_';
const text=r=>r.content?.filter(p=>p.type==='text').map(p=>p.text).join('\n') || '';
const data=r=>{assert.notEqual(r.isError,true,text(r));return JSON.parse(text(r));};
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function readReady(file){for(let i=0;i<150;i++){try{return JSON.parse(await readFile(file,'utf8'));}catch{await delay(100);}}throw new Error('Fixture not ready: '+file);}
async function stopFixture(file){
  if(!existsSync(file))return;
  const info=await readReady(file); await writeFile(file+'.stop','stop');
  for(let i=0;i<30&&alive(info.pid);i++)await delay(100);
  assert.equal(alive(info.pid),false,'Own fixture did not exit after stop marker');
}
const env={...process.env,NODE_ENV:'test',WCU_TEST_NO_TAKEOVER:'1',WCU_INDICATOR:'0',WCU_BROWSER_HEADLESS:'1',ELECTRON_RUN_AS_NODE:'1',WCU_LAUNCH_TEST_POISON:'wcu-parent-only'};
const makeClient=extra=>new McpTestClient(process.execPath,[server],{env:{...env,...extra}});
const quote=v=>'"'+v.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';

if(process.argv[2]==='--job-child'){
  const [root,exe]=process.argv.slice(3), ready=path.join(root,'job-ready.json');
  const ordinary=path.join(root,'ordinary.json'), launched=path.join(root,'shell.json');
  const child=spawn(exe,[ordinary,'ordinary child'],{windowsHide:true,env});
  const client=makeClient();
  try{
    await client.init();
    const response=await client.call(prefix+'launch_app',{target:exe,arguments:[launched,'空格 中文','a&b|c;literal'].map(quote).join(' '),workingDirectory:root,waitMs:0});
    const result=data(response), regular=await readReady(ordinary), shell=await readReady(launched);
    await writeFile(ready,JSON.stringify({result,regular,shell,nodePid:process.pid,mcpPid:client.child.pid,ordinaryPid:child.pid},null,2));
    setInterval(()=>{},1000);
  }catch(error){await writeFile(ready,JSON.stringify({error:error.stack,stderr:client.stderr}));process.exitCode=1;client.close();}
}else{
  const base=process.env.WCU_TEST_OUTPUT || os.tmpdir(); await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'launch-app-')), exe=path.join(root,'fixture with spaces.exe');
  const results=[],fixtures=[];
  const compiler=path.join(process.env.WINDIR || 'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  assert.ok(existsSync(compiler),'Framework compiler is required');
  const compiled=spawnSync(compiler,['/nologo','/target:winexe','/out:'+exe,'/r:System.Management.dll','/r:System.Web.Extensions.dll',path.join(import.meta.dirname,'launch-app-fixture.cs')],{encoding:'utf8',windowsHide:true});
  assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
  const shortcut=path.join(root,'fixture shortcut.lnk'), shortcutConfig=path.join(root,'shortcut-config.json');
  await writeFile(shortcutConfig,JSON.stringify({target:exe,path:shortcut}));
  const shortcutScript=path.join(root,'create-shortcut.ps1');
  await writeFile(shortcutScript,`param([string]$Config)\n$ErrorActionPreference='Stop'\n$c=Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json\n$s=New-Object -ComObject WScript.Shell\n$l=$s.CreateShortcut($c.path)\n$l.TargetPath=$c.target\n$l.Save()\n[void][Runtime.InteropServices.Marshal]::ReleaseComObject($l)\n[void][Runtime.InteropServices.Marshal]::ReleaseComObject($s)\n`);
  const made=spawnSync(powershell,['-NoProfile','-File',shortcutScript,'-Config',shortcutConfig],{windowsHide:true,encoding:'utf8'});
  assert.equal(made.status,0,made.stdout+made.stderr);assert.ok(existsSync(shortcut));
  let client;
  try{
    for(const mode of ['full','lite','lazy']){
      client=makeClient({WCU_TOOL_MODE:mode});await client.init();
      if(mode==='lazy')data(await client.call(prefix+'tools',{operation:'enable',names:['launch_app']}));
      assert.ok((await client.request('tools/list')).tools.some(t=>t.name===prefix+'launch_app'));
      client.close();client=null;
    }
    results.push({name:'catalogue-full-lite-lazy',passed:true});
    client=makeClient();await client.init();
    const script=path.join(root,'not-an-app.ps1');await writeFile(script,'throw "must not execute"');
    for(const args of [
      {target:''},{target:'  '},{target:path.join(root,'missing.exe')},{target:script},{target:'https://example.com'},
      {target:'C:Windows\\System32\\winver.exe'},{target:'\\Windows\\System32\\winver.exe'},
      {target:exe,workingDirectory:'relative'},{target:exe,workingDirectory:path.join(root,'missing-dir')},
      {target:exe,workingDirectory:'C:Windows'},{target:exe,workingDirectory:'\\Windows'},
      {target:exe,arguments:'line\nbreak'},{target:exe,waitMs:-1},{target:exe,waitMs:10001},{target:exe,unknown:1}
    ]){const r=await client.call(prefix+'launch_app',args);assert.equal(r.isError,true,JSON.stringify({args,r}));results.push({name:'invalid-request',args,error:text(r),passed:true});}
    const pathKey=Object.keys(process.env).find(key=>key.toLowerCase()==='path') || 'PATH';
    for(const [name,target,extra] of [['absolute',exe,{}],['shortcut',shortcut,{}],['PATH',path.basename(exe),{[pathKey]:root+path.delimiter+process.env[pathKey]}],['environment','%WCU_LAUNCH_FIXTURE_EXE%',{WCU_LAUNCH_FIXTURE_EXE:exe}]]){
      client.close();client=makeClient(extra);await client.init();
      const ready=path.join(root,name+'.json');fixtures.push(ready);
      const result=data(await client.call(prefix+'launch_app',{target,arguments:[ready,'空格 中文','a&b|c;literal','quote"inside','trailing\\'].map(quote).join(' '),workingDirectory:root,waitMs:0}));
      assert.equal(result.verification,'dispatched');assert.equal(result.launchMethod,'explorer-shell');
      const info=await readReady(ready); assert.deepEqual(info.args.slice(1),['空格 中文','a&b|c;literal','quote"inside','trailing\\']);
      assert.equal(info.cwd.toLowerCase(),root.toLowerCase());assert.equal(info.parentName.toLowerCase(),'explorer');assert.notEqual(info.poison,'wcu-parent-only');assert.notEqual(info.electronRunAsNode,'1');
      client.close();client=null; await delay(400);assert.ok(alive(info.pid),'Fixture must survive MCP exit');
      results.push({name:'launch-and-MCP-exit',targetKind:name,passed:true,result,info});await stopFixture(ready);
      client=makeClient();await client.init();
    }
    client.close();client=null;
    const jobRoot=path.join(root,'job');await mkdir(jobRoot);
    fixtures.push(path.join(jobRoot,'ordinary.json'),path.join(jobRoot,'shell.json'));
    const config=path.join(root,'job-config.json');
    await writeFile(config,JSON.stringify({node:process.execPath,arguments:[path.join(import.meta.dirname,'launch-app.mjs'),'--job-child',jobRoot,exe].map(quote).join(' '),cwd:root,ready:path.join(jobRoot,'job-ready.json')}));
    const job=spawnSync(powershell,['-NoProfile','-File',path.join(import.meta.dirname,'launch-app-job.ps1'),'-Config',config],{encoding:'utf8',windowsHide:true,timeout:80000,env});
    await writeFile(path.join(root,'job-wrapper.log'),(job.stdout||'')+(job.stderr||''));
    assert.ifError(job.error);assert.equal(job.status,0,job.stdout+job.stderr);
    const proof=await readReady(path.join(jobRoot,'job-ready.json'));assert.ok(!proof.error,JSON.stringify(proof));
    await delay(700);
    assert.equal(proof.regular.inJob,true,'Negative control must belong to the kill-on-close Job');
    assert.equal(alive(proof.ordinaryPid),false,'Ordinary child must die when Job is closed');
    assert.equal(alive(proof.nodePid),false);assert.equal(alive(proof.mcpPid),false);
    assert.equal(alive(proof.shell.pid),true,'Shell-launched fixture must survive closing Job');
    assert.equal(proof.shell.parentName.toLowerCase(),'explorer');
    assert.notEqual(proof.shell.poison,'wcu-parent-only');assert.notEqual(proof.shell.electronRunAsNode,'1');
    const heart=path.join(jobRoot,'shell.json.heartbeat'), before=(await stat(heart)).size;
    await delay(600);assert.ok((await stat(heart)).size>before,'Survivor must continue doing work after Job closes');
    results.push({name:'kill-on-close-job',passed:true,proof,heartbeatContinues:true});
    await stopFixture(path.join(jobRoot,'shell.json'));
    console.log(JSON.stringify({passed:true,powershell,node:process.version,artifacts:root,results},null,2));
  }finally{
    client?.close();
    for(const ready of fixtures)if(existsSync(ready))await stopFixture(ready).catch(error=>console.error(error.message));
    await writeFile(path.join(root,'results.json'),JSON.stringify({powershell,node:process.version,results},null,2));
  }
}
