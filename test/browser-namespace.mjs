// Cross-run references must have enough namespace entropy before local collision
// resolution. No browser process is needed for this mapping regression.
import assert from 'node:assert/strict';
import { BrowserLane } from '../mcp/browser.mjs';

const seen = new Set();
for (let i = 0; i < 4096; i++) {
  const lane = new BrowserLane();
  try {
    assert.match(lane.salt, /^[0-9a-f]{32,}$/, 'Run salt must retain at least 128 bits before hashing');
    const tab = lane.tabFor({ name: 'fixture', source: 'configured' }, {
      targetId: '0123456789ABCDEF0123456789ABCDEF',
      title: 'fixture', url: 'http://fixture.invalid'
    });
    assert.match(tab.key, /^t[0-9a-f]{16,}$/, 'At least 64 bits must survive key shortening');
    const id = lane.idFor(tab, 100 + i);
    assert.ok(!seen.has(id), `Cross-instance reference reused: ${id}`);
    seen.add(id);
    assert.equal(lane.nodeFor(tab, Number(id.split(':')[1])), 100 + i);
  } finally {
    await lane.close();
  }
}
console.log('PASS 4096 independent namespaces, minimum 64 bits and correct backend mappings');

// A cold health request must resolve the requested/default browser before
// reporting its executable/profile, without starting or connecting a browser.
for (const app of ['edge', 'chrome', 'default']) {
  const lane = new BrowserLane({env:{WCU_BROWSER_APP:app,WCU_BROWSER_SIGNIN:'1'}});
  let resolved=false;
  if(app==='default')lane.resolveApp=async()=>{await Promise.resolve();resolved=true;return lane.resolvedApp='edge';};
  const actualExecutable=lane.agentExecutable.bind(lane);
  lane.agentExecutable=()=>{assert.ok(lane.resolvedApp, 'Health used unresolved browser');return actualExecutable();};
  try {
    const health=await lane.health();
    assert.equal(health.resolvedApp,app==='default'?'edge':app);
    if(app==='default')assert.ok(resolved);
    assert.equal(health.connected.length,0);
    assert.ok(!lane.agentChild, 'Health must not launch a browser');
    const picked=actualExecutable();
    assert.equal(health.agentBrowser,picked?.path??null);
    assert.equal(health.keptProfile,picked?lane.keptDir(picked):undefined);
  } finally {await lane.close();}
}
console.log('PASS cold Chrome/Edge/default health resolves selection without launch');

// #61: a page read prints the tab address in its text as well as in meta, so
// the text must hide the query and fragment of a user's own tab too. The real
// read paths over a fake CDP connection; no browser is started.
const BARE = 'https://example.test/inbox', FULL = `${BARE}?token=fixture#fragment`;
const cdp = {
  closed: false,
  send: async method => {
    if (method === 'Target.attachToTarget') return { sessionId: 'session' };
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame', loaderId: 'document' } } };
    if (method === 'Accessibility.getFullAXTree') return { nodes: [] };
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 };
    if (method === 'Runtime.evaluate') return { result: { value: FULL } };
    return {};
  }
};
const lane = new BrowserLane({ env: { WCU_BROWSER_APP: 'chrome' } });
try {
  const browser = { key: 'bfixture', name: 'fixture (user)', source: 'user', cdp };
  const own = lane.tabFor(browser, { targetId: 'OWN', title: 'fixture', url: FULL });
  const opened = lane.tabFor(browser, { targetId: 'DSH', title: 'fixture', url: FULL });
  opened.opened = true;
  const shownUrl = text => text.split('\n')[0].split(' · ').at(-1);
  for (const action of ['tree', 'snapshot']) {
    const hidden = await lane.run(action, { browserTab: own.key }, {});
    assert.equal(hidden.meta.tab.url, BARE);
    assert.equal(shownUrl(hidden.text), BARE, `${action} text must hide the query and fragment of the user's tab`);
    assert.ok(!/token=|#fragment/.test(JSON.stringify(hidden)), `${action} result must carry no query or fragment`);
    const kept = await lane.run(action, { browserTab: opened.key }, {});
    assert.equal(kept.meta.tab.url, FULL);
    assert.equal(shownUrl(kept.text), FULL, `${action} text must keep the complete address of a tab DSH opened`);
  }
  // After an action that navigated, changes() returns the whole page under the same header.
  own.last = opened.last = null;
  assert.equal(shownUrl(lane.changes(own, { lines: [] }).text), BARE);
  assert.equal(shownUrl(lane.changes(opened, { lines: [] }).text), FULL);
  assert.equal(own.url, FULL, 'The lane still compares the real address to detect navigations');
  own.url = 'chrome://settings/?search=fixture#fragment';
  await assert.rejects(lane.run('tree', { browserTab: own.key }, {}), error => /BROWSER_INTERNAL_PAGE/.test(error.message) && !/search=|#fragment/.test(error.message));
} finally {await lane.close();}
console.log('PASS user tab address hidden in meta and page text; a tab DSH opened keeps its complete address');
