// Every persisted setting through the real host settings and config editor.
// Invoked by host-settings-integration with WCU_TEST_ALL_SETTINGS=1.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {DEFAULT_SETTINGS,TOOL_NAMES,normalizeSettings} from '../mcp/settings.mjs';

export async function runSettingsMatrix({settings,namespace,liveFile,documentPath,until,root}){
  const cases={
    desktopTarget:['fast','hyperv','quiet'],hypervVm:['Wincu test VM',''],
    browserFirst:[false,true],browserVisible:[false,true],browserApp:['chrome','edge','firefox','default'],browserSignIn:[true,false],browserAttachUser:[true,false],
    progressOverlayEnabled:[false,true],progressOverlayMode:['summary','source'],progressOverlayOpacity:[20,100,60],progressOverlayWidth:[240,1600,360],progressOverlayHeight:[160,1600,240],
    progressOverlayPosition:['top-left','bottom-left','bottom-right','custom','top-right'],progressOverlayX:[-500,500,80],progressOverlayY:[-500,500,80],progressOverlayLocked:[false,true],progressLockShortcut:['Ctrl+Alt+P',''],progressPreviewToken:[1,0],
    mode:['lite','full'],toolPreset:['lite','lazy','custom','full'],enabledTools:[['health','tools'],[],[...TOOL_NAMES]],indicatorEnabled:[false,true],cursorIndicatorEnabled:[false,true],remoteIndicatorVisible:[false,true],indicatorText:['Audit banner','DSH 正在控制电脑'],indicatorPosition:['bottom','top'],indicatorIdleMs:[200,3000,800],stopShortcut:['Ctrl+Alt+K',''],communityNote:['link','full'],resumeToken:[1,0],previewToken:[1,0]
  };
  assert.deepEqual(Object.keys(cases).sort(),Object.keys(DEFAULT_SETTINGS).sort(),'Every persisted setting must have cases');
  const results=[];
  for(const [key,values]of Object.entries(cases))for(const value of values){
    const before=settings.describe().find(x=>x.ns===namespace).value;
    const expected=normalizeSettings({...before,[key]:value})[key];
    await settings.update(namespace,{[key]:value});
    await until(async()=>JSON.stringify(JSON.parse(await readFile(liveFile,'utf8'))[key])===JSON.stringify(expected));
    assert.deepEqual(JSON.parse(await readFile(documentPath,'utf8'))[key],value,'Persisted '+key);
    results.push({key,value,status:'pass'});
  }
  const invalid={hypervVm:['a\nb','x'.repeat(121)],indicatorText:['','a\nb','x'.repeat(121)],indicatorIdleMs:[199,3001,1.5],progressOverlayOpacity:[19,101],progressOverlayWidth:[239,1601],progressOverlayHeight:[159,1601],progressOverlayX:[-32769,32768],progressOverlayY:[-32769,32768],stopShortcut:['Esc','Ctrl+Ctrl+K','F25'],progressLockShortcut:['Esc'],resumeToken:[-1,0.5],previewToken:[-1,0.5],progressPreviewToken:[-1,0.5]};
  for(const [key,values]of Object.entries(invalid))for(const value of values){
    const previous=await readFile(documentPath,'utf8');
    await assert.rejects(settings.update(namespace,{[key]:value}));
    assert.equal(await readFile(documentPath,'utf8'),previous,'An invalid setting must not be persisted');
    results.push({key,value,invalid:true,status:'pass'});
  }
  const report={passed:true,keys:Object.keys(cases).length,cases:results.length,results,scope:'Host persistence, validation and live config; application effects are covered separately'};
  await writeFile(path.join(root,'settings-matrix.json'),JSON.stringify(report,null,2));
  return {passed:true,keys:report.keys,cases:report.cases};
}
