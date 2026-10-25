// Exercise the actual CDP transport against task-owned TCP/HTTP fixtures.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { BrowserLane } from '../mcp/browser.mjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server => `127.0.0.1:${server.address().port}`;
const candidate = url => ({ url, source: 'configured', name: 'Transport fixture' });
function frame(opcode, data, fin = true) {
  const payload = Buffer.from(data);
  const head = Buffer.alloc(payload.length < 126 ? 2 : payload.length < 65536 ? 4 : 10);
  head[0] = (fin ? 128 : 0) | opcode;
  head[1] = head.length === 2 ? payload.length : head.length === 4 ? 126 : 127;
  if (head.length === 4) head.writeUInt16BE(payload.length, 2);
  if (head.length === 10) head.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([head, payload]);
}

// A wss endpoint must receive a TLS ClientHello, never a cleartext GET.
let firstByte;
const tlsProbe = net.createServer(socket => socket.once('data', data => { firstByte = data[0]; socket.destroy(); }));
await listen(tlsProbe);
const secureLane = new BrowserLane({ env: {} });
try {
  await assert.rejects(secureLane.connect(candidate(`wss://${address(tlsProbe)}/devtools/browser/tls`), 1500));
  assert.equal(firstByte, 0x16, 'wss must use TLS without a plaintext fallback');
} finally { await secureLane.close(); await new Promise(resolve => tlsProbe.close(resolve)); }

for (const invalid of [true, false]) {
  const sockets = new Set();
  let pong = false;
  const server = http.createServer();
  server.on('upgrade', (request, socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    // The correct hash in an unrelated header must not authenticate an upgrade.
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${invalid ? 'X-Unrelated' : 'Sec-WebSocket-Accept'}: ${accept}\r\n\r\n`);
    if (invalid) return;
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2) {
        const opcode = pending[0] & 15;
        assert.ok(pending[1] & 128, 'Client frames must be masked');
        let size = pending[1] & 127, offset = 2;
        if (size === 126) { if (pending.length < 4) return; size = pending.readUInt16BE(2); offset = 4; }
        if (size === 127) { if (pending.length < 10) return; size = Number(pending.readBigUInt64BE(2)); offset = 10; }
        if (pending.length < offset + 4 + size) return;
        const mask = pending.subarray(offset, offset + 4), payload = Buffer.from(pending.subarray(offset + 4, offset + 4 + size));
        pending = pending.subarray(offset + 4 + size);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        if (opcode === 8) { socket.end(); return; }
        if (opcode === 10) { pong = payload.toString() === 'ping'; continue; }
        const message = JSON.parse(payload.toString());
        const result = message.method === 'Browser.getVersion' ? { product: 'Fixture/1', userAgent: 'fixture' }
          : message.method === 'SystemInfo.getProcessInfo' ? { processInfo: [] }
          : message.method === 'Target.getTargets' ? { targetInfos: [{ type: 'page', targetId: 'fixture', title: '汉'.repeat(1800000), url: 'https://fixture.invalid/' }] } : {};
        const json = Buffer.from(JSON.stringify({ id: message.id, result }));
        if (message.method === 'Target.getTargets') {
          // Split UTF-8 inside a code point, interleave a ping, then continue.
          const split = json.indexOf(Buffer.from('汉')) + 1;
          const bytes = Buffer.concat([frame(1, json.subarray(0, split), false), frame(9, 'ping'), frame(0, json.subarray(split))]);
          socket.write(bytes.subarray(0, 1));
          setTimeout(() => socket.write(bytes.subarray(1)), 5);
        } else socket.write(frame(1, json));
      }
    });
  });
  await listen(server);
  const lane = new BrowserLane({ env: {} });
  try {
    const connection = lane.connect(candidate(`ws://${address(server)}/devtools/browser/fixture`), 1500);
    if (invalid) await assert.rejects(connection, /refused the WebSocket upgrade/);
    else {
      const browser = await connection;
      const tabs = await lane.pages(browser);
      assert.equal(tabs.length, 1);
      assert.equal(tabs[0].title, '汉'.repeat(1800000), 'Fragmented > 4 MiB UTF-8 message must survive intact');
      for (let i = 0; i < 20 && !pong; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(pong, 'Ping must be answered while a fragmented message is open');
    }
  } finally {
    await lane.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}
// An endpoint that closes during upgrade must fail promptly, not wait 30 s.
const eofServer = net.createServer(socket => { socket.resume(); socket.end(); });
await listen(eofServer);
const eofLane = new BrowserLane({ env: {} });
try {
  const start = Date.now();
  await assert.rejects(eofLane.connect(candidate(`ws://${address(eofServer)}/devtools/browser/eof`), 5000), /closed before/);
  assert.ok(Date.now() - start < 1500);
} finally { await eofLane.close(); await new Promise(resolve => eofServer.close(resolve)); }
console.log('PASS TLS handshake, invalid upgrade rejection, fragmented >4 MiB UTF-8, ping/pong and early EOF');
