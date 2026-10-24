// Browser lane end to end through the real MCP server: a headless agent
// browser on a throwaway profile and a local fixture site. No desktop input.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { McpTestClient } from './mcp-test-client.mjs';

const pages = {
  '/': `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Lane Fixture</title></head><body>
<nav><a href="/page2">下一页</a></nav>
<main><h1>浏览器通道测试页</h1>
<form action="/search" method="get"><label>关键词 <input name="q" placeholder="搜索"></label> <button type="submit">搜索</button></form>
<button onclick="const p=document.createElement('p');p.textContent='你输入了：'+document.querySelector('input[name=q]').value;document.querySelector('main').append(p)">显示输入</button>
<label><input type="checkbox"> 记住我</label>
<select><option value="bj">北京</option><option value="sh">上海</option></select>
<div id="cover" style="position:fixed;left:0;top:0;width:100%;height:40px;background:#fff;display:none;z-index:10">遮挡层</div>
<button style="position:fixed;left:5px;top:5px">被遮挡的按钮</button>
<button onclick="document.getElementById('cover').style.display='block'">打开遮挡</button>
<button onclick="setTimeout(()=>{const p=document.createElement('p');p.textContent='延迟出现';document.body.append(p)},600)">延迟</button>
<button onclick="alert('你好')">弹窗</button>
</main></body></html>`,
  '/page2': '<!doctype html><meta charset="utf-8"><title>第二页</title><h1>第二页内容</h1><a href="/">返回首页</a>'
};
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture');
  const q = url.searchParams.get('q') ?? '';
  const body = url.pathname === '/search' ? `<!doctype html><meta charset="utf-8"><title>结果 - ${q}</title><h1>搜索结果</h1><ul><li><a href="/page2">${q} 的第一条</a></li></ul>` : pages[url.pathname];
  response.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body ?? 'not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const site = `http://127.0.0.1:${server.address().port}`;
const profiles = await mkdtemp(path.join(os.tmpdir(), 'wcu-browser-lane-'));
const foreground = () => Number(spawnSync('powershell.exe', ['-NoProfile', '-Command',
  "Add-Type -Name Fg -Namespace W -MemberDefinition '[DllImport(\"user32.dll\")] public static extern System.IntPtr GetForegroundWindow();'; [W.Fg]::GetForegroundWindow().ToInt64()"], { encoding: 'utf8', windowsHide: true }).stdout.trim());
const prefix = 'windows_computer_use_', steps = [];
const client = new McpTestClient(process.execPath, [path.join(import.meta.dirname, '../mcp/server.mjs')], { env: { ...process.env, WCU_BROWSER_PROFILE: profiles } });
async function call(tool, args, { error } = {}) {
  const started = performance.now();
  const response = await client.call(prefix + tool, args);
  const text = response.content.filter(item => item.type === 'text').map(item => item.text);
  steps.push({ tool, args, wallMs: Math.round(performance.now() - started), isError: Boolean(response.isError) });
  if (error) { assert.equal(response.isError, true, `${tool} should fail: ${text.join('\n')}`); assert.match(text.join('\n'), error); return text.join('\n'); }
  assert.ok(!response.isError, `${tool} ${JSON.stringify(args)}: ${text.join('\n')}`);
  return { meta: JSON.parse(text[0]), page: text[1] ?? '', images: response.content.filter(item => item.type === 'image') };
}
const idOf = (page, pattern) => {
  const line = page.split('\n').find(item => pattern.test(item));
  assert.ok(line, `no line matches ${pattern} in\n${page}`);
  return /\[(t[0-9a-z]+:\d+)\]/.exec(line)[1];
};
try {
  await client.init();
  const listed = (await client.request('tools/list')).tools;
  assert.equal(listed.length, 24, 'The browser lane adds no tool');
  for (const tool of ['snapshot', 'accessibility_tree', 'find', 'type_text', 'keypress', 'scroll', 'screenshot', 'wait_for', 'activate_window', 'close_window'])
    assert.ok(listed.find(item => item.name === prefix + tool).inputSchema.properties.browserTab, `${tool} accepts browserTab`);
  const before = foreground();

  let r = await call('set_value', { elementId: 'new-tab', value: site + '/' });
  const tab = r.meta.opened.id;
  assert.equal(r.meta.background, true);
  assert.match(r.page, new RegExp(`set_value ${tab}:address navigates`));
  const home = r.page;
  const windows = await call('list_windows', {});
  const agent = windows.meta.browserLane.browsers.find(browser => browser.source === 'agent');
  assert.ok(agent?.tabs.some(item => item.id === tab), 'list_windows lists the agent tab');
  assert.ok(!agent.tabs.some(item => /^(about|chrome|edge):/.test(item.url)), 'Only the agent context is listed');

  r = await call('accessibility_tree', { browserTab: tab });
  assert.equal(r.meta.channel, 'browser'); assert.match(r.page, /textbox "关键词"/); assert.match(r.page, /button "搜索"/);
  const field = idOf(home, /textbox "关键词"/);
  r = await call('set_value', { elementId: field, value: '晴天 周杰伦' });
  assert.equal(r.meta.verifyValue, '晴天 周杰伦'); assert.match(r.page, /value="晴天 周杰伦"/);
  r = await call('click', { elementId: idOf(home, /button "显示输入"/) });
  assert.match(r.page, /^\+ .*你输入了：晴天 周杰伦/m, 'A click returns only what changed');
  r = await call('set_value', { elementId: idOf(home, /combobox/), value: '上海' });
  assert.equal(r.meta.verifyValue, '上海');
  r = await call('set_value', { elementId: idOf(home, /checkbox "记住我"/), value: 'true' });
  assert.equal(r.meta.verifyValue, 'checked');
  await call('click', { elementId: idOf(home, /button "打开遮挡"/) });
  await call('click', { elementId: idOf(home, /被遮挡的按钮/) }, { error: /BROWSER_ELEMENT_COVERED.*遮挡层/ });
  r = await call('click', { elementId: idOf(home, /button "弹窗"/) });
  assert.deepEqual(r.meta.dialog, { type: 'alert', message: '你好' });
  await call('click', { elementId: field }, { error: /BROWSER_DIALOG_OPEN/ });
  r = await call('keypress', { browserTab: tab, keys: ['Enter'] });
  assert.equal(r.meta.handledDialog, 'accepted');
  await call('click', { elementId: idOf(home, /button "延迟"/) });
  r = await call('wait_for', { browserTab: tab, condition: 'text', query: '延迟出现', timeoutMs: 5000, intervalMs: 100 });
  assert.equal(r.meta.verification, 'observed');

  await call('click', { elementId: field });
  await call('keypress', { browserTab: tab, keys: ['ctrl', 'a'] });
  r = await call('type_text', { browserTab: tab, text: '七里香' });
  assert.equal(r.meta.verifyValue, '七里香');
  r = await call('keypress', { browserTab: tab, keys: ['Enter'] });
  assert.equal(r.meta.pageChange, 'full'); assert.match(r.page, /"结果 - 七里香"/); assert.match(r.page, /link "七里香 的第一条"/);
  r = await call('element_info', { elementId: idOf(r.page, /link "七里香 的第一条"/) });
  assert.equal(r.meta.tag, 'a'); assert.equal(r.meta.href, site + '/page2');
  r = await call('keypress', { browserTab: tab, keys: ['alt', 'left'] });
  assert.equal(r.meta.navigated, 'back'); assert.match(r.page, /"Lane Fixture"/);
  r = await call('find', { browserTab: tab, query: '记住' });
  assert.equal(r.meta.count, 1); assert.equal(r.meta.results[0].role, 'checkbox');
  r = await call('snapshot', { browserTab: tab, maxWidth: 640 });
  assert.equal(r.images.length, 1); assert.equal(r.images[0].mimeType, 'image/png'); assert.ok(r.meta.screenshot.width <= 640);
  r = await call('set_value', { elementId: `${tab}:address`, value: site + '/page2' });
  assert.match(r.page, /heading "第二页内容"/);
  await call('keypress', { browserTab: tab, keys: ['ctrl', 'l'] }, { error: /BROWSER_UI_SHORTCUT/ });
  await call('accessibility_tree', { browserTab: tab, windowTitle: 'x' }, { error: /INVALID_ARGUMENTS/ });
  await call('set_value', { elementId: `${tab}:address`, value: '晴天' }, { error: /INVALID_ARGUMENTS.*search URL/ });
  await call('accessibility_tree', { browserTab: 'tffff' }, { error: /BROWSER_TAB_NOT_FOUND/ });
  await call('wait_for', { browserTab: tab, condition: 'text' }, { error: /INVALID_ARGUMENTS.*requires query/ });
  await call('keypress', { browserTab: tab, keys: ['a', 'b'] }, { error: /INVALID_ARGUMENTS.*one non-modifier/ });
  r = await call('scroll', { browserTab: tab, deltaY: 200 });
  assert.ok(Array.isArray(r.meta.pageScroll.after), 'Scrolling a tab alone reports the page offset');
  r = await call('close_window', { browserTab: tab });
  assert.equal(r.meta.closed, true);
  await delay(500);
  assert.ok(!(await call('list_windows', {})).meta.browserLane.browsers.flatMap(browser => browser.tabs).some(item => item.id === tab), 'The closed tab is gone');
  // Someone at a development machine may switch windows meanwhile; CI has no user.
  const after = foreground();
  if (process.env.CI) assert.equal(after, before, 'Browser-lane work never changes the foreground window');
  else if (after !== before) console.log(`note: the foreground window changed (${before} -> ${after}); not asserted outside CI`);
} finally {
  client.close();
}
// The agent browser belongs to the server process and goes with it.
let survivors = [];
for (let i = 0; i < 20; i++) {
  await delay(250);
  const query = spawnSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${profiles}*' }).Count`], { encoding: 'utf8', windowsHide: true });
  survivors = Number(query.stdout.trim());
  if (survivors === 0) break;
}
assert.equal(survivors, 0, 'The agent browser exits with the MCP server');

// A browser the user connected (remote debugging on): its tabs keep the
// browser's own state, and new-tab of that browser opens there in the background.
const executable = ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']
  .flatMap(relative => [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(root => path.join(root, relative))).find(existsSync);
const userProfile = await mkdtemp(path.join(os.tmpdir(), 'wcu-browser-user-'));
const userBrowser = spawn(executable, ['--remote-debugging-port=0', `--user-data-dir=${userProfile}`, '--no-first-run', '--headless=new', '--disable-sync', 'about:blank'], { stdio: 'ignore', windowsHide: true });
let endpoint;
for (let i = 0; i < 100 && !endpoint; i++) { await delay(100); endpoint = await readFile(path.join(userProfile, 'DevToolsActivePort'), 'utf8').then(text => `http://127.0.0.1:${text.split(/\r?\n/)[0]}`, () => null); }
const connected = new McpTestClient(process.execPath, [path.join(import.meta.dirname, '../mcp/server.mjs')], { env: { ...process.env, WCU_BROWSER_CDP_URL: endpoint, WCU_BROWSER_PROFILE: profiles } });
try {
  await connected.init();
  const listing = JSON.parse((await connected.call(prefix + 'list_windows', {})).content[0].text).browserLane;
  const own = listing.browsers.find(browser => browser.source === 'configured');
  assert.ok(own, `the configured browser is listed: ${JSON.stringify(listing)}`);
  assert.ok(own.tabs.some(item => item.url === 'about:blank'), 'its existing blank tab is listed');
  const opened = await connected.call(prefix + 'set_value', { elementId: own.newTab, value: site + '/page2' });
  assert.ok(!opened.isError, JSON.stringify(opened));
  assert.match(opened.content[1].text, /heading "第二页内容"/);
  const pages = await fetch(endpoint + '/json/list').then(response => response.json());
  assert.ok(pages.some(item => item.url === site + '/page2'), 'The tab opened in the connected browser itself');
  steps.push({ tool: 'connected-browser', ok: true });
} finally {
  connected.close(); server.close(); userBrowser.kill();
}
console.log(JSON.stringify({ passed: true, steps: steps.length, profileEntries: (await readdir(profiles)).length, timings: steps.map(step => `${step.tool}:${step.wallMs ?? '-'}`) }));
