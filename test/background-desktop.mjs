import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { McpTestClient } from './mcp-test-client.mjs';
import { backgroundDesktopArgs, startBackgroundDesktop } from '../mcp/background-desktop.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-background-desktop-'));
const executable = path.join(root, 'fixture.exe');
const expected = 'Local workspace file 中文';
await writeFile(path.join(root, 'project.txt'), expected, 'utf8');
const source = String.raw`
using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
static class Fixture {
  [STAThread] public static void Main() {
    var window = new Form { Text="Wincu background desktop fixture", Width=550, Height=320, BackColor=Color.Magenta };
    var field = new TextBox { AccessibleName="Background text field", Left=20, Top=22, Width=380 };
    var button = new Button { Text="Background action", Left=20, Top=64, Width=180 };
    button.Click += (sender, args) => {
      File.WriteAllText("result.txt", File.ReadAllText("project.txt") + "|" + field.Text + "|" +
        Environment.GetEnvironmentVariable("WCU_FIXTURE_WORKSPACE") + "|" +
        (Environment.GetEnvironmentVariable("ELECTRON_RUN_AS_NODE") ?? "app"));
    };
    window.Controls.Add(field);
    window.Controls.Add(button);
    window.ActiveControl = field;
    Application.Run(window);
  }
}
`;
const sourcePath = path.join(root, 'fixture.cs');
await writeFile(sourcePath, source);
const build = "Add-Type -Path $env:WCU_SOURCE -OutputAssembly $env:WCU_BINARY -OutputType WindowsApplication -ReferencedAssemblies System.Windows.Forms,System.Drawing";
execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command', build], {
  windowsHide: true, env: {...process.env, WCU_SOURCE:sourcePath, WCU_BINARY:executable},
});

const owner = startBackgroundDesktop();
const connect = () => new McpTestClient(ps, [...backgroundDesktopArgs(owner.name),
  '-Executable', process.execPath, '-EntryPath', path.join(repo, 'mcp/server.mjs')], {
  // DSH starts the server with ELECTRON_RUN_AS_NODE; apps launched here must
  // not inherit it, or Electron apps would start as Node with no window.
  env: {...process.env, WCU_FIXTURE_WORKSPACE: 'inherited', WCU_BROWSER_LANE: 'off', WCU_IMAGE_MODE: 'inline', ELECTRON_RUN_AS_NODE: '1'},
});
let client;
async function closeWorker() {
  if (!client || client.child.exitCode !== null) return;
  const closed = once(client.child,'close');
  client.child.stdin.end();
  if (!await Promise.race([closed,delay(5000,undefined,{ref:false})])) {
    client.close();
    throw new Error('The background worker did not shut down: '+client.stderr);
  }
}
async function call(name,args,expectError) {
  const outcome = await client.call('windows_computer_use_' + name,args);
  if (expectError) {
    assert.equal(outcome.isError,true);
    assert.match(outcome.content[0].text,expectError);
    return;
  }
  assert.ok(!outcome.isError, outcome.content[0].text);
  return {meta:JSON.parse(outcome.content[0].text),parts:outcome.content};
}
let fixturePid;
try {
  await owner.ready;
  client = connect();
  await client.init();
  const {meta:health} = await call('health');
  assert.equal(health.desktopTarget,'background');
  assert.equal(health.sendInput,false);
  const {meta:launch} = await call('launch_app',{target:executable,workingDirectory:root});
  assert.equal(launch.launchMethod,'background-desktop');
  fixturePid=launch.processId;
  let fixture;
  for(let i=0; i<16 && !fixture; i++) {
    const {meta} = await call('list_windows');
    fixture=meta.windows.find(window=>window.processId===fixturePid && window.name==='Wincu background desktop fixture');
    if(!fixture) await delay(125);
  }
  assert.ok(fixture,'The launched app belongs to the background desktop');
  const target={nativeWindowHandle:fixture.nativeWindowHandle};
  await call('type_text',{...target,text:'background edit',method:'background'});
  const {meta:button}=await call('find',{...target,query:'Background action',ocrFallback:false});
  await call('invoke',{...target,elementId:button.results[0].id,fallbackClick:false});
  assert.equal(await readFile(path.join(root,'result.txt'),'utf8'),expected+'|background edit|inherited|app');
  const {meta:shot,parts}=await call('screenshot',target);
  assert.equal(shot.screenshot.method,'printwindow');
  assert.ok(parts.find(part=>part.type==='image' && part.mimeType==='image/png'));
  await call('screenshot',{scope:'desktop'},/WCU_BACKGROUND_DESKTOP_LIMIT/);
  await call('keypress',{...target,keys:['Ctrl','A']},/WCU_BACKGROUND_DESKTOP_LIMIT/);
  await call('screenshot',{nativeWindowHandle:2},/WCU_BACKGROUND_DESKTOP_WINDOW_UNAVAILABLE/);
  // DSH restarts MCP for tool and browser settings. Native application state
  // belongs to the desktop, so a fresh MCP worker must find the same draft.
  await closeWorker();
  assert.doesNotThrow(()=>process.kill(fixturePid,0));
  client = connect();
  await client.init();
  const {meta:afterReconnect} = await call('list_windows');
  assert.ok(afterReconnect.windows.some(window=>window.processId===fixturePid && window.nativeWindowHandle===target.nativeWindowHandle));
  await writeFile(path.join(root,'result.txt'),'waiting for reconnected worker');
  const {meta:reconnectedButton}=await call('find',{...target,query:'Background action',ocrFallback:false});
  await call('invoke',{...target,elementId:reconnectedButton.results[0].id,fallbackClick:false});
  assert.equal(await readFile(path.join(root,'result.txt'),'utf8'),expected+'|background edit|inherited|app');
} finally {
  try { await closeWorker(); }
  finally { await owner.dispose(); }
}
assert.throws(()=>process.kill(fixturePid,0),/ESRCH/,'Closing the desktop releases its application processes');
console.log(JSON.stringify({passed:true,launchOnPrivateDesktop:true,workspaceAndEnvironment:true,electronAppEnvironment:true,windowScreenshot:true,noPhysicalInput:true,reconnectPreservesDraft:true,processCleanup:true}));
