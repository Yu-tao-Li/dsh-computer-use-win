import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trustedRequest } from './diagnostics.mjs';
import { consumeGrant, mintGrant } from './policy.mjs';

export const HYPERV_ROUTE = '/dsh-computer-use-win/api/hyperv';
const script = fileURLToPath(new URL('../scripts/hyperv-desktop.ps1', import.meta.url));
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const pngHeader = Buffer.from('89504e470d0a1a0a', 'hex');
const ownPng = /^[a-f0-9-]{36}\.png$/;
let nextSweep = 0;

function start(mode, name, env = process.env) {
  if (process.platform !== 'win32') throw new Error('WCU_HYPERV_UNAVAILABLE: use a native Windows DSH host to run in Hyper-V.');
  // A saved name controls one exact VM. Nothing from a tool request becomes a command.
  if (typeof name !== 'string' || !name.trim() || name.startsWith('-') || /[\u0000-\u001f]/.test(name)) {
    throw new Error('WCU_HYPERV_VM_REQUIRED: choose a local Hyper-V virtual machine in Computer Use settings.');
  }
  return spawn(powershell, ['-NoProfile', '-File', script, '-Mode', mode, '-VMName', name], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env,
  });
}

function configure(name) {
  return new Promise((resolve, reject) => {
    const worker = start('Configure', name);
    let stdout = '', stderr = '';
    const deadline = setTimeout(() => worker.kill(), 85_000);
    worker.stdout.setEncoding('utf8').on('data', chunk => { stdout = (stdout + chunk).slice(-8192); });
    worker.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-2048); });
    worker.once('error', error => { clearTimeout(deadline); reject(error); });
    worker.once('close', code => {
      clearTimeout(deadline);
      if (code !== 0) { reject(new Error(stderr.trim() || 'The Hyper-V connection could not be configured.')); return; }
      try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1))); }
      catch { reject(new Error('Windows did not return a connection result.')); }
    });
  });
}

export function createHypervSetupHandler({ settings, reconnect, setup = configure }) {
  let active = false;
  return async (request, response) => {
    const send = (status, data) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    if (request.method !== 'POST') return send(405, { ok: false });
    if (!trustedRequest(request)) return send(403, { ok: false });
    if (active) return send(409, { ok: false });
    const config = settings();
    if (!config.hypervVm) return send(400, { ok: false, error: 'WCU_HYPERV_VM_REQUIRED' });
    active = true;
    try {
      const result = await setup(config.hypervVm);
      if (result.ok && settings().hypervVm === config.hypervVm) await reconnect?.(config.hypervVm);
      send(200, result);
    } catch (error) {
      send(500, { ok: false, error: String(error.message || error).slice(0, 400) });
    } finally { active = false; }
  };
}

function screenshotMetadata(value, results) {
  if (!value || typeof value !== 'object') return;
  if (value.mimeType === 'image/png' && (value.path || value.base64 || value.imageScale)) {
    results.push(value);
  }
  for (const child of Object.values(value)) screenshotMetadata(child, results);
}

async function deliverImages(message, outputDir) {
  const content = message.result?.content;
  if (!Array.isArray(content) || !content.some(part => part.type === 'image')) return message;
  const metadata = [], parsed = new Map();
  for (const part of content) {
    if (part.type !== 'text') continue;
    try {
      const data = JSON.parse(part.text);
      screenshotMetadata(data, metadata);
      parsed.set(part, data);
    } catch {}
  }
  await mkdir(outputDir, { recursive: true });
  const now = Date.now();
  if (now >= nextSweep) {
    nextSweep = now + 5 * 60 * 1000;
    const cutoff = now - 30 * 60 * 1000;
    for (const entry of await readdir(outputDir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !ownPng.test(entry.name)) continue;
      const file = path.join(outputDir, entry.name);
      try { if ((await stat(file)).mtimeMs < cutoff) await unlink(file); } catch {}
    }
  }
  const result = [];
  for (const part of content) {
    if (part.type !== 'image') { result.push(part); continue; }
    if (part.mimeType !== 'image/png' || typeof part.data !== 'string' || part.data.length > 24 * 1024 * 1024) {
      throw new Error('The isolated desktop returned an invalid screenshot.');
    }
    const bytes = Buffer.from(part.data, 'base64');
    if (!bytes.subarray(0, pngHeader.length).equals(pngHeader)) throw new Error('The isolated desktop returned an invalid PNG.');
    const file = path.join(outputDir, randomUUID() + '.png');
    await writeFile(file, bytes, { flag: 'wx' });
    const item = metadata.shift();
    if (item) {
      delete item.base64;
      Object.assign(item, { path: file, delivery: 'file', readHint: 'Open this local PNG with an image-viewing tool.' });
    } else result.push({ type: 'text', text: JSON.stringify({ screenshot: { path: file, delivery: 'file' } }) });
  }
  for (const [part, data] of parsed) part.text = JSON.stringify(data);
  message.result.content = result;
  return message;
}

async function relay() {
  const name = process.env.WCU_HYPERV_VM;
  const { WCU_APPROVAL_SECRET: hostSecret, WCU_APPROVAL_LEDGER: hostLedger } = process.env;
  const guestSecret = hostSecret ? randomBytes(32).toString('base64url') : '';
  const worker = start('Relay', name, { ...process.env, WCU_APPROVAL_SECRET: guestSecret });
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  const pending = new Set();
  const usedGrants = new Map();
  const screenshots = path.join(os.tmpdir(), 'dsh-wcu-isolated-screenshots');
  const clientInput = createInterface({ input: process.stdin, crlfDelay: Infinity });
  worker.stdin.on('error', () => {});
  let lastError = '';
  worker.stderr.setEncoding('utf8').on('data', chunk => {
    lastError = (lastError + chunk).slice(-2000);
    process.stderr.write(chunk);
  });
  const failResult = (id, detail) => send({ jsonrpc: '2.0', id, result: {
    isError: true, content: [{ type: 'text', text: detail }],
  } });
  const closed = new Promise(resolve => {
    worker.once('error', error => { lastError = error.message; resolve(); });
    worker.once('close', resolve);
  });
  const readOutput = async () => {
    for await (const line of createInterface({ input: worker.stdout, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
        send(await deliverImages(message, screenshots));
      } catch (error) {
        if (message && Object.hasOwn(message, 'id')) failResult(message.id, String(error.message));
        else process.stderr.write('Hyper-V relay received invalid worker output.\n');
      }
      if (message && Object.hasOwn(message, 'id')) pending.delete(message.id);
    }
  };
  const readInput = async () => {
    for await (const line of clientInput) {
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }); continue; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid MCP request' } }); continue;
      }
      if (message?.method === 'tools/call' && message.params?.arguments?._wcuApproval !== undefined) {
        const { _wcuApproval: token, ...args } = message.params.arguments;
        try {
          if (!hostLedger || !consumeGrant(token, message.params.name, args, hostSecret, usedGrants, Date.now(), hostLedger)) {
            throw new Error('WCU_POLICY_DENIED: invalid, expired or already used approval for the isolated desktop.');
          }
        } catch (error) { failResult(message.id, error.message); continue; }
        message.params.arguments = { ...args, _wcuApproval: mintGrant(message.params.name, args, guestSecret) };
      }
      if (Object.hasOwn(message, 'id')) pending.add(message.id);
      worker.stdin.write(JSON.stringify(message) + '\n');
    }
    worker.stdin.end();
  };
  const input = readInput();
  const output = readOutput();
  await closed;
  await output;
  clientInput.close();
  process.stdin.pause();
  await input;
  const detail = lastError.trim().split(/\r?\n/)[0] || 'WCU_HYPERV_DISCONNECTED: the isolated desktop connection closed.';
  for (const id of pending) send({ jsonrpc: '2.0', id, error: { code: -32000, message: detail } });
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  relay().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
