// Real cold-start compilation races, and cache reuse across PowerShell runtimes.
// No desktop input. Retains test-created caches and JSON evidence for inspection.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const powershell=process.env.WINDOWS_CU_POWERSHELL||'powershell.exe';
const other=process.env.WCU_TEST_OTHER_POWERSHELL;
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-helper-concurrency-'));
const source=path.resolve(import.meta.dirname,'../scripts/windows-uia.ps1');
const results=[];
let saving=Promise.resolve();
async function health(shell,cache,label) {
  await mkdir(cache,{recursive:true});
  const child=spawn(shell,['-NoLogo','-NoProfile','-NonInteractive','-File',source,'-Action','health'],{windowsHide:true,env:{...process.env,TEMP:cache,TMP:cache}});
  child.stdin.end('{}');
  let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
  const timer=setTimeout(()=>child.kill(),60000);
  const exitCode=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);
  const result={label,shell,exitCode,stdout,stderr};results.push(result);
  const evidence=JSON.stringify(results,null,2)+'\n';
  saving=saving.then(()=>writeFile(path.join(root,'results.json'),evidence));
  await saving;
  assert.equal(exitCode,0,`${label}: ${stderr}`);
  assert.equal(JSON.parse(stdout.trim()).ok,true,`${label}: ${stdout}`);
}
console.log('Artifacts: '+root);
const race=path.join(root,'race');await mkdir(race);
await Promise.all(Array.from({length:6},(_,i)=>health(powershell,race,'same-runtime-cold-'+i)));
const files=await readdir(race);
assert.equal(files.filter(name=>/^wcu-native-.*\.dll$/.test(name)).length,1,'One complete cached native helper');
assert.equal(files.filter(name=>/\.(?:\d+\.)?[0-9a-f]{32}\.dll$|\.\d+\.dll$/.test(name)).length,0,'No per-process compilation files left after successful race');
console.log('PASS six simultaneous cold native helper compiles and atomic cache publication');
await health(powershell,race,'warm-cache');
console.log('PASS later process loads the published helper');
if(other) {
  await health(other,race,'other-runtime-reuses-cache');
  const reverse=path.join(root,'reverse');
  await health(other,reverse,'other-runtime-first');
  await health(powershell,reverse,'original-runtime-reuses-cache');
  console.log('PASS cache reuse in both runtime orders');
}
