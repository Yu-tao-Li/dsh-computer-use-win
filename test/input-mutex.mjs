// Real Windows named mutexes and shipped action dispatcher in separate processes.
// Only the downstream launch body is replaced; no desktop input is generated.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=await mkdtemp(path.join(os.tmpdir(),'wcu-input-mutex-'));
const worker=path.join(root,'worker.ps1');
await writeFile(worker,`param($Source,$MutexName,$Role)
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Source did not parse'}
foreach($name in @('Get-Prop','Get-DesktopInputMutexName','Enter-DesktopInput','Exit-DesktopInput','Invoke-Action')){
  $node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  . ([scriptblock]::Create($node.Extent.Text))
}
function Get-DesktopInputMutexName { return $MutexName }
function Test-Failsafe {}
$script:Calls=0
function Invoke-LaunchApp {param($InputObject) $script:Calls++;if($InputObject.fail){throw 'fixture-failure'};return @{ok=$true;calls=$script:Calls}}
# Keep the named object alive when a holder dies so abandonment is observable.
$keep=New-Object Threading.Mutex($false,$MutexName)
$lease=$null;$nested=$null
try {
  if($Role -eq 'hold'){$lease=Enter-DesktopInput;$nested=Enter-DesktopInput;Exit-DesktopInput $nested;$nested=$null}
  [Console]::WriteLine('{"ready":true}')
  while($null -ne ($line=[Console]::ReadLine())){
    try {
      $request=ConvertFrom-Json $line
      if($request.release){Exit-DesktopInput $lease;$lease=$null;$result=@{ok=$true}}
      else {$result=Invoke-Action $request.action $request.args}
      [Console]::WriteLine((ConvertTo-Json -Compress @{result=$result}))
    } catch {[Console]::WriteLine((ConvertTo-Json -Compress @{error=$_.Exception.Message}))}
  }
} finally {Exit-DesktopInput $nested;Exit-DesktopInput $lease;$keep.Dispose()}
`);
const children=[];
const name=`Local\\DSH-WCU-Test-Input-${randomUUID()}`;
function start(role){
  const child=spawn(process.env.WINDOWS_CU_POWERSHELL||'powershell.exe',['-NoProfile','-File',worker,'-Source',fileURLToPath(new URL('../scripts/windows-uia.ps1',import.meta.url)),'-MutexName',name,'-Role',role],{windowsHide:true});
  children.push(child);
  let buffer='',stderr='';const waiting=[];const received=[];
  const timer=setTimeout(()=>child.kill(),30000);
  child.stderr.on('data',s=>stderr+=s);child.stdout.setEncoding('utf8');
  child.stdout.on('data',s=>{buffer+=s;let end;while((end=buffer.indexOf('\n'))>=0){const value=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(waiting.length)waiting.shift().resolve(value);else received.push(value);}});
  child.once('close',()=>{clearTimeout(timer);for(const item of waiting)item.reject(new Error(stderr||'Worker exited'));});
  const next=()=>received.length?Promise.resolve(received.shift()):new Promise((resolve,reject)=>waiting.push({resolve,reject}));
  return {child,ready:next(),request(value){child.stdin.write(JSON.stringify(value)+'\n');return next();}};
}
try {
  const actor=start('actor');assert.equal((await actor.ready).ready,true);
  const holder=start('hold');await holder.ready;
  assert.match((await actor.request({action:'launch_app',args:{}})).error,/COMPUTER_USE_BUSY/);
  assert.equal((await actor.request({action:'wait',args:{milliseconds:1}})).result.ok,true,'Observation/wait must not acquire the input lease');
  assert.match((await actor.request({action:'wait',args:{milliseconds:1,activate:true}})).error,/COMPUTER_USE_BUSY/,'Explicit activation must be guarded');
  await holder.request({release:true});
  assert.equal((await actor.request({action:'launch_app',args:{}})).result.calls,1,'Rejected actions must not reach the launch body');
  assert.match((await actor.request({action:'launch_app',args:{fail:true}})).error,/fixture-failure/);
  assert.equal((await actor.request({action:'launch_app',args:{}})).result.calls,3,'A throwing action must release ownership');
  const dying=start('hold');await dying.ready;
  const closed=new Promise(resolve=>dying.child.once('close',resolve));dying.child.kill();await closed;
  assert.match((await actor.request({action:'launch_app',args:{}})).error,/COMPUTER_USE_PREVIOUS_INPUT_INTERRUPTED/);
  assert.equal((await actor.request({action:'launch_app',args:{}})).result.calls,4,'A fresh action can acquire after interruption was reported');
  console.log('PASS cross-process exclusion, nesting, read-only access, activation guard, exception cleanup and abandoned-holder recovery; no physical input');
} finally {for(const child of children)if(child.exitCode===null)child.stdin.end();}
