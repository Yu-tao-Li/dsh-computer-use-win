// Pluggable VM backend registry and Hyper-V pre-check route (#101).
// Read-only probe only; never touches or starts any virtual machine.
import assert from 'node:assert/strict';
import { createHypervSetupHandler } from '../mcp/hyperv-relay.mjs';
import { hypervBackend, vmBackend, VM_BACKENDS } from '../mcp/vm-backends.mjs';

assert.equal(vmBackend('hyperv'), hypervBackend);
assert.equal(vmBackend(), hypervBackend);
assert.equal(VM_BACKENDS.hyperv, hypervBackend);
assert.equal(hypervBackend.id, 'hyperv');
assert.equal(typeof hypervBackend.start, 'function');
assert.equal(typeof hypervBackend.configure, 'function');
assert.equal(typeof hypervBackend.probe, 'function');
assert.deepEqual(hypervBackend.capabilities, {
  isolatedDesktop: true,
  needsSignedInDesktop: true,
  guestNodeMajor: 22,
});
assert.throws(() => vmBackend('vmware'), /WCU_VM_BACKEND_UNKNOWN/);

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
const handler = createHypervSetupHandler({
  settings: () => ({ hypervVm: '' }),
  probe: async () => { probeCalls++; return probeResult; },
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

if (process.platform === 'win32') {
  const liveProbe = await hypervBackend.probe();
  assert.equal(liveProbe.ok, true);
  assert.equal(liveProbe.backend, 'hyperv');
  assert.equal(typeof liveProbe.available, 'boolean');
}

console.log(JSON.stringify({ passed: true, interface: true, routeProbe: true, platformProbe: process.platform === 'win32' }));
