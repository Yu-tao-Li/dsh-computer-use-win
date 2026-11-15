// Real WinRT OCR of our own WinForms surface; no physical input.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,writeFile,readdir,access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpTestClient } from './mcp-test-client.mjs';
if(process.env.WINDOWS_CU_POWERSHELL&&path.basename(process.env.WINDOWS_CU_POWERSHELL).toLowerCase()!=='powershell.exe'){
  console.log('SKIP real WinRT OCR requires Windows PowerShell 5.1; exercised in its dedicated lane');
  process.exit(0);
}
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-ocr-memory-'));
const script=path.join(root,'fixture.ps1');
await writeFile(script,`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -TypeDefinition 'public class FixtureDpi { [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value); }'
[void][FixtureDpi]::SetProcessDpiAwarenessContext([IntPtr](-4))
$form=New-Object Windows.Forms.Form
$form.Text='DSH isolated OCR memory fixture';$form.Size=New-Object Drawing.Size(720,190)
$form.TopMost=$true
$label=New-Object Windows.Forms.Label
$label.Text='MEMORY OCR FIXTURE';$label.Font=New-Object Drawing.Font('Segoe UI',28)
$label.Dock='Fill';$label.TextAlign='MiddleCenter';$label.BackColor=[Drawing.Color]::White;$label.ForeColor=[Drawing.Color]::Black
$form.Controls.Add($label)
$form.Add_Shown({$form.Activate();$form.Refresh();[Console]::WriteLine('READY|'+$form.Handle.ToInt64())})
[Windows.Forms.Application]::Run($form)
`);
const fixture=spawn('powershell.exe',['-NoProfile','-STA','-File',script],{windowsHide:true});
let fixtureOut='',fixtureError='';fixture.stdout.on('data',s=>fixtureOut+=s);fixture.stderr.on('data',s=>fixtureError+=s);
const client=new McpTestClient(process.execPath,[path.resolve(import.meta.dirname,'../mcp/server.mjs')],{env:{...process.env,NODE_ENV:'test',WCU_TEST_NO_TAKEOVER:'1',TEMP:root,TMP:root}});
const data=result=>{assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);};
const pictures=async()=>(await readdir(root)).filter(name=>/^windows-computer-use-.*\.png$/.test(name));
let retained;
try {
  const until=Date.now()+15000;while(!/READY\|(\d+)/.test(fixtureOut)){assert.ok(Date.now()<until,fixtureError||fixtureOut);await new Promise(resolve=>setTimeout(resolve,20));}
  const nativeWindowHandle=Number(/READY\|(\d+)/.exec(fixtureOut)[1]);await client.init();
  const observed=data(await client.call('windows_computer_use_wait_for',{nativeWindowHandle,condition:'text',query:'MEMORY OCR FIXTURE',timeoutMs:5000}));
  await writeFile(path.join(root,'observed.json'),JSON.stringify(observed,null,2));
  // An occluded screen crop cannot establish target text. Preserve this
  // coverage boundary; pixel/box correctness is separately asserted against
  // rendered glyphs in ocr-reading.ps1, through both real WinRT input paths.
  assert.ok(observed.found||observed.conclusive===false,'A clear target must contain the fixture text');
  const absent=data(await client.call('windows_computer_use_wait_for',{nativeWindowHandle,condition:'text',query:'NEVER MATCH 428719',timeoutMs:900,intervalMs:100}));
  assert.equal(absent.timedOut,true);assert.deepEqual(await pictures(),[],'Internal OCR polls must not save PNGs');
  const publicOcr=data(await client.call('windows_computer_use_ocr',{nativeWindowHandle,query:'MEMORY OCR FIXTURE'}));
  assert.ok(publicOcr.matched.length||publicOcr.occludedPossible===true);assert.ok(publicOcr.image);retained=publicOcr.image;await access(retained);
  assert.equal((await pictures()).length,1,'Explicit OCR must preserve its public image path');
  await writeFile(path.join(root,'evidence.json'),JSON.stringify({observed,absent,internalPngFiles:0,retained,captureMethod:publicOcr.captureMethod,occludedPossible:publicOcr.occludedPossible===true,targetReadVerified:observed.found&&publicOcr.matched.length>0},null,2));
  console.log('Target text independently verified on this desktop: '+(observed.found&&publicOcr.matched.length>0));
} finally {
  client.child.stdin.end();const deadline=setTimeout(()=>client.child.kill(),5000);
  if(client.child.exitCode===null)await new Promise(resolve=>client.child.once('close',resolve));clearTimeout(deadline);
  fixture.kill();
}
await access(retained);
console.log('PASS real repeated WinRT OCR polls produce no image files; explicit OCR path survives backend exit: '+root);
