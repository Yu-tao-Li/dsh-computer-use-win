// Reproducible wall-clock A/B for Chromium page-content observations (PR #85 follow-up).
// Read-only: opens only its own Electron fixture; never activates a window.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { McpTestClient } from './mcp-test-client.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'wcu-page-content-benchmark'));
const baselineRoot = process.env.WCU_BASELINE_ROOT ? path.resolve(process.env.WCU_BASELINE_ROOT) : null;
const rounds = Number(process.env.WCU_BENCH_ROUNDS || 4);
const maxRatio = Number(process.env.WCU_AB_MAX_RATIO || 1.25);
await mkdir(artifacts, { recursive: true });

// Not forced accessibility: this is how Electron apps ship, and the state that
// made the original empty-page report hard to diagnose.
const pages = ['rich', 'long', 'shell', 'canvas', 'image'];
const expectations = {
  rich: { contentState: 'content' },
  long: { contentState: 'content' },
  shell: { contentState: 'empty' },
  canvas: { contentState: 'empty', hint: /not a sign-in problem[\s\S]*not broken[\s\S]*prefer OCR or a screenshot over a reload/i },
  image: { contentStateNot: 'unknown' },
};

const env = { ...process.env, WCU_INDICATOR: '0' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.WCU_BASELINE_ROOT;

const clients = [];
async function clientFor(label, repoRoot) {
  const dir = path.join(artifacts, `client-${label}`);
  await mkdir(dir, { recursive: true });
  const client = new McpTestClient(process.execPath, [path.join(repoRoot, 'mcp/server.mjs')], {
    env: { ...env, TEMP: dir, TMP: dir },
  });
  clients.push(client);
  await client.init();
  return client;
}
const current = await clientFor('current', root);
const baseline = baselineRoot ? await clientFor('baseline', baselineRoot) : null;

const fixtures = [];
async function startFixture(page) {
  const dir = path.join(artifacts, `fixture-${page}`);
  await mkdir(dir, { recursive: true });
  const child = spawn(electron, [path.join(root, 'test/uia-chromium-fixture.cjs'), path.join(dir, 'profile'), 'lazy', page], {
    env: { ...env, WCU_TEST_WINDOW_X: '40' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const fixture = { page, dir, child, stderr: '', ready: null };
  fixtures.push(fixture);
  let buffer = '';
  child.stderr.on('data', b => { fixture.stderr += b; });
  child.stdout.on('data', b => {
    buffer += b;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      try { const r = JSON.parse(line); if (r.ready) fixture.ready = r; } catch {}
    }
  });
  for (let i = 0; i < 300 && !fixture.ready; i++) {
    assert.equal(child.exitCode, null, `${page} fixture exited: ${fixture.stderr}`);
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(fixture.ready, `${page} fixture did not start: ${fixture.stderr}`);
  assert.equal(fixture.ready.page, page);
  assert.equal(fixture.ready.forceAccessibility, false);
  return fixture;
}
async function stopFixture(fixture) {
  await writeFile(path.join(fixture.dir, 'command.json'), JSON.stringify({ action: 'quit', id: 100 }));
  fixture.child.stdin.end();
  for (let i = 0; i < 50 && fixture.child.exitCode === null; i++) await new Promise(r => setTimeout(r, 100));
  if (fixture.child.exitCode === null) fixture.child.kill();
}

const results = [];
async function call(client, label, fixture) {
  const args = { nativeWindowHandle: fixture.ready.hwnd, viewMode: 'raw', detailLevel: 'compact', maxDepth: 12, maxNodes: 300 };
  const start = performance.now();
  const response = await client.call('windows_computer_use_accessibility_tree', args);
  const wallMs = Math.round(performance.now() - start);
  assert.ok(!response.isError, `${label}/${fixture.page}: ${JSON.stringify(response)}`);
  const text = response.content.find(c => c.type === 'text')?.text;
  assert.ok(text, `${label}/${fixture.page}: no JSON text in response`);
  const data = JSON.parse(text);
  assert.equal(data.ok, true, `${label}/${fixture.page}: ${text}`);
  const row = { page: fixture.page, label, wallMs, nodeCount: data.nodeCount, contentState: data.webContent?.contentState ?? null, hint: data.hint ?? null };
  results.push(row);
  return row;
}
const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

try {
  for (const page of pages) {
    const fixture = await startFixture(page);
    const target = expectations[page];
    // Warm both runtimes before alternating; warmups are never reported.
    await call(current, 'current-warmup', fixture);
    if (baseline) await call(baseline, 'baseline-warmup', fixture);
    for (let round = 1; round <= rounds; round++) {
      const order = round % 2 === 1 ? [current, baseline] : [baseline, current];
      for (const client of order) {
        if (!client) continue;
        const row = await call(client, client === current ? 'current' : 'baseline', fixture);
        if (client !== current) continue;
        if (target.contentState) assert.equal(row.contentState, target.contentState, `${page}: unexpected contentState in ${JSON.stringify(row)}`);
        if (target.contentStateNot) assert.notEqual(row.contentState, target.contentStateNot, `${page}: unexpected contentState in ${JSON.stringify(row)}`);
        if (target.hint) assert.match(row.hint || '', target.hint, `${page}: unexpected hint ${JSON.stringify(row.hint)}`);
        if (target.hintNot) assert.doesNotMatch(row.hint || '', target.hintNot, `${page}: misleading hint ${JSON.stringify(row.hint)}`);
      }
    }
    await stopFixture(fixture);
  }
} finally {
  await writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ pages, rounds, baselineRoot, results }, null, 2) + '\n');
  for (const fixture of fixtures) if (fixture.child.exitCode === null) fixture.child.kill();
  for (const client of clients) client.child.stdin.end();
  await new Promise(r => setTimeout(r, 500));
  for (const client of clients) if (client.child.exitCode === null) client.child.kill();
}

const summary = [];
for (const page of pages) {
  const currentMs = median(results.filter(r => r.page === page && r.label === 'current').map(r => r.wallMs));
  const baselineMs = baseline ? median(results.filter(r => r.page === page && r.label === 'baseline').map(r => r.wallMs)) : null;
  if (baselineMs !== null) {
    assert.ok(currentMs <= baselineMs * maxRatio + 25, `${page} regression: current ${currentMs}ms vs baseline ${baselineMs}ms (max ratio ${maxRatio})`);
  }
  summary.push({ page, currentMs, baselineMs });
}
const ready = fixtures[0]?.ready;
console.log(`PASS page-content benchmark: chromium=${ready?.chromium || '?'} electron=${ready?.electron || '?'} rounds=${rounds} baseline=${baseline ? 'yes' : 'no'}`);
for (const row of summary) console.log(`  ${row.page}: current ${row.currentMs}ms${row.baselineMs === null ? '' : ` / baseline ${row.baselineMs}ms`}`);
await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify({ chromium: ready?.chromium, electron: ready?.electron, rounds, baselineRoot, summary }, null, 2) + '\n');
