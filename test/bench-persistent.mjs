// Persistent backend protocol test: spawn the backend once, send N actions
// over stdin, time each round-trip.
import { spawn } from "node:child_process";

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
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    const w = waiters.get(msg.id);
    if (w) { waiters.delete(msg.id); w.resolve(msg); }
  }
});
let nextId = 0;
function call(action, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const id = ++nextId;
    const t0 = Date.now();
    const timer = setTimeout(() => { waiters.delete(id); resolve({ id, timeout: true, ms: Date.now() - t0 }); }, timeoutMs);
    waiters.set(id, { resolve: (m) => { clearTimeout(timer); resolve({ ...m, ms: Date.now() - t0 }); } });
    child.stdin.write(JSON.stringify({ id, action, args }) + "\n");
  });
}

const actions = [
  ["health", {}],
  ["list_windows", { maxWindows: 3 }],
  ["tree", { scope: "active_window", maxDepth: 2, maxNodes: 40 }],
  ["cursor_pos", {}],
];

console.log("spawning persistent backend (first call includes startup)...");
for (let i = 0; i < 2; i++) {
  for (const [action, args] of actions) {
    const r = await call(action, args);
    const label = i === 0 ? "cold" : "hot ";
    const ok = r.ok === true;
    const extra = action === "cursor_pos" ? ` x=${r.x} y=${r.y}` : "";
    console.log(`${label} ${action.padEnd(14)} ${String(r.ms).padStart(5)}ms ok=${ok}${extra}${r.error ? " ERR=" + r.error : ""}`);
  }
}
child.kill();
process.exit(0);
