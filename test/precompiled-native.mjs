import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readdir,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-precompiled-'));
const framework=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
function run(shell,file,args=[],options={}){
  const result=spawnSync(shell,['-NoProfile','-File',path.resolve(import.meta.dirname,'../',file),...args],{encoding:'utf8',windowsHide:true,timeout:60000,...options});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr);return result;
}
run(framework,'scripts/build-native.ps1',['-Check']);
run(framework,'test/packaged-helper.ps1',['-Root',path.join(root,'integrity')]);
const results=[];
const shells=new Set([framework,process.env.WINDOWS_CU_POWERSHELL].filter(Boolean));
for(const shell of shells){
  const runtime=spawnSync(shell,['-NoProfile','-Command',"$PSVersionTable.PSEdition -ne 'Core' -or $PSVersionTable.PSVersion -ge [version]'7.4'"],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.ifError(runtime.error);assert.equal(runtime.status,0,runtime.stderr);
  const packageCompatible=runtime.stdout.trim()==='True';
  for(const fallback of [false,true]){
    const temp=await mkdtemp(path.join(root,fallback?'fallback-':'packaged-'));
    const started=performance.now();
    const result=run(shell,'scripts/windows-uia.ps1',['-Action','health'],{input:'{}',env:{...process.env,TEMP:temp,TMP:temp,WCU_BACKEND_TRACE:'1',WCU_DISABLE_PRECOMPILED:fallback?'1':'0'}});
    const health=JSON.parse(result.stdout);
    assert.equal(health.ok,true);
    const caches=(await readdir(temp)).filter(name=>name.startsWith('wcu-native-')&&name.endsWith('.dll'));
    assert.equal(caches.length,fallback||!packageCompatible?1:0,result.stderr);
    if(!fallback&&packageCompatible)assert.match(result.stderr,/precompiled=native/);
    results.push({shell,fallback,elapsedMs:Math.round(performance.now()-started),nativeCacheDlls:caches.length});
  }
  const temp=await mkdtemp(path.join(root,'deferred-'));
  const actions=['wait','list_windows','health','health'].map((action,id)=>JSON.stringify({action,id,args:{milliseconds:1,maxWindows:2}}));
  const deferred=run(shell,'scripts/windows-uia.ps1',['-Persistent'],{
    input:actions.join('\n')+'\n',
    env:{...process.env,TEMP:temp,TMP:temp,WCU_BACKEND_TRACE:'1',WCU_DISABLE_PRECOMPILED:'0'}
  });
  const [ready,...responses]=deferred.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
  assert.equal(ready.type,'ready');
  assert.equal(responses.length,4);
  for(const response of responses)assert.equal(response.ok,true,JSON.stringify(response));
  const trace=deferred.stderr.split(/\r?\n/).map(line=>line.match(/^stage=(\S+)/)?.[1]).filter(Boolean);
  const serialized=trace.map((stage,index)=>stage==='response-serialize-start'?index:-1).filter(index=>index>=0);
  const uiaStart=trace.indexOf('uia-assemblies-start');
  assert.ok(uiaStart>serialized[1]&&uiaStart<serialized[2],deferred.stderr);
  assert.equal(trace.filter(stage=>stage==='uia-assemblies-start').length,1,'UIA loads once, only when needed');
}
await writeFile(path.join(root,'results.json'),JSON.stringify({passed:true,results},null,2));
console.log(JSON.stringify({passed:true,binaryIntegrity:true,sourceIntegrity:true,normalStartupWithoutNativeCompile:true,fallbackVerified:true,results,root}));
