// DPI calibration: what does the backend process actually see and where do
// moves land? Uses the persistent backend.
import { spawn } from "node:child_process";
const BACKEND = "E:/PythonFiles/computer-use-win/scripts/windows-uia.ps1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    const timer = setTimeout(() => { waiters.delete(id); res({ timeout: true, action }); }, t);
    waiters.set(id, (m) => { clearTimeout(timer); res(m); });
    child.stdin.write(JSON.stringify({ id, action, args }) + "\n");
  });
}

const h = await call("health", {});
console.log("virtualScreen (SystemInformation):", JSON.stringify(h.virtualScreen));

for (const target of [[200, 200], [1000, 500], [3000, 800]]) {
  await call("move", { x: target[0], y: target[1] });
  await sleep(150);
  const c = await call("cursor_pos", {});
  console.log(`move to (${target[0]},${target[1]}) -> cursor at (${c.x},${c.y})  ratio=${(c.x / target[0]).toFixed(3)}`);
}
child.kill();
process.exit(0);
