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
