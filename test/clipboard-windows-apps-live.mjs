// Optional real Ctrl+V integration. Only a unique task-created Notepad file
// and a newly discovered Calculator window may receive input. No process kill.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
import {McpTestClient} from './mcp-test-client.mjs';import {DEFAULT_SETTINGS} from '../mcp/settings.mjs';
if(!process.argv.includes('--live-input'))throw new Error('Pass --live-input to exercise owned Notepad/Calculator windows');
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-clipboard-apps-'));
const config=path.join(root,'settings.json');await writeFile(config,JSON.stringify({...DEFAULT_SETTINGS,progressOverlayEnabled:false,indicatorEnabled:false,cursorIndicatorEnabled:false}));
const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const client=new McpTestClient(process.execPath,[path.resolve(import.meta.dirname,'../mcp/server.mjs')],{env:{...process.env,NODE_ENV:'test',WCU_TEST_NO_TAKEOVER:'0',WCU_BROWSER_LANE:'off',WCU_CONFIG_FILE:config}});
const results=[];
const call=async(name,args={})=>{const reply=await client.call('windows_computer_use_'+name,args);if(reply.isError)throw new Error(reply.content[0].text);return JSON.parse(reply.content[0].text);};
const windows=async()=> (await call('list_windows',{maxWindows:200,includeInvisible:true})).windows;
async function preserveClipboard(text){
  const child=spawn(shell,['-NoProfile','-STA','-File',path.resolve(import.meta.dirname,'clipboard-consumer-owner.ps1'),'-SnapshotOnly','-ExpectedText',text],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',error='';child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{error+=data});
  const deadline=Date.now()+10000;while(!output.includes('"ready"')){if(Date.now()>deadline||child.exitCode!==null)throw Error('Clipboard snapshot failed: '+error);await delay(20);}
  return async()=>{child.stdin.end('pasted\n');for(let i=0;i<200&&child.exitCode===null;i++)await delay(20);assert.equal(child.exitCode,0,error);};
}
async function waitWindow(predicate){const deadline=Date.now()+15000;while(Date.now()<deadline){const matches=(await windows()).filter(predicate);if(matches.length===1)return matches[0];if(matches.length>1)throw Error('Ambiguous owned fixture window');await delay(200);}throw Error('No isolated fixture window appeared');}
const title=window=>String(window.name??window.title??'');
try{
  await client.init();
  const stem='WCU_clipboard_'+path.basename(root),file=path.join(root,stem+'.txt'),anchor='WCU_OWNED_DOCUMENT';
  await writeFile(file,anchor,'utf8');
  const launch=spawn(path.join(process.env.SystemRoot,'System32/notepad.exe'),[file],{windowsHide:false,stdio:'ignore'});launch.on('error',()=>{});
  const note=await waitWindow(window=>title(window).includes(stem));
  const target={nativeWindowHandle:note.nativeWindowHandle,processId:note.processId,windowTitle:stem};
  await call('activate_window',target);
  const found=await call('find',{...target,query:anchor,maxResults:20,treeTimeoutMs:5000});
  const edit=found.results.find(item=>['Edit','Document'].includes(item.controlType));
  if(!edit)throw Error('The owned Notepad editor was not identified; no paste sent');
  const text='WCU_NOTEPAD_NEW_'+path.basename(root),restore=await preserveClipboard(text);
  try{
    await call('focus',{...target,elementId:edit.id});
    const pasted=await call('type_text',{...target,method:'clipboard',text,restoreClipboard:true});
    await call('keypress',{...target,keys:['ctrl','s']});
    let saved='';for(let i=0;i<50;i++){saved=await readFile(file,'utf8');if(saved.includes(text))break;await delay(100);}
    assert(saved.includes(text)&&saved.includes(anchor),'Read back the actual owned file after pasting and saving');
    results.push({application:'Notepad',passed:true,requestedTextObserved:true,verification:'saved owned file bytes',targetProcessId:note.processId,clipboardRequested:pasted.clipboardRequested,clipboardRestored:pasted.clipboardRestored,requesterProcessId:pasted.clipboardRequestProcessId,requestWindow:pasted.clipboardRequestWindow,foregroundRestored:pasted.foregroundRestored,ownedFile:file});
    // Close only this saved file's tab; never terminate a shared Notepad process.
    await call('keypress',{...target,keys:['ctrl','w']});
  }finally{await restore();}
  const before=new Set((await windows()).map(window=>String(window.nativeWindowHandle)));
  const calcLaunch=spawn(path.join(process.env.SystemRoot,'System32/calc.exe'),[],{windowsHide:false,stdio:'ignore'});calcLaunch.on('error',()=>{});
  const calc=await waitWindow(window=>!before.has(String(window.nativeWindowHandle))&&/计算器|calculator/i.test(title(window)));
  const calcTarget={nativeWindowHandle:calc.nativeWindowHandle,processId:calc.processId};
  const number='723451',restoreCalc=await preserveClipboard(number);
  try{
    const pasted=await call('type_text',{...calcTarget,method:'clipboard',text:number,restoreClipboard:true});
    const tree=await call('accessibility_tree',{...calcTarget,maxDepth:10,maxNodes:500});
    const names=[];const visit=node=>{if(!node)return;if(node.name)names.push(node.name);for(const child of node.children??[])visit(child);};visit(tree.tree);
    assert(names.some(name=>name.replace(/[^0-9]/g,'').includes(number)),'Read back the Calculator display after actual paste');
    results.push({application:'Windows Calculator',passed:true,requestedTextObserved:true,verification:'owned Calculator UIA display',targetProcessId:calc.processId,clipboardRequested:pasted.clipboardRequested,clipboardRestored:pasted.clipboardRestored,requesterProcessId:pasted.clipboardRequestProcessId,requestWindow:pasted.clipboardRequestWindow,foregroundRestored:pasted.foregroundRestored});
    await call('close_window',calcTarget);
  }finally{await restoreCalc();}
  await writeFile(path.join(root,'results.json'),JSON.stringify({passed:true,results,physicalInputSent:true,existingDocumentsModified:false},null,2));
  console.log(JSON.stringify({passed:true,results,root}));
}catch(error){await writeFile(path.join(root,'failure.json'),JSON.stringify({error:error.stack,results},null,2));console.error('Owned fixture diagnostics: '+root);throw error;}
finally{client.child.stdin.end();for(let i=0;i<150&&client.child.exitCode===null;i++)await delay(50);if(client.child.exitCode===null)client.close();}
