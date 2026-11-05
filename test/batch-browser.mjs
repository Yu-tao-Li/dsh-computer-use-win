// Local, deterministic workloads measure tool calls and response bytes, not
// model tokens or success rates on OSWorld/real music services.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpTestClient } from './mcp-test-client.mjs';

const page = `<!doctype html><meta charset="utf-8"><title>Batch fixture</title>
<label>Name <input id="name"></label><label>City <input id="city"></label><label>Note <textarea id="note"></textarea></label>
<label><input type="checkbox" id="agree">Agree</label><button onclick="document.querySelector('#out').textContent='FORM:'+document.querySelector('#name').value+':'+document.querySelector('#city').value+':'+document.querySelector('#note').value+':'+document.querySelector('#agree').checked">Submit fixture</button>
<label>Song <input id="song"></label><button onclick="document.querySelector('#out').textContent=document.querySelector('#song').value==='晴天'?'MUSIC:晴天:周杰伦':'MUSIC:empty'">Search song</button>
<button onclick="location.href='/destination'">Navigate</button><button onclick="alert('fixture dialog')">Dialog</button><button onclick="window.open('/destination')">Popup</button>
<button onclick="document.querySelector('#out').textContent='MUST_NOT_RUN'">Forbidden later step</button><p id="out">Ready</p>`;
const site = http.createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(request.url.startsWith('/destination') ? '<!doctype html><title>Destination</title><h1>Destination</h1>' : page); });
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-batch-browser-'));
await mkdir(path.join(root, 'local'));
const client = new McpTestClient(process.execPath, [fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))], { env: { ...process.env, NODE_ENV: 'test', WCU_TEST_NO_TAKEOVER: '1', WCU_BROWSER_HEADLESS: '1', WCU_IMAGE_MODE: 'file', LOCALAPPDATA: path.join(root, 'local'), WCU_BROWSER_PROFILE: path.join(root, 'agent') } });
const call = (name, args = {}) => client.call('windows_computer_use_' + name, args);
const data = result => JSON.parse(result.content[0].text);
const good = result => { assert.equal(result.isError, undefined, JSON.stringify(result)); return data(result); };
const open = async () => good(await call('set_value', { elementId: 'new-tab', value: `http://127.0.0.1:${site.address().port}/` })).opened.id;
const find = async (tab, query, controlType) => good(await call('find', { browserTab: tab, query, ...(controlType ? { controlType } : {}), maxResults: 20 })).results;
const ref = async (tab, query, controlType) => { const rows = await find(tab, query, controlType); assert.ok(rows.length, query); return rows[0].id; };
const reports = [], stops = [];
try {
  await client.init();
  const definitions=new Map((await client.request('tools/list')).tools.map(tool=>[tool.name.replace('windows_computer_use_',''),tool.inputSchema]));
  for (const workload of ['form','music']) {
    for (const mode of ['single','batch']) {
      const tab = await open();
      let steps, expected;
      if (workload === 'form') {
        steps = [];
        for (const [label,value] of [['Name','Fixture'],['City','Taipei'],['Note','test']]) steps.push({ action: 'set_value', arguments: { elementId: await ref(tab,label,'Edit'), value } });
        steps.push({ action: 'set_value', arguments: { elementId: await ref(tab,'Agree','CheckBox'), value: 'true' } });
        steps.push({ action: 'click', arguments: { elementId: await ref(tab,'Submit fixture','Button') } });
        expected = 'FORM:Fixture:Taipei:test:true';
      } else {
        steps = [{ action: 'set_value', arguments: { elementId: await ref(tab,'Song','Edit'), value: '晴天' } }, { action: 'click', arguments: { elementId: await ref(tab,'Search song','Button') } }];
        expected = 'MUSIC:晴天:周杰伦';
      }
      const results = [], started = performance.now();
      if (mode === 'single') for (const step of steps) { const result = await call(step.action, { ...(definitions.get(step.action).properties.browserTab?{browserTab:tab}:{}), ...step.arguments }); good(result); results.push(result); }
      else { const result = await call('batch', { browserTab: tab, steps }); good(result); assert.equal(data(result).completed, steps.length); results.push(result); assert.equal(result.content.filter(block => block.text === 'Final observation:').length, 1); }
      const durationMs = Math.round(performance.now() - started);
      assert.ok((await find(tab,expected)).length, 'The final form/search result must match');
      reports.push({ workload, mode, actions: steps.length, toolCalls: results.length, responseBytes: results.reduce((sum,result) => sum + Buffer.byteLength(JSON.stringify(result)), 0), durationMs, finalState: expected });
      await call('close_window', { browserTab: tab });
    }
  }
  for (const [button,reason] of [['Navigate','navigation'],['Dialog','dialog'],['Popup','newWindow']]) {
    const tab = await open();
    const first = await ref(tab,button,'Button'), later = await ref(tab,'Forbidden later step','Button');
    const result = await call('batch', { browserTab: tab, steps: [{ action: 'click', arguments: { elementId: first } }, { action: 'click', arguments: { elementId: later } }] });
    assert.equal(result.isError, true); assert.equal(data(result).stopReason, reason); assert.equal(data(result).completed, 1);
    assert.equal(data(result).steps.length, 1);
    if (reason === 'dialog') await call('keypress', { browserTab: tab, keys: ['Escape'] });
    assert.equal((await find(tab,'MUST_NOT_RUN')).length, 0);
    stops.push(reason); await call('close_window', { browserTab: tab });
  }
  // #69: the same changes caused by the last step complete the plan.
  for (const [button,reason] of [['Navigate','navigation'],['Dialog','dialog'],['Popup','newWindow']]) {
    const tab = await open();
    const song = await ref(tab,'Song','Edit'), last = await ref(tab,button,'Button');
    const result = await call('batch', { browserTab: tab, steps: [{ action: 'set_value', arguments: { elementId: song, value: 'fixture' } }, { action: 'click', arguments: { elementId: last } }] });
    assert.equal(result.isError, undefined, JSON.stringify(data(result)));
    assert.equal(data(result).ok, true); assert.equal(data(result).completed, 2);
    assert.equal(data(result).stopReason, 'completed'); assert.equal(data(result).afterLastStep, reason);
    if (reason === 'dialog') await call('keypress', { browserTab: tab, keys: ['Escape'] });
    stops.push('last-' + reason); await call('close_window', { browserTab: tab });
  }
  const artifact = path.join(root, 'results.json');
  await writeFile(artifact, JSON.stringify({ passed: true, reports, stops, scope: 'real headless Chromium and local deterministic form/music fixtures; no model inference', root }, null, 2));
  console.log(JSON.stringify({ passed: true, reports, stops, artifact, root }));
} finally {
  client.child.stdin.end(); const timer = setTimeout(() => client.child.kill(), 6000);
  if (client.child.exitCode === null) await new Promise(resolve => client.child.once('exit', resolve)); clearTimeout(timer);
  await new Promise(resolve => site.close(resolve));
}
