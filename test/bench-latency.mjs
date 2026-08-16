// Backend latency benchmark: time N consecutive backend actions.
import { spawn } from "node:child_process";

const BACKEND = "E:/PythonFiles/computer-use-win/scripts/windows-uia.ps1";
const N = process.argv[2] ? Number(process.argv[2]) : 5;

const actions = [
  ["health", {}],
  ["list_windows", { maxWindows: 5 }],
  ["tree", { scope: "active_window", maxDepth: 2, maxNodes: 50 }],
];

function once(action, args) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn("powershell", ["-NoLogo", "-NoProfile", "-Sta", "-ExecutionPolicy", "Bypass", "-File", BACKEND, "-Action", action], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", () => resolve({ ms: Date.now() - t0, ok: out.includes('"ok":true') || out.includes('"ok": true'), out: out.slice(0, 120) }));
    child.on("error", (e) => resolve({ ms: Date.now() - t0, err: String(e) }));
    child.stdin.end(JSON.stringify(args));
  });
}

const stats = { health: [], list_windows: [], tree: [] };
for (let i = 0; i < N; i++) {
  for (const [action, args] of actions) {
    const r = await once(action, args);
    stats[action].push(r.ms);
    if (i === 0) console.log(`sample ${action}: ${r.ms}ms ok=${r.ok} ${r.err || r.out.replace(/\s+/g, " ").slice(0, 80)}`);
  }
}
const mean = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
console.log("\n=== latency (ms), mean of", N, "runs ===");
for (const k of Object.keys(stats)) console.log(`${k}: mean=${mean(stats[k])} min=${Math.min(...stats[k])} max=${Math.max(...stats[k])}`);
