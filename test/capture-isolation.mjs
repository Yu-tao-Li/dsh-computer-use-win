// Screen samples cover only the helper's opaque synthetic backdrop.
import assert from 'node:assert/strict';import {mkdtemp,writeFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';import {TakeoverControl} from '../mcp/takeover.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-capture-isolation-'));
const control=new TakeoverControl({powershell:'powershell.exe',testMode:true});control.disabledForTest=false;
const capture=async name=>{const file=path.join(root,name+'.png');await control.command('test_render_progress',{path:file,screen:true});return file;};
try{
 await control.command('progress',{enabled:true,remoteIndicatorVisible:true,settings:{progressOverlayEnabled:true,progressOverlayWidth:360,progressOverlayHeight:240,progressOverlayOpacity:100,progressOverlayLocked:true},progress:{step:1,status:'acting',steps:[{step:1,reasoning:'OVERLAY TEXT MUST NOT ENTER CAPTURE',reply:'',actions:[]}]}});
 await control.command('test_progress_layout',{x:80,y:80,width:360,height:240});await control.command('test_progress_backdrop');await new Promise(r=>setTimeout(r,120));
 const before=await capture('before');await control.command('capture_begin');const during=await capture('during');await control.command('capture_end');await new Promise(r=>setTimeout(r,80));const after=await capture('after');
 const sample=spawnSync('powershell.exe',['-NoProfile','-File',path.resolve(import.meta.dirname,'capture-pixels.ps1'),'-Before',before,'-During',during,'-After',after],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(sample.status,0,sample.stderr);const ratios=JSON.parse(sample.stdout);
 assert(ratios.before<.95&&ratios.after<.95,'Visible overlay must differ from backdrop');assert(ratios.during>.999,'Excluded capture must contain only the synthetic backdrop: '+JSON.stringify(ratios));
 const report={passed:true,ratios,actualScreenCapture:true,visibilityRestored:true,physicalInputSent:false,root};await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await control.close();}
