// Dedicated disposable Chromium window. Never uses a user's profile or content.
const { app, BrowserWindow } = require('electron');
const {writeFileSync,readFileSync} = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
app.setPath('userData', process.argv[2]);
const sparse=process.argv[3]==='sparse';
// lazy: the same page without forced accessibility, as Electron apps ship (issue #50).
const lazy=process.argv[3]==='lazy';
if(!sparse&&!lazy)app.commandLine.appendSwitch('force-renderer-accessibility');
let window;
app.on('child-process-gone',(_event,details)=>console.error('child-process-gone',JSON.stringify(details)));
app.whenReady().then(async () => {
  const position = process.env.WCU_TEST_WINDOW_X ? {x:Number(process.env.WCU_TEST_WINDOW_X),y:80} : {};
  window = new BrowserWindow({...position,width:900,height:650,show:false,frame:!sparse,webPreferences:{sandbox:true}});
  window.webContents.on('render-process-gone',(_event,details)=>console.error('render-process-gone',JSON.stringify(details)));
  const file=path.join(path.dirname(process.argv[2]),'fixture.html');
  const canvas=`<!doctype html><title>WCU isolated sparse canvas fixture</title><canvas id="panel" width="800" height="500" tabindex="0"></canvas><script>
    window.fixtureValue='SEARCH HERE';const c=document.getElementById('panel'),g=c.getContext('2d');
    function draw(){g.fillStyle='#ffffff';g.fillRect(0,0,800,500);g.fillStyle='#dddddd';g.fillRect(60,60,600,70);g.fillStyle='#111111';g.font='32px Arial';g.fillText(window.fixtureValue,80,108);g.fillText('VISIBLE CANVAS',80,200)}
    c.addEventListener('click',()=>c.focus());c.addEventListener('paste',e=>{e.preventDefault();window.fixtureValue=e.clipboardData.getData('text');draw()});draw();
  </script>`;
  writeFileSync(file,sparse?canvas:`<!doctype html><title>WCU ${lazy?'issue50 lazy':'issue18 isolated'} Chromium fixture</title><main><h1>Cached UIA fixture</h1><label>Search<input aria-label="Fixture search" value="needle value"></label><button>Fixture action</button>${Array.from({length:100},(_,i)=>`<section><h2>Row ${i}</h2><button>Item ${i}</button><p>Content ${i}</p></section>`).join('')}</main>`,'utf8');
  await window.loadURL(pathToFileURL(file).href);
  window.showInactive();
  console.log(JSON.stringify({ready:true,hwnd:window.getNativeWindowHandle().readUInt32LE(),pid:process.pid,chromium:process.versions.chrome,electron:process.versions.electron}));
}).catch(error=>{console.error(error);app.exit(1);});
let last=0;
setInterval(async()=>{
  let command;try{command=JSON.parse(readFileSync(path.join(path.dirname(process.argv[2]),'command.json'),'utf8'));}catch{return;}
  if(command.id===last)return;last=command.id;
  if(command.action==='ping') console.log(JSON.stringify({pong:await window.webContents.executeJavaScript(sparse?'window.fixtureValue':'document.querySelector("input").value')}));
  if(command.action==='quit') app.quit();
},100);
setTimeout(()=>app.quit(),120000);
