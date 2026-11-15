const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');const fs=require('node:fs'),path=require('node:path');const assert=require('node:assert/strict');
const root=process.env.WCU_CLIPBOARD_TEST_ROOT;
app.setPath('userData',path.join(root,'user-data'));app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});
  let owner,stderr='';
  try{
    await win.loadURL('data:text/html,<title>Clipboard consumer fixture</title><textarea autofocus></textarea>');
    await win.webContents.executeJavaScript("document.querySelector('textarea').focus();void 0");
    const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
    owner=spawn(shell,['-NoProfile','-STA','-File',path.join(__dirname,'clipboard-consumer-owner.ps1'),'-TargetProcessId',String(process.pid)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const messages=[];let buffered='';owner.stdout.setEncoding('utf8');owner.stdout.on('data',data=>{buffered+=data;let end;while((end=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,end);buffered=buffered.slice(end+1);if(line.trim())messages.push(JSON.parse(line));}});owner.stderr.on('data',data=>{stderr+=data});
    const until=async fn=>{const deadline=Date.now()+10000;while(!fn()){if(Date.now()>deadline||owner.exitCode!==null)throw Error('Clipboard owner did not answer: '+stderr);await new Promise(r=>setTimeout(r,20));}return fn();};
    const ready=await until(()=>messages.find(item=>item.kind==='ready'));
    await new Promise(r=>setTimeout(r,150));
    win.webContents.paste();
    const deadline=Date.now()+3000;let value;
    do{value=await win.webContents.executeJavaScript("document.querySelector('textarea').value");if(value===ready.text)break;await new Promise(r=>setTimeout(r,20));}while(Date.now()<deadline);
    owner.stdin.end('pasted\n');
    const result=await until(()=>messages.find(item=>item.kind==='result'));
    assert.equal(value,ready.text,'The Chromium editor must receive the new text after the 150 ms delayed paste');
    for(let i=0;i<150&&owner.exitCode===null;i++)await new Promise(r=>setTimeout(r,20));assert.equal(owner.exitCode,0,stderr);
    const report={passed:true,application:'Electron Chromium',chromium:process.versions.chrome,driver:'webContents.paste into an owned hidden textarea',delayedReadMs:150,requestedTextObserved:true,physicalInputSent:false,...result};delete report.kind;
    fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,root}));
  }finally{if(owner&&owner.exitCode===null){owner.stdin.end();for(let i=0;i<150&&owner.exitCode===null;i++)await new Promise(r=>setTimeout(r,20));if(owner.exitCode===null)owner.kill();}win.destroy();app.quit();}
}).catch(error=>{console.error(error.stack);app.exit(1)});
