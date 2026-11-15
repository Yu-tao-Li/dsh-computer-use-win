import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import electron from 'electron';
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-clipboard-chromium-'));
const env={...process.env,WCU_CLIPBOARD_TEST_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(electron,[path.resolve(import.meta.dirname,'clipboard-chromium-electron.cjs')],{env,encoding:'utf8',windowsHide:true,timeout:30000});
assert.ifError(result.error);assert.equal(result.status,0,result.stderr);console.log(result.stdout.trim());
