import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readdir,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-precompiled-'));
const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
function run(file,args=[],options={}){
  const result=spawnSync(shell,['-NoProfile','-File',path.resolve(import.meta.dirname,'../',file),...args],{encoding:'utf8',windowsHide:true,timeout:60000,...options});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr);return result;
}
run('scripts/build-native.ps1',['-Check']);
run('test/packaged-helper.ps1',['-Root',path.join(root,'integrity')]);
const results=[];
for(const fallback of [false,true]){
  const temp=path.join(root,fallback?'fallback':'packaged');await mkdir(temp);
  const started=performance.now();
  const result=run('scripts/windows-uia.ps1',['-Action','health'],{input:'{}',env:{...process.env,TEMP:temp,TMP:temp,WCU_BACKEND_TRACE:'1',WCU_DISABLE_PRECOMPILED:fallback?'1':'0'}});
  assert.equal(JSON.parse(result.stdout).ok,true);
  const caches=(await readdir(temp)).filter(name=>name.startsWith('wcu-native-')&&name.endsWith('.dll'));
  assert.equal(caches.length,fallback?1:0);
  if(!fallback)assert.match(result.stderr,/precompiled=native/);
  results.push({fallback,elapsedMs:Math.round(performance.now()-started),nativeCacheDlls:caches.length});
}
await writeFile(path.join(root,'results.json'),JSON.stringify({passed:true,results},null,2));
console.log(JSON.stringify({passed:true,binaryIntegrity:true,sourceIntegrity:true,normalStartupWithoutNativeCompile:true,fallbackVerified:true,results,root}));
