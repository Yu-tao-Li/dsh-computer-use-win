// End-to-end input test through the MCP protocol:
// open Notepad -> type text -> read back UIA value -> close Notepad.
// Verifies the real input stack (SendKeys + clipboard) end to end.
import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
const pexec = promisify(exec);

const SERVER = process.argv[2] || "E:/PythonFiles/computer-use-win/mcp/server.mjs";
const MARKER = "wcu-e2e-" + Date.now();

const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
let serverLog = "";
child.stderr.on("data", (d) => { serverLog += d.toString("utf8"); });

let nextId = 0;
function rpc(method, params) {
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ id, result: { timeout: true } }); } }, 60000);
  });
}
function callTool(name, args) { return rpc("tools/call", { name, arguments: args }); }
function textOf(resp) {
  const c = resp?.result?.content;
  if (Array.isArray(c)) return c.map((x) => (x.type === "text" ? x.text : `[${x.type}]`)).join("\n");
  return JSON.stringify(resp?.result ?? resp, null, 2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// initialize
await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "1.0" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
await sleep(300);

const result = { steps: {} };

// 0. kill any leftover notepad windows so the test is deterministic
exec('taskkill /F /IM notepad.exe 2>nul || true');
await sleep(500);

// 1. open a fresh, empty notepad
exec('start notepad');
await sleep(2500);

// 2. activate the notepad window (now verified: reports whether it REALLY became foreground)
const act = await callTool("windows_computer_use_activate_window", { windowTitle: "Notepad", activate: true });
const actText = textOf(act);
let activated = false;
try { activated = JSON.parse(actText).activated === true; } catch {}
result.steps.activate = { ok: !act.result?.isError, activated, preview: actText.slice(0, 200) };
await sleep(500);

// 3. type the marker (target the Notepad window explicitly; self-activating)
const type = await callTool("windows_computer_use_type_text", { text: MARKER, windowTitle: "Notepad", activate: true, restoreClipboard: true });
const typeText = textOf(type);
let typedValue = "";
try { typedValue = JSON.parse(typeText).verifyValue || ""; } catch {}
result.steps.type = { ok: !type.result?.isError, verifyValue: typedValue, preview: typeText.slice(0, 200) };
await sleep(800);

// 4. read back via find (fresh notepad contains only this marker)
const find = await callTool("windows_computer_use_find", { query: MARKER, windowTitle: "Notepad", detailLevel: "full" });
const findText = textOf(find);
let resultsCount = 0;
try { const p = JSON.parse(findText); resultsCount = Array.isArray(p.results) ? p.results.length : 0; } catch {}
result.steps.readback = {
  found: resultsCount > 0,
  resultsCount,
  isError: !!find.result?.isError,
  typedValueHasMarker: typedValue.includes(MARKER),
  preview: findText.slice(0, 300),
};

// 5. close notepad
const kill = await callTool("windows_computer_use_keypress", { keys: ["alt", "f4"], windowTitle: "Notepad" });
result.steps.close = { ok: !kill.result?.isError, preview: textOf(kill).slice(0, 200) };
await sleep(800);

// 6. clean up any leftover notepad
exec('taskkill /F /IM notepad.exe 2>nul || true');

result.serverLog = serverLog.trim();
result.PASS = result.steps.readback.found === true || result.steps.readback.typedValueHasMarker === true;
console.log(JSON.stringify(result, null, 2));
child.kill();
process.exit(result.PASS ? 0 : 1);
