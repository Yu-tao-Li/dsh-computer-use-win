// Low disruption with real input, end to end. A "user" types into one fixture
// window (SendInput without DSH's marker, as remote control or another program
// would) while DSH, in the Low disruption work mode, clicks and types in a
// second window. Every character the user typed must land in the user's
// window, in order, and only DSH's text in DSH's window; at least one step must
// report that it held the user's input.
//
// This suite sends real keyboard and mouse input, so it runs only on CI
// runners (CI is set) or with --live on a PC nobody is using.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpTestClient } from './mcp-test-client.mjs';

if (process.platform !== 'win32') { console.log(JSON.stringify({ skipped: 'Windows only' })); process.exit(0); }
if (!process.env.CI && !process.argv.includes('--live')) {
  console.log(JSON.stringify({ skipped: 'sends real keyboard and mouse input; runs on CI runners, or with --live on a PC nobody is using' }));
  process.exit(0);
}
const powershell = process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe';
const dir = await mkdtemp(path.join(os.tmpdir(), 'wcu-hold-live-'));
const checkout = fileURLToPath(new URL('../', import.meta.url));

const fixtureScript = path.join(dir, 'fixture.ps1');
await writeFile(fixtureScript, `param([string]$Dir)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class HoldFixture {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  public static bool Front(IntPtr window) {
    IntPtr front = GetForegroundWindow(); uint process;
    uint thread = front == IntPtr.Zero ? 0 : GetWindowThreadProcessId(front, out process), own = GetCurrentThreadId();
    bool attached = thread != 0 && thread != own && AttachThreadInput(own, thread, true);
    try { BringWindowToTop(window); SetForegroundWindow(window); } finally { if (attached) AttachThreadInput(own, thread, false); }
    return GetForegroundWindow() == window;
  }
}
'@
[void][HoldFixture]::SetProcessDpiAwarenessContext([IntPtr](-4))
function New-Box([string]$Title, [int]$X) {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = $Title; $form.StartPosition = 'Manual'; $form.Location = New-Object System.Drawing.Point $X, 80
  $form.Size = New-Object System.Drawing.Size 420, 260
  $edit = New-Object System.Windows.Forms.TextBox
  $edit.Multiline = $true; $edit.Dock = 'Fill'; $edit.Font = New-Object System.Drawing.Font 'Segoe UI', 14
  $form.Controls.Add($edit)
  return ,@($form, $edit)
}
$user = New-Box 'WCU hold user' 40
$target = New-Box 'WCU hold target' 520
$target[0].Show(); $user[0].Show()
$timer = New-Object System.Windows.Forms.Timer; $timer.Interval = 50
$script:last = 0
$timer.Add_Tick({
  $file = Join-Path $Dir 'command.json'
  if (-not [IO.File]::Exists($file)) { return }
  try { $command = [IO.File]::ReadAllText($file) | ConvertFrom-Json } catch { return }
  if ($command.id -eq $script:last) { return }; $script:last = $command.id
  if ($command.action -eq 'front') {
    $front = [HoldFixture]::Front($user[0].Handle); [void]$user[1].Focus()
    $box = $target[1].RectangleToScreen($target[1].ClientRectangle)
    [Console]::WriteLine((@{ id = $command.id; front = $front; targetX = [int]($box.Left + $box.Width / 2); targetY = [int]($box.Top + $box.Height / 2) } | ConvertTo-Json -Compress))
  }
  if ($command.action -eq 'read') {
    [Console]::WriteLine((@{ id = $command.id; user = $user[1].Text; target = $target[1].Text; foreground = [HoldFixture]::GetForegroundWindow().ToInt64() } | ConvertTo-Json -Compress))
  }
  if ($command.action -eq 'exit') { $timer.Stop(); $user[0].Close(); $target[0].Close(); [System.Windows.Forms.Application]::ExitThread() }
})
$timer.Start()
[Console]::WriteLine((@{ ready = $true; userForm = $user[0].Handle.ToInt64(); targetForm = $target[0].Handle.ToInt64() } | ConvertTo-Json -Compress))
[System.Windows.Forms.Application]::Run()
`, 'utf8');

const typistScript = path.join(dir, 'typist.ps1');
await writeFile(typistScript, `param([string]$Text, [int]$Delay)
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class HoldTypist {
  [StructLayout(LayoutKind.Sequential)] struct KeyInput { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct Union { [FieldOffset(0)] public MouseInput mouse; [FieldOffset(0)] public KeyInput key; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Union u; }
  [DllImport("user32.dll")] static extern uint SendInput(uint count, Input[] inputs, int size);
  // One character, pressed and released, without DSH's marker.
  public static uint Type(char c) {
    var down = new Input(); down.type = 1; down.u.key.scan = c; down.u.key.flags = 4;
    var up = down; up.u.key.flags = 6;
    return SendInput(2, new Input[] { down, up }, Marshal.SizeOf(typeof(Input)));
  }
}
'@
[Console]::WriteLine('{"typing":true}')
$sent = 0
foreach ($c in $Text.ToCharArray()) { $sent += [HoldTypist]::Type($c); Start-Sleep -Milliseconds $Delay }
[Console]::WriteLine((@{ done = $true; sent = $sent } | ConvertTo-Json -Compress))
`, 'utf8');

function lines(child, onLine) {
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      if (!line) continue;
      try { onLine(JSON.parse(line)); } catch { }
    }
  });
}
function waitFor(list, test, ms, what) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = list.find(test);
      if (found) { clearInterval(timer); resolve(found); }
      else if (Date.now() - started > ms) { clearInterval(timer); reject(new Error('Timed out waiting for ' + what)); }
    }, 25);
  });
}

const fixtureLines = [], typistLines = [];
const fixture = spawn(powershell, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', fixtureScript, '-Dir', dir], { windowsHide: false });
lines(fixture, message => fixtureLines.push(message));
let fixtureError = ''; fixture.stderr.setEncoding('utf8'); fixture.stderr.on('data', chunk => { fixtureError += chunk; });
let commandId = 0;
async function ask(action) {
  const id = ++commandId;
  await writeFile(path.join(dir, 'command.json'), JSON.stringify({ id, action }));
  return waitFor(fixtureLines, message => message.id === id, 10000, action);
}
let client, typist;
try {
  const ready = await waitFor(fixtureLines, message => message.ready, 60000, 'the fixture windows' + (fixtureError ? ': ' + fixtureError : ''));
  const front = await ask('front');
  if (!front.front) {
    console.log(JSON.stringify({ skipped: 'this machine did not bring a fixture window to the foreground' }));
    process.exitCode = 0;
  } else {
    client = new McpTestClient(process.execPath, [path.join(checkout, 'mcp/server.mjs')], {
      cwd: checkout,
      env: { ...process.env, NODE_ENV: 'test', WCU_TEST_NO_TAKEOVER: '1', WCU_BROWSER_LANE: 'off', WCU_WORK_MODE: 'quiet', WCU_SETTINGS_JSON: undefined, WCU_INDICATOR: '0' },
    });
    await client.init();
    await client.call('windows_computer_use_health', {});
    // The backend is warm. The user starts typing; DSH works meanwhile.
    const text = 'the quick brown fox jumps over the lazy dog 0123456789 '.repeat(2);
    typist = spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', typistScript, '-Text', text, '-Delay', '30'], { windowsHide: true });
    lines(typist, message => typistLines.push(message));
    await waitFor(typistLines, message => message.typing, 30000, 'the typist');
    const notes = [], errors = [];
    const step = async (name, args) => {
      const result = await client.call('windows_computer_use_' + name, args);
      const body = result.content?.find(item => item.type === 'text')?.text ?? '';
      if (result.isError) errors.push(name + ': ' + body);
      try { const data = JSON.parse(body); if (data.userInput) notes.push(data.userInput); } catch { }
    };
    await step('click', { nativeWindowHandle: ready.targetForm, x: front.targetX, y: front.targetY });
    for (let i = 0; i < 4; i++) await step('type_text', { nativeWindowHandle: ready.targetForm, text: 'D', method: 'sendinput', focusMode: 'main' });
    const done = await waitFor(typistLines, message => message.done, 60000, 'the typist to finish');
    await new Promise(resolve => setTimeout(resolve, 1000));
    const read = await ask('read');
    if (!read.user && !read.target) {
      console.log(JSON.stringify({ skipped: 'this machine delivered no input to the fixture windows', typistSent: done.sent }));
    } else {
      assert.deepEqual(errors, [], 'DSH steps failed');
      assert.equal(read.user, text, 'every character the user typed reached the user\'s window, in order');
      assert.equal(read.target, 'DDDD', 'only DSH\'s text reached DSH\'s window');
      // Either note says the hold took the user's keys and delivered them to their window.
      assert.ok(notes.some(note => /held and then replayed|their keys went there/.test(note)), 'a step held the user\'s input: ' + JSON.stringify(notes));
      console.log(JSON.stringify({ passed: true, userCharacters: read.user.length, dshCharacters: read.target.length, heldSteps: notes.length, notes }));
    }
  }
} finally {
  try { typist?.kill(); } catch { }
  try { client?.close(); } catch { }
  try { await ask('exit'); } catch { }
  try { fixture.kill(); } catch { }
}
