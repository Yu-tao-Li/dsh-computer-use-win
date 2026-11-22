// Cheaper observations (#97): summary trees, byte budgets for trees and OCR,
// tree deltas, and the tools that apply them. A fake backend serves a large
// tree and a large OCR result. No desktop input.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpTestClient } from './mcp-test-client.mjs';
import { budgetOcr, budgetTree, bytesOf, cutTree, keepActionable, summarizeTree, TreeDeltas } from '../mcp/observation-budget.mjs';

// A window with 40 panes of 15 text nodes each; a button sits at depth 4 in each pane.
const box = { x: 10, y: 20, width: 300, height: 40, centerX: 160, centerY: 40 };
const node = (id, controlType, name, depth, children = [], extra = {}) => ({ id, depth, name, automationId: '', className: 'Fixture' + controlType, controlType, boundingBox: box, isEnabled: true, isOffscreen: false, hasKeyboardFocus: false, ...extra, children });
function window(variant = 0) {
  const panes = [];
  for (let p = 0; p < 40; p++) {
    const texts = [];
    for (let t = 0; t < 15; t++) texts.push(node(`uia:rt:42-${p}-${t}`, 'Text', `Line ${p}.${t} of the fixture document`, 2));
    const button = node(`uia:rt:42-${p}-b`, 'Button', variant && p === 3 ? 'Saved' : `Save ${p}`, 4, [], variant && p === 5 ? { isEnabled: false } : {});
    texts.push(node(`uia:rt:42-${p}-g`, 'Group', '', 2, [node(`uia:rt:42-${p}-h`, 'Group', '', 3, [button])]));
    panes.push(node(`uia:rt:42-${p}`, 'Pane', '', 1, texts));
  }
  if (variant) panes.push(node('uia:rt:42-new', 'Button', 'Added later', 1));
  return node('uia:rt:42', 'Window', 'Fixture window', 0, panes, { nativeWindowHandle: 4242, processId: 7 });
}
const depths = { countedDepth: 3, structuralDepth: 4 };
const treeResult = (variant = 0) => ({ ok: true, scope: 'active_window', viewMode: 'control', includeOffscreen: false, detailLevel: 'compact', nodeCount: 761, ...depths, truncated: false, durationMs: 12, tree: window(variant), treeTimeoutMs: 5000, targetResponsive: true });
function assertDepths({ countedDepth, structuralDepth }, expected = depths) {
  assert.deepEqual({ countedDepth, structuralDepth }, expected);
}

// Summary: id, type, name and states only.
const summary = summarizeTree(window());
assert.deepEqual(Object.keys(summary), ['id', 'controlType', 'name', 'nativeWindowHandle', 'children']);
assert.deepEqual(summary.children[0].children[0], { id: 'uia:rt:42-0-0', controlType: 'Text', name: 'Line 0.0 of the fixture document' });
assert.deepEqual(summarizeTree(node('x', 'Button', 'Off', 1, [], { isEnabled: false, hasKeyboardFocus: true, isOffscreen: true })), { id: 'x', controlType: 'Button', name: 'Off', disabled: true, focused: true, offscreen: true });
assert.ok(bytesOf(summary) < bytesOf(window()) / 2.5, 'a summary is far smaller');

// Actionable controls keep their ancestor chain; plain text goes.
const { tree: actionable, omitted } = keepActionable(summary);
assert.equal(omitted, 600 + 40 * 0);
assert.equal(actionable.children.length, 40);
assert.equal(actionable.children[7].children[0].children[0].children[0].name, 'Save 7', 'a deep button keeps its panes and groups');

// Breadth-first cut keeps whole paths from the root.
const cut = cutTree({ tree: summary }, 3000);
assert.ok(bytesOf({ tree: cut.tree }) <= 3000 && cut.kept > 10 && cut.kept < cut.total);

// The budget steps, in order, and the whole result in a file when cut.
const saved = [];
const save = async result => { saved.push(result); return 'C:\\fixture\\full.json'; };
const small = treeResult();
assert.equal(await budgetTree(small, 10_000_000, { save }), small, 'within the budget the result is untouched');
const fits = await budgetTree(treeResult(), 70_000, { save });
assert.deepEqual(fits.budget.steps, ['summary']);
assert.equal(fits.detailLevel, 'summary');
assert.ok(bytesOf(fits) <= 70_000);
const trimmed = await budgetTree(treeResult(), 20_000, { save });
assert.deepEqual(trimmed.budget.steps, ['summary', 'actionable']);
assert.equal(trimmed.budget.omittedNodes, 600);
assert.ok(bytesOf(trimmed) <= 20_000);
const tight = await budgetTree(treeResult(), 4000, { save });
assert.deepEqual(tight.budget.steps, ['summary', 'actionable', 'cut']);
assert.equal(tight.budget.fullResultPath, 'C:\\fixture\\full.json');
assert.match(tight.budget.hint, /find/);
assert.ok(bytesOf(tight) <= 4000, 'cut result fits: ' + bytesOf(tight));
assert.equal(saved.at(-1).tree.children.length, 40, 'the saved copy is the whole original result');
assert.equal(saved.length, 1, 'only a cut saves a file');
const oversizedName = '观察'.repeat(2000);
const rootDepths = { countedDepth: 0, structuralDepth: 0 };
const oversizedRoot = { ...treeResult(), ...rootDepths, tree: { ...window(), name: oversizedName, children:[] } };
const rootPointer = await budgetTree(oversizedRoot, 2000, { save });
assert.ok(bytesOf(rootPointer) <= 2000 && rootPointer.budget.steps.includes('fileOnly'));
assertDepths(rootPointer, rootDepths);
assert.equal(saved.at(-1).tree.name, oversizedName, 'the oversize root is still accessible from its file');

// OCR: word boxes, then the joined text, then lines; the file holds them all.
const words = n => Array.from({ length: 8 }, (_, w) => ({ text: `word${n}-${w}`, x: w * 40, y: n * 20, width: 36, height: 16 }));
const lines = Array.from({ length: 120 }, (_, n) => ({ text: words(n).map(word => word.text).join(' '), words: words(n), boundingBox: { x: 0, y: n * 20, width: 320, height: 16 } }));
const ocr = { ok: true, action: 'ocr', text: lines.map(line => line.text).join('\n'), lines, image: 'C:\\shot.png', coordinateSpace: 'screen', imageScale: 1 };
assert.equal(await budgetOcr(ocr, bytesOf(ocr) + 10, { save }), ocr);
const noBoxes = await budgetOcr(ocr, 27_000, { save });
assert.deepEqual(noBoxes.budget.steps, ['noWordBoxes']);
assert.equal(noBoxes.lines.length, 120);
assert.equal(noBoxes.lines[0].words, undefined);
assert.ok(typeof noBoxes.text === 'string');
const noText = await budgetOcr(ocr, 18_000, { save });
assert.deepEqual(noText.budget.steps, ['noWordBoxes', 'noJoinedText']);
assert.equal(noText.text, undefined);
const cutLines = await budgetOcr(ocr, 4000, { save });
assert.deepEqual(cutLines.budget.steps, ['noWordBoxes', 'noJoinedText', 'cutLines']);
assert.ok(cutLines.budget.linesShown > 5 && cutLines.budget.linesShown < 120 && cutLines.lineCount === 120);
assert.ok(bytesOf(cutLines) <= 4000);
assert.equal(saved.at(-1).lines[0].words.length, 8);
const oversizedMatch = await budgetOcr({ ok:true, matched:[{ text:oversizedName }] }, 2000, { save });
assert.ok(bytesOf(oversizedMatch) <= 2000 && oversizedMatch.budget.steps.includes('fileOnly'));
assert.equal(saved.at(-1).matched[0].text, oversizedName);

// Deltas: start, the changes, and each fallback.
const deltas = new TreeDeltas(2);
const key = 'window-4242';
const first = deltas.apply('start', key, treeResult());
assert.match(first.treeId, /^t[0-9a-f]{12}$/);
assert.ok(first.tree);
const second = deltas.apply(first.treeId, key, treeResult(1));
assert.equal(second.tree, undefined);
assert.deepEqual(second.delta.added.map(added => added.id), ['uia:rt:42-new']);
assert.deepEqual(second.delta.removed, []);
assert.deepEqual(second.delta.changed, [{ id: 'uia:rt:42-3-b', name: 'Saved' }, { id: 'uia:rt:42-5-b', isEnabled: false }]);
assert.equal(second.delta.unchanged, 759);
assert.ok(bytesOf(second) < bytesOf(treeResult()) / 20, 'a delta is a small fraction of the tree');
assert.equal(deltas.apply('t000000000000', key, treeResult()).delta.fallback, 'baseUnknown');
assert.equal(deltas.apply(second.treeId, 'window-other', treeResult()).delta.fallback, 'targetChanged');
const changedMost = treeResult(); changedMost.tree.children = changedMost.tree.children.slice(0, 10);
const third = deltas.apply('start', key, treeResult());
assert.equal(deltas.apply(third.treeId, key, changedMost).delta.fallback, 'mostlyChanged');
const truncated = { ...treeResult(), truncated: true };
const fourth = deltas.apply('start', key, treeResult());
assert.equal(deltas.apply(fourth.treeId, key, truncated).delta.fallback, 'truncated');
assert.equal(deltas.entries.size, 2, 'old trees are forgotten');

// Through the tools, with a fake backend serving the fixtures.
const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-observation-budget-'));
await cp(new URL('../mcp', import.meta.url), path.join(root, 'mcp'), { recursive: true, filter: source => !/^FILE_(LOG|INDEX|HISTORY)\./.test(path.basename(String(source))) && !String(source).endsWith('.file-log.lock') });
await mkdir(path.join(root, 'scripts'));
const fixtures = { tree: path.join(root, 'tree.json'), tree2: path.join(root, 'tree2.json'), ocr: path.join(root, 'ocr.json') };
await writeFile(fixtures.tree, JSON.stringify(treeResult()));
await writeFile(fixtures.tree2, JSON.stringify(treeResult(1)));
await writeFile(fixtures.ocr, JSON.stringify(ocr));
const log = path.join(root, 'requests.jsonl'), flag = path.join(root, 'variant');
await writeFile(path.join(root, 'scripts/windows-uia.ps1'), `param([switch]$Persistent)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::WriteLine((@{type='ready';protocol=1;pid=$PID}|ConvertTo-Json -Compress))
while($null -ne ($line=[Console]::In.ReadLine())) {
  [IO.File]::AppendAllText($env:WCU_FAKE_LOG, $line + [char]10)
  $r=$line | ConvertFrom-Json
  $file = if ($r.action -eq 'ocr') { $env:WCU_FAKE_OCR } elseif ([IO.File]::Exists($env:WCU_FAKE_FLAG)) { $env:WCU_FAKE_TREE2 } else { $env:WCU_FAKE_TREE }
  $body = [IO.File]::ReadAllText($file)
  [Console]::WriteLine('{"id":' + $r.id + ',' + $body.Substring(1))
}
`);
const client = new McpTestClient(process.execPath, [path.join(root, 'mcp/server.mjs')], {
  env: { ...process.env, NODE_ENV: 'test', WCU_TEST_NO_TAKEOVER: '1', WCU_BROWSER_LANE: 'off', WCU_FAKE_LOG: log, WCU_FAKE_FLAG: flag,
    WCU_FAKE_TREE: fixtures.tree, WCU_FAKE_TREE2: fixtures.tree2, WCU_FAKE_OCR: fixtures.ocr, WCU_SETTINGS_JSON: undefined },
});
const data = result => { assert.ok(!result.isError, result.content[0].text); return JSON.parse(result.content[0].text); };
try {
  await client.init();
  const call = (name, args) => client.call('windows_computer_use_' + name, args);
  const plain = data(await call('accessibility_tree', { nativeWindowHandle: 4242 }));
  assert.equal(plain.detailLevel, 'compact');
  assert.equal(plain.budget, undefined, 'without the new arguments nothing changes');
  assert.equal(plain.tree.children[0].children[0].boundingBox.width, 300);
  const brief = data(await call('accessibility_tree', { nativeWindowHandle: 4242, detailLevel: 'summary' }));
  assert.equal(brief.detailLevel, 'summary');
  assert.equal(brief.tree.children[0].children[0].boundingBox, undefined);
  const sent = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(sent.at(-1).args.detailLevel, 'compact', 'the backend reads a summary as compact');
  const budgeted = data(await call('accessibility_tree', { nativeWindowHandle: 4242, maxBytes: 4000 }));
  assert.deepEqual(budgeted.budget.steps, ['summary', 'actionable', 'cut']);
  assert.equal(JSON.parse(await readFile(budgeted.budget.fullResultPath, 'utf8')).tree.children.length, 40, 'the full result is in the file');
  const start = data(await call('accessibility_tree', { nativeWindowHandle: 4242, treeDeltaBase: 'start' }));
  assert.ok(start.tree && start.treeId);
  await writeFile(flag, '1');
  const delta = data(await call('accessibility_tree', { nativeWindowHandle: 4242, treeDeltaBase: start.treeId }));
  assert.equal(delta.tree, undefined);
  assert.deepEqual(delta.delta.added.map(added => added.id), ['uia:rt:42-new']);
  const other = data(await call('accessibility_tree', { nativeWindowHandle: 4242, treeDeltaBase: delta.treeId, detailLevel: 'summary' }));
  assert.equal(other.delta.fallback, 'targetChanged', 'another detail level is another view');
  const snapshot = data(await call('snapshot', { nativeWindowHandle: 4242, detailLevel: 'summary', includeScreenshot: false }));
  assert.equal(snapshot.detailLevel, 'summary');
  const budgetedSnapshot = data(await call('snapshot', { nativeWindowHandle: 4242, maxBytes: 4000, includeScreenshot: false }));
  assert.deepEqual(budgetedSnapshot.budget.steps, ['summary', 'actionable', 'cut']);
  for (const result of [plain, brief, budgeted, start, delta, other, snapshot, budgetedSnapshot]) assertDepths(result);
  assert.equal(brief.tree.children[0].depth, undefined, 'summary depth stays at the result level');
  const words = data(await call('ocr', { nativeWindowHandle: 4242, maxBytes: 4000 }));
  assert.deepEqual(words.budget.steps, ['noWordBoxes', 'noJoinedText', 'cutLines']);
  assert.equal(data(await call('ocr', { nativeWindowHandle: 4242 })).lines[0].words.length, 8);
  const deltaBase = data(await call('accessibility_tree', { nativeWindowHandle: 4242, treeDeltaBase:'start' }));
  const largeChange = treeResult(1);
  largeChange.tree.children.at(-1).name = oversizedName;
  await writeFile(fixtures.tree2, JSON.stringify(largeChange));
  const boundedResponse = await call('accessibility_tree', { nativeWindowHandle:4242, treeDeltaBase:deltaBase.treeId, maxBytes:2000 });
  const boundedDelta = data(boundedResponse);
  assert.ok(Buffer.byteLength(boundedResponse.content[0].text) <= 2000, 'tree delta cannot bypass maxBytes');
  assert.equal(boundedDelta.delta.fallback, 'maxBytes');
  assertDepths(boundedDelta);
  assert.equal(JSON.parse(await readFile(boundedDelta.budget.fullResultPath,'utf8')).tree.children.at(-1).name, oversizedName);
  assert.equal(data(await call('accessibility_tree', { nativeWindowHandle:4242, treeDeltaBase:boundedDelta.treeId })).delta.fallback, 'truncated', 'a reduced tree is not a complete delta baseline');
  assert.match((await call('accessibility_tree', { nativeWindowHandle: 4242, treeDeltaBase: 'yesterday' })).content[0].text, /INVALID_ARGUMENTS/);
  assert.match((await call('accessibility_tree', { nativeWindowHandle: 4242, maxBytes: 100 })).content[0].text, /INVALID_ARGUMENTS/);
} finally { client.close(); await rm(flag, { force: true }); }

console.log(JSON.stringify({ passed: true, summary: true, actionableKept: true, cutWithFile: true, ocrSteps: true, deltas: true, deltaFallbacks: true, toolsApplyThem: true, defaultsUnchanged: true }));
