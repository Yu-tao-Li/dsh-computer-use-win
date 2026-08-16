// MCP protocol test: initialize -> tools/list -> tools/call
// Simulates what DSH's dsh-mcp-client (official MCP SDK StdioClientTransport) does.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = process.argv[2] || path.join(__dirname, "..", "mcp", "server.mjs");
const TOOL = process.argv[3] || "windows_computer_use_list_windows";
const ARGS = process.argv[4] || JSON.stringify({ maxWindows: 5 });

const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const responses = [];
child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) {
      try { responses.push(JSON.parse(line)); } catch { console.error("BAD LINE:", line.slice(0, 200)); }
    }
  }
});
let serverLog = "";
child.stderr.on("data", (d) => { serverLog += d.toString("utf8"); });

function send(msg) { child.stdin.write(JSON.stringify(msg) + "\n"); }

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "dsh-mcp-test", version: "1.0" } } });
setTimeout(() => send({ jsonrpc: "2.0", method: "notifications/initialized" }), 600);
setTimeout(() => send({ jsonrpc: "2.0", id: 2, method: "tools/list" }), 1200);
setTimeout(() => send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: TOOL, arguments: JSON.parse(ARGS) } }), 1800);

setTimeout(() => {
  const init = responses.find((r) => r.id === 1);
  const tools = responses.find((r) => r.id === 2);
  const call = responses.find((r) => r.id === 3);
  const result = {
    initOk: !!(init && init.result && init.result.serverInfo),
    serverName: init?.result?.serverInfo?.name,
    protocolVersion: init?.result?.protocolVersion,
    toolCount: tools?.result?.tools?.length,
    toolNames: (tools?.result?.tools || []).map((t) => t.name),
    callOk: !!(call && call.result && !call.result.isError),
    callResultPreview: call ? (typeof call.result === "object" ? JSON.stringify(call.result).slice(0, 600) : String(call.result).slice(0, 600)) : null,
    serverLog: serverLog.trim(),
  };
  console.log(JSON.stringify(result, null, 2));
  child.kill();
  process.exit(result.initOk && result.toolCount > 10 && result.callOk ? 0 : 1);
}, 9000);
