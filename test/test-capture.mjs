// One-off: call snapshot with captureWindow against a live Notepad.
import { spawn, execSync } from "node:child_process";
const BACKEND = "E:/PythonFiles/computer-use-win/scripts/windows-uia.ps1";
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
function call(action, args, t = 15000) {
  return new Promise((res) => {
    const id = ++nid;
    const timer = setTimeout(() => { waiters.delete(id); res({ timeout: true }); }, t);
    waiters.set(id, (m) => { clearTimeout(timer); res(m); });
    child.stdin.write(JSON.stringify({ id, action, args }) + "\n");
  });
}
execSync("start notepad");
await new Promise((r) => setTimeout(r, 2500));
const r = await call("snapshot", { windowTitle: "Notepad", activate: true, captureWindow: true, includeScreenshot: true, maxDepth: 0, maxNodes: 1 });
if (r.screenshot) {
  console.log("method:", r.screenshot.method);
  console.log("bytes:", r.screenshot.bytes);
  console.log("bounds:", JSON.stringify(r.screenshot.bounds));
  console.log("imageScale:", r.screenshot.imageScale, "origin:", JSON.stringify(r.screenshot.origin));
  console.log("occludedPossible:", r.screenshot.occludedPossible, "windowCaptureFailed:", r.screenshot.windowCaptureFailed);
  console.log("path:", r.screenshot.path);
} else {
  console.log("NO SCREENSHOT. error:", r.error, "stack:", r.scriptStackTrace);
}
execSync("taskkill /IM notepad.exe /F", { stdio: "ignore" });
child.kill();
process.exit(0);
