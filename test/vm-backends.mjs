// Pluggable VM backend registry, WinRM address parsing, and setup route (#101).
// Read-only probe only; never touches or starts any virtual machine.
import assert from 'node:assert/strict';
import { createHypervSetupHandler } from '../mcp/hyperv-relay.mjs';
import { hypervBackend, winrmBackend, parseRemoteHost, vmBackend, VM_BACKENDS } from '../mcp/vm-backends.mjs';

assert.equal(vmBackend('hyperv'), hypervBackend);
assert.equal(vmBackend('winrm'), winrmBackend);
assert.equal(vmBackend(), hypervBackend);
assert.equal(VM_BACKENDS.hyperv, hypervBackend);
assert.equal(VM_BACKENDS.winrm, winrmBackend);

for (const [backend, id] of [[hypervBackend, 'hyperv'], [winrmBackend, 'winrm']]) {
  assert.equal(backend.id, id);
  assert.equal(typeof backend.start, 'function');
  assert.equal(typeof backend.configure, 'function');
  assert.equal(typeof backend.probe, 'function');
  assert.equal(backend.capabilities.isolatedDesktop, true);
  assert.equal(backend.capabilities.needsSignedInDesktop, true);
  assert.equal(backend.capabilities.guestNodeMajor, 22);
}
assert.equal(winrmBackend.capabilities.network, true);
assert.throws(() => vmBackend('vmware'), /WCU_VM_BACKEND_UNKNOWN/);

assert.deepEqual(parseRemoteHost('192.168.56.10'), { host: '192.168.56.10', port: 5985 });
assert.deepEqual(parseRemoteHost('vm-01:5986'), { host: 'vm-01', port: 5986 });
assert.deepEqual(parseRemoteHost('[fe80::1]:5985'), { host: 'fe80::1', port: 5985 });
assert.deepEqual(parseRemoteHost('win11.local'), { host: 'win11.local', port: 5985 });
for (const bad of ['', '-x', 'a b', 'host:0', 'host:70000', 'a\nb']) {
  assert.throws(() => parseRemoteHost(bad), /WCU_REMOTE_HOST_REQUIRED/, `Expected reject for ${JSON.stringify(bad)}`);
}

const trustedHeaders = {
  host: '127.0.0.1:43120',
  origin: 'http://127.0.0.1:43120',
  'x-wcu-request': '1',
  'sec-fetch-site': 'same-origin',
};
const makeResponse = () => {
  const res = { status: 0, headers: {}, body: '' };
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers ?? {}; };
  res.end = body => { res.body = body ?? ''; };
  return res;
};

let probeCalls = 0;
const probeResult = { ok: true, backend: 'hyperv', available: false, reason: 'home-edition', edition: 'CoreCountrySpecific' };
let currentSettings = { hypervVm: '', vmBackend: 'hyperv', remoteHost: '' };
const setupCalls = [];
const handler = createHypervSetupHandler({
  settings: () => currentSettings,
  probe: async () => { probeCalls++; return probeResult; },
  setup: async (target, backendId) => { setupCalls.push([target, backendId]); return { ok: true, missing: null }; },
});

let res = makeResponse();
await handler({ method: 'GET', headers: trustedHeaders }, res);
assert.equal(res.status, 200);
assert.deepEqual(JSON.parse(res.body), probeResult);
assert.equal(probeCalls, 1);

res = makeResponse();
await handler({ method: 'GET', headers: { ...trustedHeaders, 'x-wcu-request': undefined } }, res);
assert.equal(res.status, 403);
assert.equal(probeCalls, 1);

res = makeResponse();
await handler({ method: 'PUT', headers: trustedHeaders }, res);
assert.equal(res.status, 405);

currentSettings = { vmBackend: 'winrm', remoteHost: '', hypervVm: '' };
res = makeResponse();
await handler({ method: 'POST', headers: trustedHeaders }, res);
assert.equal(res.status, 400);
assert.equal(JSON.parse(res.body).error, 'WCU_REMOTE_HOST_REQUIRED');

currentSettings = { vmBackend: 'winrm', remoteHost: '10.0.0.5', hypervVm: '' };
res = makeResponse();
await handler({ method: 'POST', headers: trustedHeaders }, res);
assert.equal(res.status, 200);
assert.deepEqual(setupCalls.at(-1), ['10.0.0.5', 'winrm']);

currentSettings = { vmBackend: 'hyperv', hypervVm: 'Win11VM', remoteHost: '' };
res = makeResponse();
await handler({ method: 'POST', headers: trustedHeaders }, res);
assert.equal(res.status, 200);
assert.deepEqual(setupCalls.at(-1), ['Win11VM', 'hyperv']);

if (process.platform === 'win32') {
  const liveProbe = await hypervBackend.probe();
  assert.equal(liveProbe.ok, true);
  assert.equal(liveProbe.backend, 'hyperv');
  assert.equal(typeof liveProbe.available, 'boolean');
  const winrmProbe = await winrmBackend.probe();
  assert.deepEqual(winrmProbe, { ok: true, backend: 'winrm', available: true, reason: null });
}

console.log(JSON.stringify({ passed: true, interface: true, parseRemoteHost: true, routeProbe: true, routeSetup: true, platformProbe: process.platform === 'win32' }));
