// Low disruption through the server on the user's desktop: an executable
// launched by DSH opens on the hidden desktop, list_windows marks its window,
// calls with its handle reach it there (also without a target, following the
// window last worked in), real input is refused with the way out, and closing
// the server releases the desktop and its programs. No physical input.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { McpTestClient } from './mcp-test-client.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-work-modes-'));
const executable = path.join(root, 'fixture.exe');
await writeFile(path.join(root, 'project.txt'), 'hidden desktop', 'utf8');
const source = String.raw`
using System;
using System.IO;
using System.Windows.Forms;
static class Fixture {
  [STAThread] public static void Main() {
    var window = new Form { Text="Wincu work mode fixture", Width=520, Height=300 };
    var field = new TextBox { AccessibleName="Work mode field", Left=20, Top=22, Width=380 };
    var button = new Button { Text="Work mode action", Left=20, Top=64, Width=180 };
    button.Click += (sender, args) => File.WriteAllText("result.txt", File.ReadAllText("project.txt") + "|" + field.Text);
    window.Controls.Add(field);
    window.Controls.Add(button);
    window.ActiveControl = field;
    Application.Run(window);
  }
}
`;
const sourcePath = path.join(root, 'fixture.cs');
await writeFile(sourcePath, source);
execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command',
  'Add-Type -Path $env:WCU_SOURCE -OutputAssembly $env:WCU_BINARY -OutputType WindowsApplication -ReferencedAssemblies System.Windows.Forms,System.Drawing'],
  { windowsHide: true, env: { ...process.env, WCU_SOURCE: sourcePath, WCU_BINARY: executable } });

const client = new McpTestClient(process.execPath, [path.join(repo, 'mcp/server.mjs')], {
  env: { ...process.env, WCU_WORK_MODE: 'quiet', WCU_BROWSER_LANE: 'off', WCU_IMAGE_MODE: 'inline', WCU_TEST_NO_TAKEOVER: '1', NODE_ENV: 'test' },
});
async function call(name, args, expectError) {
  const outcome = await client.call('windows_computer_use_' + name, args);
  if (expectError) {
    assert.equal(outcome.isError, true, outcome.content[0].text);
    assert.match(outcome.content[0].text, expectError);
    return outcome.content[0].text;
  }
  assert.ok(!outcome.isError, outcome.content[0].text);
  return { meta: JSON.parse(outcome.content[0].text), parts: outcome.content };
}
let fixturePid, closed = false;
try {
  await client.init();
  const { meta: health } = await call('health');
  assert.equal(health.workMode, 'quiet');
  assert.equal(health.desktopTarget, 'current', 'health reads the user\'s desktop');

  const { meta: launch } = await call('launch_app', { target: executable, workingDirectory: root });
  assert.equal(launch.desktop, 'background');
  assert.equal(launch.launchMethod, 'background-desktop');
  fixturePid = launch.processId;
  let fixture;
  for (let i = 0; i < 24 && !fixture; i++) {
    const { meta } = await call('list_windows');
    fixture = meta.windows.find(window => window.processId === fixturePid && window.name === 'Wincu work mode fixture');
    if (fixture) {
      assert.equal(fixture.desktop, 'background');
      assert.match(meta.hiddenDesktop, /nativeWindowHandle/);
      assert.ok(meta.windows.some(window => window.desktop === undefined), 'the user\'s windows come first, unmarked');
    } else await delay(125);
  }
  assert.ok(fixture, 'The launched app is on the hidden desktop');
  const target = { nativeWindowHandle: fixture.nativeWindowHandle };

  await call('type_text', { ...target, text: 'routed edit', method: 'background' });
  const { meta: found } = await call('find', { ...target, query: 'Work mode action', ocrFallback: false });
  await call('invoke', { ...target, elementId: found.results[0].id, fallbackClick: false });
  assert.equal(await readFile(path.join(root, 'result.txt'), 'utf8'), 'hidden desktop|routed edit');

  // Without a window target the call follows the hidden window last worked in.
  const { meta: followed } = await call('find', { query: 'Work mode field', ocrFallback: false });
  assert.ok(followed.results.length > 0, 'an untargeted find reads the hidden window');
  // A process id also routes there.
  const { meta: byPid } = await call('accessibility_tree', { processId: fixturePid, maxDepth: 2 });
  assert.ok(JSON.stringify(byPid).includes('Work mode action'));

  const { meta: shot, parts } = await call('screenshot', target);
  assert.equal(shot.screenshot.method, 'printwindow');
  assert.ok(parts.find(part => part.type === 'image' && part.mimeType === 'image/png'));

  const refusal = await call('keypress', { ...target, keys: ['Ctrl', 'A'] }, /WCU_BACKGROUND_DESKTOP_LIMIT/);
  assert.match(refusal, /desktop:"current"/);
  await call('click', { ...target, x: fixture.boundingBox.centerX, y: fixture.boundingBox.centerY }, /WCU_BACKGROUND_DESKTOP_LIMIT/);
  // Only an executable opens there: an explicit desktop:"background" refuses
  // anything else instead of opening it on the user's desktop.
  await call('launch_app', { target: path.join(root, 'project.txt'), desktop: 'background' }, /LAUNCH_|WCU_BACKGROUND_DESKTOP_LIMIT/);

  // Closing the server closes its own hidden desktop and the programs on it.
  const exited = once(client.child, 'exit');
  client.child.stdin.end();
  await Promise.race([exited, delay(8000)]);
  closed = true;
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) {
    try { process.kill(fixturePid, 0); await delay(100); } catch { gone = true; }
  }
  assert.ok(gone, 'Closing the server releases the hidden desktop\'s programs');
} finally {
  if (!closed) client.close();
  if (fixturePid) { try { process.kill(fixturePid); } catch {} }
}
console.log(JSON.stringify({ passed: true, launchOnHiddenDesktop: true, markedInList: true, routedByHandle: true, routedByProcess: true,
  followsLastWindow: true, windowScreenshot: true, realInputRefused: true, cleanup: true }));
