// Manual live smoke test for the Remote Windows (WinRM) relay (#101).
// Requires WCU_LIVE_REMOTE_HOST and a saved credential for that target (either
// created via Configure connection in settings, or staged by a live harness).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpTestClient } from './mcp-test-client.mjs';

const remoteHost = process.env.WCU_LIVE_REMOTE_HOST?.trim();
if (!remoteHost) {
  throw new Error('Set WCU_LIVE_REMOTE_HOST (e.g. 192.168.56.10 or 127.0.0.1:55985) before running test/winrm-live.mjs.');
}

const relayPath = fileURLToPath(new URL('../mcp/hyperv-relay.mjs', import.meta.url));
const client = new McpTestClient(process.execPath, [relayPath], {
  env: {
    ...process.env,
    WCU_VM_BACKEND: 'winrm',
    WCU_REMOTE_HOST: remoteHost,
    WCU_IMAGE_MODE: 'file',
    NODE_ENV: 'test',
    WCU_TEST_NO_TAKEOVER: '1',
  },
});

try {
  await client.init();
  const listed = await client.request('tools/list', {});
  const toolNames = (listed.tools ?? []).map(tool => tool.name);
  assert.ok(toolNames.includes('windows_computer_use_list_windows'), 'tools/list must expose list_windows');

  const health = await client.call('windows_computer_use_health', {});
  assert.ok(!health.isError, `health failed: ${JSON.stringify(health)}`);

  const windows = await client.call('windows_computer_use_list_windows', {});
  assert.ok(!windows.isError, `list_windows failed: ${JSON.stringify(windows)}`);

  let screenshotPath = null;
  if (toolNames.includes('windows_computer_use_screenshot')) {
    const shot = await client.call('windows_computer_use_screenshot', {});
    assert.ok(!shot.isError, `screenshot failed: ${JSON.stringify(shot)}`);
    const payload = JSON.parse(shot.content.find(part => part.type === 'text').text);
    screenshotPath = payload.screenshot?.path ?? payload.path;
    assert.ok(screenshotPath && existsSync(screenshotPath), `Screenshot file missing on host: ${screenshotPath}`);
  }

  console.log(JSON.stringify({ passed: true, remoteHost, tools: toolNames.length, screenshotPath }));
} finally {
  client.close();
}
