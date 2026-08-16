// Debug: homing cache + DwmGetWindowAttribute [ref] behavior.
import { spawn, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const BACKEND = "E:/PythonFiles/computer-use-win/scripts/windows-uia.ps1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ps1(script, label) {
  const f = `C:/Users/ADMINI~1/AppData/Local/Temp/wcu-dbg-${label}.ps1`;
  writeFileSync(f, script, "utf8");
  try { return execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${f}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch (e) { return "ERR: " + String(e.message).slice(0, 200); }
}

const child = spawn("powershell", ["-NoLogo", "-NoProfile", "-Sta", "-ExecutionPolicy", "Bypass", "-File", BACKEND, "-Persistent"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const waiters = new Map();
child.stdout.setEncoding("utf8");
child.stdout.on("data", (d) => {
  buf += d;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    const w = waiters.get(m.id); if (w) { waiters.delete(m.id); w(m); }
  }
});
let nid = 0;
function call(action, args, t = 20000) {
  return new Promise((res) => {
    const id = ++nid;
    const timer = setTimeout(() => { waiters.delete(id); res({ timeout: true, action }); }, t);
    waiters.set(id, (m) => { clearTimeout(timer); res(m); });
    child.stdin.write(JSON.stringify({ id, action, args }) + "\n");
  });
}

// Spawn notepad via ps (detached)
ps1(`Start-Process notepad`, "spawn");
await sleep(2500);

const t1 = await call("tree", { windowTitle: "Notepad", maxDepth: 1, maxNodes: 5 });
const rect1 = t1.tree && t1.tree.boundingBox;
console.log("observed rect:", JSON.stringify(rect1), "hwnd:", t1.tree && t1.tree.nativeWindowHandle);

// Move window +120,+80
const moved = ps1(`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,int a,int x,int y,int w,int h,uint f);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr FindWindowW(string c,string n);[StructLayout(LayoutKind.Sequential)]public struct RECT{public int l,t,r,b;}[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,[out]RECT r);}'
$h=[W]::FindWindowW("Notepad",$null)
if ($h -ne [IntPtr]::Zero) { $r=New-Object W+RECT; [void][W]::GetWindowRect($h,[ref]$r); Write-Host "before: $($r.l),$($r.t)"; [W]::SetWindowPos($h,[IntPtr]::Zero,($r.l+120),($r.t+80),0,0,0x0014); Write-Host "moved" } else { Write-Host "notepad-window-not-found" }`, "move1");
console.log("move:", moved);
await sleep(500);

const t2 = await call("tree", { windowTitle: "Notepad", maxDepth: 1, maxNodes: 5 });
console.log("after rect:", JSON.stringify(t2.tree && t2.tree.boundingBox));

// Now the click with stale coords (from rect1) + windowTitle: expect homing
const c1 = await call("click", { x: rect1.x + 10, y: rect1.y + 30, windowTitle: "Notepad", dispatch: "foreground" });
console.log("click1 (should home):", JSON.stringify({ ok: c1.ok, homed: c1.homed, x: c1.x, y: c1.y, err: c1.error }));

// DWM [ref] + OCR full error stack
const ocr = await call("ocr", { windowTitle: "Notepad" }, 45000);
console.log("ocr:", JSON.stringify({ ok: ocr.ok, error: ocr.error, stack: (ocr.scriptStackTrace || "").split("\n").slice(0, 6).join(" | ") }));
child.kill();
process.exit(0);
