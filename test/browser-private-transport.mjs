import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {execFileSync} from 'node:child_process';
import {mkdtemp,stat} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {BrowserPipe} from '../mcp/browser-pipe.mjs';
import {BrowserLane} from '../mcp/browser.mjs';
import {setTimeout as delay} from 'node:timers/promises';
const fake=new EventEmitter();fake.stdio=[null,null,null,new PassThrough(),new PassThrough()];
const wire=new BrowserPipe(fake,{maxBytes:100}),messages=[];wire.onmessage=text=>messages.push(text);
const unicode=Buffer.from('{"text":"中文😀"}\0{"next":true}\0');
for(const byte of unicode)wire.receive(Buffer.from([byte]));
assert.deepEqual(messages,['{"text":"中文😀"}','{"next":true}']);
wire.receive(Buffer.alloc(101,65));assert.equal(wire.closed,true,'Oversized unterminated frames must close');
// A timeout wins the race, then closing the pipe rejects work that was already
// waiting on a response. The late rejection must not terminate the MCP server.
{
  const lane = new BrowserLane({ env: {} });
  const socket = {
    listeners: new Set(),
    send: () => delay(60).then(() => { throw new Error('pipe closed after timeout'); }),
  };
  await assert.rejects(lane.connect({ url: 'pipe://slow-fixture', source: 'agent', isolated: true, cdp: socket }, 10), /BROWSER_TIMEOUT/);
  await delay(70);
  assert.equal(lane.browsers.size, 0);
  await lane.shutdown();
}
const root=await mkdtemp(path.join(os.tmpdir(),'wcu-browser-private-')),results=[];
for(const app of ['edge','chrome']){
  const lane=new BrowserLane({env:{...process.env,WCU_BROWSER_APP:app,WCU_BROWSER_PROFILE:path.join(root,app),WCU_BROWSER_HEADLESS:'1',WCU_BROWSER_SIGNIN:'0'}});
  try{
    const result=await lane.run('set_value',{elementId:'new-tab',value:'data:text/html,<title>Private transport fixture</title><button>Pipe button</button>'},{});
    assert.match(result.text,/Pipe button/);
    const browser=[...lane.browsers.values()].find(item=>item.source==='agent');
    assert.match(browser.url,/^pipe:\/\//);
    assert(browser.child.spawnargs.includes('--remote-debugging-pipe'));
    const profile=browser.child.spawnargs.find(arg=>arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    const portFiles=await stat(path.join(profile,'DevToolsActivePort')).then(()=>1,()=>0);assert.equal(portFiles,0);
    const table=execFileSync(path.join(process.env.SystemRoot,'System32','netstat.exe'),['-ano','-p','tcp'],{encoding:'utf8',windowsHide:true});
    const listeners=table.split(/\r?\n/).filter(line=>{const fields=line.trim().split(/\s+/);return fields.at(-1)===String(browser.pid)&&fields.some(field=>field==='LISTENING')});
    assert.equal(listeners.length,0,'The private browser process must not expose a TCP listener');
    results.push({app,pipe:true,tcpListeners:0,readVerified:true});
  }finally{await lane.shutdown();}
}
console.log(JSON.stringify({passed:true,splitUtf8Messages:true,sizeLimit:true,results,root}));
