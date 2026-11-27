// Dedicated disposable Chromium window. Never uses a user's profile or content.
// Arg 3 is the accessibility mode: "sparse" (canvas, no forced a11y), "lazy"
// (no forced a11y, as Electron apps ship), otherwise forced a11y for old tests.
// Arg 4 is the page state for the content benchmark: rich, long, shell,
// canvas or image. It defaults to the state implied by arg 3.
const { app, BrowserWindow } = require('electron');
const { writeFileSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
app.setPath('userData', process.argv[2]);
const accessMode = process.argv[3] || '';
const sparse = accessMode === 'sparse';
const lazy = accessMode === 'lazy';
if (!sparse && !lazy) app.commandLine.appendSwitch('force-renderer-accessibility');
const page = process.argv[4] || (sparse ? 'canvas' : 'rich');
let window;

app.on('child-process-gone', (_event, details) => console.error('child-process-gone', JSON.stringify(details)));
app.whenReady().then(async () => {
  const position = process.env.WCU_TEST_WINDOW_X ? { x: Number(process.env.WCU_TEST_WINDOW_X), y: 80 } : {};
  window = new BrowserWindow({ ...position, width: 900, height: 650, show: false, frame: !sparse, webPreferences: { sandbox: true } });
  window.webContents.on('render-process-gone', (_event, details) => console.error('render-process-gone', JSON.stringify(details)));
  const dir = path.dirname(process.argv[2]);
  const file = path.join(dir, 'fixture.html');
  const rows = count => Array.from({ length: count }, (_, i) => `<section><h2>Row ${i}</h2><button>Item ${i}</button><p>Content ${i}</p></section>`).join('');
  const rich = `<!doctype html><title>WCU ${lazy ? 'issue50 lazy' : 'issue18 isolated'} Chromium fixture</title><main><h1>Cached UIA fixture</h1><label>Search<input aria-label="Fixture search" value="needle value"></label><button>Fixture action</button>${rows(100)}</main><script>window.__fixtureValue='needle value'</script>`;
  const long = `<!doctype html><title>WCU long Chromium fixture</title><main><h1>Long page</h1><label>Search<input aria-label="Fixture search" value="needle value"></label><button>Fixture action</button>${rows(1500)}</main><script>window.__fixtureValue='needle value'</script>`;
  // An unhydrated SPA shell: the page tree is attached but carries no text.
  // Hydration is deliberately late so every benchmark call sees the empty state.
  const shell = `<!doctype html><title>WCU empty shell fixture</title><body><div id="app"></div></body><script>window.__fixtureValue='needle value';setTimeout(()=>{document.getElementById('app').innerHTML='<main><h1>Hydrated</h1></main>'},30000)</script>`;
  const canvas = `<!doctype html><title>WCU isolated sparse canvas fixture</title><canvas id="panel" width="800" height="500" tabindex="0"></canvas><script>
    window.fixtureValue='SEARCH HERE';window.__fixtureValue=window.fixtureValue;
    const c=document.getElementById('panel'),g=c.getContext('2d');
    function draw(){g.fillStyle='#ffffff';g.fillRect(0,0,800,500);g.fillStyle='#dddddd';g.fillRect(60,60,600,70);g.fillStyle='#111111';g.font='32px Arial';g.fillText(window.fixtureValue,80,108);g.fillText('VISIBLE CANVAS',80,200)}
    c.addEventListener('click',()=>c.focus());c.addEventListener('paste',e=>{e.preventDefault();window.fixtureValue=e.clipboardData.getData('text');window.__fixtureValue=window.fixtureValue;draw()});draw();
  </script>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="100%" height="100%" fill="white"/><text x="60" y="120" font-size="40">VISIBLE IMAGE</text></svg>`;
  const image = `<!doctype html><title>WCU image fixture</title><body style="margin:0"><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}"></body><script>window.__fixtureValue='needle value'</script>`;
  const pages = { rich, long, shell, canvas, image };
  if (!pages[page]) throw new Error(`unknown page state ${page}`);
  writeFileSync(file, pages[page], 'utf8');
  await window.loadURL(pathToFileURL(file).href);
  window.showInactive();
  console.log(JSON.stringify({ ready: true, hwnd: window.getNativeWindowHandle().readUInt32LE(), pid: process.pid, chromium: process.versions.chrome, electron: process.versions.electron, page, forceAccessibility: !sparse && !lazy }));
}).catch(error => { console.error(error); app.exit(1); });

let last = 0;
setInterval(async () => {
  let command;
  try { command = JSON.parse(readFileSync(path.join(dirHint(), 'command.json'), 'utf8')); } catch { return; }
  if (command.id === last) return;
  last = command.id;
  if (command.action === 'ping') {
    const value = await window.webContents.executeJavaScript('window.__fixtureValue !== undefined ? window.__fixtureValue : (document.querySelector("input") && document.querySelector("input").value) || ""');
    console.log(JSON.stringify({ pong: value }));
  }
  if (command.action === 'quit') app.quit();
}, 100);
setTimeout(() => app.quit(), 120000);

function dirHint() {
  return path.dirname(process.argv[2]);
}
