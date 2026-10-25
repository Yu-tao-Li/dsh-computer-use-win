// A real MCP process restart while the same disposable browser stays alive.
// Inserting a new first node must not redirect a reference read by the old server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { McpTestClient } from './mcp-test-client.mjs';

const clients = [];
let browser;
const server = http.createServer((_request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>UNTOUCHED</title>
    <button onclick="document.title='ORIGINAL'">Original</button>
    <button onclick="const n=document.createElement('button');n.textContent='Inserted';n.onclick=()=>document.title='WRONG-INSERTED';document.body.prepend(n)">Insert</button>`);
});
const profile = await mkdtemp(path.join(os.tmpdir(), 'wcu-browser-reconnect-'));
const executable = ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']
  .flatMap(relative => [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(root => path.join(root, relative)))
  .find(existsSync);
assert.ok(executable, 'Chrome or Edge is required');
async function call(client, tool, args) {
  const response = await client.call('windows_computer_use_' + tool, args);
  assert.ok(!response.isError, JSON.stringify(response));
  return { meta: JSON.parse(response.content[0].text), page: response.content[1]?.text ?? '' };
}
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-sync', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let endpoint;
  for (let i = 0; i < 100 && !endpoint; i++) {
    await delay(100);
    endpoint = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
      .then(text => `http://127.0.0.1:${text.split(/\r?\n/)[0]}`, () => null);
  }
  assert.ok(endpoint, 'Disposable browser did not start');
  async function connect() {
    const client = new McpTestClient(process.execPath, [path.join(import.meta.dirname, '../mcp/server.mjs')], {
      env: { ...process.env, WCU_BROWSER_CDP_URL: endpoint, WCU_BROWSER_PROFILE: path.join(profile, 'agent') }
    });
    clients.push(client);
    await client.init();
    return client;
  }
  const first = await connect();
  const listing = await call(first, 'list_windows', {});
  const configured = listing.meta.browserLane.browsers.find(item => item.source === 'configured');
  assert.ok(configured);
  const tab = (await call(first, 'set_value', { elementId: configured.newTab, value: url })).meta.opened.id;
  const original = (await call(first, 'find', { browserTab: tab, query: 'Original', controlType: 'Button' })).meta.results[0];
  const insert = (await call(first, 'find', { browserTab: tab, query: 'Insert', controlType: 'Button' })).meta.results[0];
  await call(first, 'click', { elementId: insert.id });
  const oldPid = first.child.pid;
  first.close();
  for (let i = 0; i < 100 && first.child.exitCode === null && first.child.signalCode === null; i++) await delay(50);
  assert.ok(first.child.exitCode !== null || first.child.signalCode !== null, 'First MCP process did not exit');
  const second = await connect();
  assert.notEqual(second.child.pid, oldPid);
  const windows = await call(second, 'list_windows', {});
  const current = windows.meta.browserLane.browsers.filter(item => item.source === 'configured')
    .flatMap(item => item.tabs).find(item => item.url === url);
  assert.ok(current, 'Reconnected tab was not listed');
  assert.notEqual(current.id, tab);
  // Populate the new server's mapping before trying the old reference.
  const inserted = (await call(second, 'find', { browserTab: current.id, query: 'Inserted', controlType: 'Button' })).meta.results[0];
  assert.ok(inserted);
  const refused = await second.call('windows_computer_use_click', { elementId: original.id });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /BROWSER_ELEMENT_STALE|BROWSER_TAB_NOT_FOUND/);
  assert.doesNotMatch((await call(second, 'accessibility_tree', { browserTab: current.id })).page, /WRONG-INSERTED/);
  const fresh = (await call(second, 'find', { browserTab: current.id, query: 'Original', controlType: 'Button' })).meta.results[0];
  await call(second, 'click', { elementId: fresh.id });
  assert.match((await call(second, 'accessibility_tree', { browserTab: current.id })).page, /"ORIGINAL"/);
  console.log(JSON.stringify({ passed: true, oldPid, newPid: second.child.pid, oldId: original.id, newId: fresh.id }));
} finally {
  for (const client of clients) client.close();
  browser?.kill();
  server.closeAllConnections();
  server.close();
}
