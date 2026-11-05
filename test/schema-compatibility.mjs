import assert from 'node:assert/strict';
import z from '@deepseek-ai/schemastery';
import {TOOL_NAMES} from '../mcp/settings.mjs';
import {volatileEntries,updateVolatile} from '@deepseek-ai/cosmokit';
import {mkdtemp,mkdir,writeFile,utimes,symlink,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const original=z.prototype.volatile;
try{
 delete z.prototype.volatile;
 const adapter=await import('../mcp/dsh-plugin.mjs?without-volatile-convenience');
 for(const name of Object.keys(adapter.SettingsConfig.dict))assert.equal(adapter.Config.dict[name].meta.volatile,true,name+' must remain host-configurable without volatile()');
 const values=adapter.Config({indicatorEnabled:false,stopShortcut:'F8',browserFirst:false,browserVisible:false,browserApp:'chrome',browserSignIn:true});
 assert.equal(values.browserFirst.get(),false);assert.equal(values.browserVisible.get(),false);
 assert.equal(values.browserApp.get(),'chrome');assert.equal(values.browserSignIn.get(),true);
 assert.equal(adapter.Config({}).browserApp.get(),'default');assert.equal(adapter.Config({}).browserSignIn.get(),false);
 assert.equal(adapter.Config({}).progressOverlayMode.get(),'source');
 assert.equal(adapter.Config({progressOverlayMode:'summary'}).progressOverlayMode.get(),'summary');
 assert.ok(adapter.Config['~standard'].validate({progressOverlayMode:'unknown'}).value[adapter.REPAIRED_SETTINGS]);
 assert.equal(values.indicatorEnabled.get(),false);assert.equal(values.stopShortcut.get(),'F8');
 const reference=adapter.createLiveReference(['wait']);
 assert.equal(volatileEntries({reference}).length,1,'The host must recognize the fallback reference');
 updateVolatile(reference,adapter.createLiveReference(['screenshot']));
 assert.deepEqual(reference.get(),['screenshot']);assert.equal(Object.isFrozen(reference.get()),true);
 // #39: DSH refuses the whole entry when one saved value fails validation, and
 // every tool disappears. Choices this version does not offer fall back to
 // their defaults and are reported; typed values stay strict for the save path.
 const validate=input=>adapter.Config['~standard'].validate(input);
 assert.equal(adapter.Config({browserApp:'firefox'}).browserApp.get(),'firefox');
 const stale=validate({toolPreset:'smart',browserApp:'unknown-browser',browserVisible:'yes',enabledTools:['health','removed_tool','tools'],futureSetting:3});
 assert.equal(stale.issues,undefined,JSON.stringify(stale.issues));
 assert.equal(stale.value.toolPreset.get(),'auto');assert.equal(stale.value.browserApp.get(),'default');assert.equal(stale.value.browserVisible.get(),true);
 assert.deepEqual(stale.value.enabledTools.get(),['health','tools']);
 assert.deepEqual(stale.value[adapter.REPAIRED_SETTINGS],['toolPreset: "smart"','browserApp: "unknown-browser"','browserVisible: "yes"','enabledTools: "removed_tool"']);
 assert.equal(Object.getOwnPropertyDescriptor(stale.value,adapter.REPAIRED_SETTINGS).enumerable,false,'The report is not a setting and is never saved');
 const unknownOnly=validate({enabledTools:['removed_tool']});
 assert.equal(unknownOnly.issues,undefined);assert.equal(unknownOnly.value.enabledTools.get().length,TOOL_NAMES.length,'A list of unknown tools falls back to all tools, not none');
 const clean=validate({toolPreset:'lite',browserApp:'edge'});
 assert.equal(clean.issues,undefined);assert.equal(clean.value[adapter.REPAIRED_SETTINGS],undefined,'Valid settings are not reported');
 for(const typed of [{stopShortcut:'Esc'},{indicatorIdleMs:99999},{toolPreset:'smart',stopShortcut:'Ctrl'}])assert.ok(validate(typed).issues,'Typed values stay strict: '+JSON.stringify(typed));
 console.log(JSON.stringify({passed:true,volatileMethodAbsent:true,exposedFields:Object.keys(adapter.SettingsConfig.dict).length,falseValuePreserved:true,staleChoicesRepaired:4,typedValuesStrict:3}));
}finally{z.prototype.volatile=original;}
{
 const adapter=await import('../mcp/dsh-plugin.mjs');
 // #72: a failure seen on every 250 ms poll reaches the log once a minute.
 let clock=0;const lines=[];
 const log=adapter.limitedErrorLog({error:error=>lines.push('error '+error.message),warn:(_format,...values)=>lines.push('warn '+values.join(' '))},60000,()=>clock);
 for(let tick=0;tick<300;tick++){log(new Error('save failed'));if(tick===10)log(new Error('other failure'));clock+=250;}
 assert.deepEqual(lines,['error save failed','error other failure','error save failed','warn 239 60']);
 // #71: orphaned control directories are swept; live, recent and foreign ones stay.
 const tmp=await mkdtemp(path.join(os.tmpdir(),'wcu-control-sweep-'));
 const make=async(name,ageDays=0)=>{const dir=path.join(tmp,name);await mkdir(dir);await writeFile(path.join(dir,'settings.json'),'{}');
   if(ageDays){const time=new Date(Date.now()-ageDays*864e5);await utimes(path.join(dir,'settings.json'),time,time);await utimes(dir,time,time);}return dir;};
 await make(`dsh-wcu-control-${process.pid}-Live01`);await make('dsh-wcu-control-999999-Dead01');await make('dsh-wcu-control-424242-Alive1',30);
 await make('dsh-wcu-control-Old123',8);await make('dsh-wcu-control-New123',1);await make('unrelated-dir',30);
 const keep=await make('dsh-wcu-control-1-Keep01');
 assert.deepEqual(adapter.sweepControlDirs({tmp,keep,alive:pid=>pid===424242}).sort(),['dsh-wcu-control-999999-Dead01','dsh-wcu-control-Old123']);
 assert.deepEqual((await readdir(tmp)).sort(),['dsh-wcu-control-1-Keep01','dsh-wcu-control-424242-Alive1',`dsh-wcu-control-${process.pid}-Live01`,'dsh-wcu-control-New123','unrelated-dir'].sort());
 // A link with a control-directory name is never followed into its target.
 const target=await mkdtemp(path.join(os.tmpdir(),'wcu-control-target-'));await writeFile(path.join(target,'keep.txt'),'x');
 const links=await mkdtemp(path.join(os.tmpdir(),'wcu-control-links-'));await symlink(target,path.join(links,'dsh-wcu-control-Link01'),'junction');
 assert.equal(adapter.removeControlDir(path.join(links,'dsh-wcu-control-Link01')),false);
 assert.deepEqual(adapter.sweepControlDirs({tmp:links,maxAgeMs:-1}),[]);
 assert.ok(existsSync(path.join(target,'keep.txt')),'The link target survives');
 assert.equal(adapter.removeControlDir(path.join(tmp,'missing')),true,'A missing directory counts as removed');
 console.log(JSON.stringify({passed:true,errorLogLimited:true,controlDirSweep:true,linksNotFollowed:true}));
}
