// Cheaper observations (#97), all opt-in. A UI Automation tree can come back
// as a summary (ids, types, names and states only), within a byte budget, or
// as the change since an earlier read of the same window; an OCR result can be
// held to a byte budget. What a budget leaves out is saved to a file whose path
// the result gives. Byte counts are of the UTF-8 JSON the agent receives.
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const bytesOf = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

// A summary node: what identifies it and its state, no box or class.
export function summarizeTree(node, root = true) {
  if (!node || typeof node !== 'object') return node;
  const out = { id: node.id, controlType: node.controlType };
  if (node.name) out.name = node.name;
  if (node.isEnabled === false) out.disabled = true;
  if (node.hasKeyboardFocus === true) out.focused = true;
  if (node.isOffscreen === true) out.offscreen = true;
  if (root && node.nativeWindowHandle) out.nativeWindowHandle = node.nativeWindowHandle;
  if (Array.isArray(node.children) && node.children.length) out.children = node.children.map(child => summarizeTree(child, false));
  return out;
}

// Controls an agent acts on. Most of them sit deep in an app's tree (the
// report in #97 found 62 % below depth 8), so a budget keeps them and their
// ancestors rather than the top of the tree.
export const ACTIONABLE = new Set(['Button', 'SplitButton', 'MenuItem', 'MenuBar', 'Menu', 'Hyperlink', 'Edit', 'Document', 'CheckBox', 'RadioButton',
  'ComboBox', 'List', 'ListItem', 'Tab', 'TabItem', 'Tree', 'TreeItem', 'DataItem', 'Slider', 'Spinner', 'ScrollBar', 'Table', 'DataGrid', 'Window']);
export function keepActionable(node) {
  let omitted = 0;
  const walk = (current, root) => {
    const children = [];
    for (const child of current.children ?? []) {
      const kept = walk(child, false);
      if (kept) children.push(kept);
    }
    if (!root && !children.length && !ACTIONABLE.has(current.controlType) && !current.focused && !current.hasKeyboardFocus) { omitted++; return null; }
    const copy = { ...current };
    if (children.length) copy.children = children; else delete copy.children;
    return copy;
  };
  return { tree: walk(node, true), omitted };
}

// The first `count` nodes in breadth-first order. Every parent comes before
// its children, so the cut keeps whole paths from the root.
function firstNodes(root, count) {
  const copies = new Map(), order = [root];
  for (let i = 0; i < order.length; i++) for (const child of order[i].children ?? []) order.push(child);
  const parents = new Map();
  for (const node of order) for (const child of node.children ?? []) parents.set(child, node);
  for (const node of order.slice(0, count)) {
    const copy = { ...node }; delete copy.children;
    copies.set(node, copy);
    const parent = parents.get(node);
    if (parent) (copies.get(parent).children ??= []).push(copy);
  }
  return { tree: copies.get(root), total: order.length };
}
export function cutTree(result, maxBytes) {
  const full = result.tree, { total } = firstNodes(full, 0);
  let low = 1, high = total, best = 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (bytesOf({ ...result, tree: firstNodes(full, mid).tree }) <= maxBytes) { best = mid; low = mid + 1; } else high = mid - 1;
  }
  return { tree: firstNodes(full, best).tree, kept: best, total };
}

const SPILL_DIR = path.join(os.tmpdir(), 'dsh-wcu-observations');
const SPILL_RE = /^[a-f0-9-]{36}\.json$/;
let nextSweep = 0;
// The whole result, for reading with a file tool. Kept 30 minutes, like screenshots.
export async function spill(result, dir = SPILL_DIR) {
  await mkdir(dir, { recursive: true });
  if (Date.now() >= nextSweep) {
    nextSweep = Date.now() + 5 * 60 * 1000;
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !SPILL_RE.test(entry.name)) continue;
      const file = path.join(dir, entry.name);
      try { if ((await stat(file)).mtimeMs < cutoff) await unlink(file); } catch {}
    }
  }
  const file = path.join(dir, randomUUID() + '.json');
  await writeFile(file, JSON.stringify(result), { flag: 'wx' });
  return file;
}

// Even a single root name or auxiliary metadata can exceed the whole budget.
// In that case the file is the only complete result that fits the contract.
export function observationFileResult(result, maxBytes, fullResultPath) {
  const { ok, action, scope, treeId, delta, countedDepth, structuralDepth } = result;
  return { ok, action, scope, treeId, countedDepth, structuralDepth, ...(delta?.fallback ? { delta:{ base:delta.base, fallback:delta.fallback } } : {}),
    truncated:true, truncationReason:'maxBytes', budget:{ maxBytes, steps:[...(result.budget?.steps??[]),'fileOnly'], fullResultPath,
      hint:'Read fullResultPath for the result.' } };
}

// Over maxBytes a tree becomes a summary, then keeps only actionable controls
// and their ancestors, and only then is cut, with the whole result in a file.
export async function budgetTree(result, maxBytes, { save = spill } = {}) {
  if (!result?.tree || !maxBytes || bytesOf(result) <= maxBytes) return result;
  const steps = [], original = result;
  let shaped = result;
  if (result.detailLevel !== 'summary') { shaped = { ...shaped, tree: summarizeTree(shaped.tree), detailLevel: 'summary' }; steps.push('summary'); }
  const response = () => ({ ...shaped, budget: { maxBytes, steps, ...(shaped.budget?.omittedNodes ? { omittedNodes: shaped.budget.omittedNodes } : {}) } });
  if (bytesOf(response()) > maxBytes) {
    const { tree, omitted } = keepActionable(shaped.tree);
    shaped = { ...shaped, tree }; steps.push('actionable');
    shaped.budget = { maxBytes, steps, omittedNodes: omitted };
  }
  if (bytesOf(response()) > maxBytes) {
    const fullResultPath = await save(original);
    const { tree, kept, total } = cutTree({ ...shaped, budget: { maxBytes, steps: [...steps, 'cut'], fullResultPath } }, maxBytes - 400);
    steps.push('cut');
    const cut = { ...shaped, tree, budget: { maxBytes, steps, omittedNodes: (shaped.budget?.omittedNodes ?? 0) + total - kept, fullResultPath,
      hint: 'The tree was cut to fit maxBytes. Read fullResultPath for the whole result, or use find for a specific control.' } };
    return bytesOf(cut) <= maxBytes ? cut : observationFileResult(cut, maxBytes, fullResultPath);
  }
  return response();
}

// Over maxBytes an OCR result drops its word boxes, then its joined text (the
// lines carry it), then lines from the end, with the whole result in a file.
export async function budgetOcr(result, maxBytes, { save = spill } = {}) {
  if (!result || !maxBytes || bytesOf(result) <= maxBytes) return result;
  if (!Array.isArray(result.lines)) return observationFileResult(result, maxBytes, await save(result));
  const steps = [];
  let shaped = { ...result, lines: result.lines.map(({ words, ...line }) => line) }; steps.push('noWordBoxes');
  if (bytesOf(shaped) > maxBytes && typeof shaped.text === 'string') { const { text, ...rest } = shaped; shaped = rest; steps.push('noJoinedText'); }
  if (bytesOf({ ...shaped, budget: { maxBytes, steps } }) <= maxBytes) return { ...shaped, budget: { maxBytes, steps } };
  const fullResultPath = await save(result);
  steps.push('cutLines');
  const lineCount = result.lines.length;
  const fit = count => ({ ...shaped, lines: shaped.lines.slice(0, count), lineCount: result.lineCount ?? lineCount,
    budget: { maxBytes, steps, linesShown: count, fullResultPath, hint: 'Lines were cut to fit maxBytes. Read fullResultPath for every line and word box, or call ocr with a query.' } });
  let low = 0, high = lineCount, best = 0;
  while (low <= high) { const mid = (low + high) >> 1; if (bytesOf(fit(mid)) <= maxBytes) { best = mid; low = mid + 1; } else high = mid - 1; }
  const cut = fit(best);
  return bytesOf(cut) <= maxBytes ? cut : observationFileResult(cut, maxBytes, fullResultPath);
}

// Tree deltas. A read with treeDeltaBase 'start' returns the tree and a treeId;
// a later read of the same window with treeDeltaBase set to that id returns the
// controls added, removed and changed since it. A missing base, another window,
// another view, a truncated tree, or a change to more than 40 % of the controls
// returns the whole tree, saying why.
const DELTA_FIELDS = ['name', 'controlType', 'value', 'isEnabled', 'isOffscreen', 'hasKeyboardFocus', 'disabled', 'focused', 'offscreen'];
function flatten(tree) {
  const nodes = new Map();
  const walk = (node, parentId) => {
    const { children, ...fields } = node;
    nodes.set(node.id, { ...fields, parentId });
    for (const child of children ?? []) walk(child, node.id);
  };
  if (tree) walk(tree, null);
  return nodes;
}
export class TreeDeltas {
  constructor(limit = 6) { this.limit = limit; this.entries = new Map(); }
  remember(key, result) {
    const id = 't' + randomUUID().replaceAll('-', '').slice(0, 12);
    this.entries.set(id, { key, nodes: flatten(result.tree), truncated: result.truncated === true });
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
    return id;
  }
  markTruncated(id) {
    const entry = this.entries.get(id);
    if (entry) entry.truncated = true;
  }
  apply(base, key, result) {
    if (!result?.tree) return result;
    const previous = base === 'start' ? null : this.entries.get(base);
    const treeId = this.remember(key, result);
    if (base === 'start') return { ...result, treeId };
    const fallback = reason => ({ ...result, treeId, delta: { base, fallback: reason } });
    if (!previous) return fallback('baseUnknown');
    if (previous.key !== key) return fallback('targetChanged');
    if (previous.truncated || result.truncated === true) return fallback('truncated');
    const now = flatten(result.tree), added = [], changed = [], removed = [];
    for (const [id, node] of now) {
      const before = previous.nodes.get(id);
      if (!before) { added.push(node); continue; }
      const diff = {};
      for (const field of DELTA_FIELDS) if (before[field] !== node[field]) diff[field] = node[field] ?? null;
      if (before.parentId !== node.parentId) diff.parentId = node.parentId;
      if (Object.keys(diff).length) changed.push({ id, ...diff });
    }
    for (const id of previous.nodes.keys()) if (!now.has(id)) removed.push(id);
    const touched = added.length + changed.length + removed.length;
    if (touched > 0.4 * Math.max(now.size, previous.nodes.size)) return fallback('mostlyChanged');
    const { tree, ...rest } = result;
    return { ...rest, treeId, delta: { base, added, removed, changed, unchanged: now.size - added.length - changed.length } };
  }
}
