// JSON-RPC framing and version negotiation; no backend or host dependencies.
export const BACKEND_PROTOCOL_VERSION = 1;
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([
  '2024-11-05','2025-03-26','2025-06-18'
]);
export function negotiateProtocolVersion(requested) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested : SUPPORTED_PROTOCOL_VERSIONS.at(-1);
}
export function validateRpcEnvelope(message) {
  if(!message||typeof message!=='object'||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string')return false;
  if(Object.hasOwn(message,'id')&&!(typeof message.id==='string'||typeof message.id==='number'&&Number.isFinite(message.id)))return false;
  return true;
}

const MAX_HEADER_BYTES = 8192;

export class RpcFramer {
  constructor({onMessage,onError,maxBytes=16*1024*1024}) {
    this.onMessage=onMessage;this.onError=onError;this.maxBytes=maxBytes;
    this.buffer=Buffer.alloc(0);this.mode='line';
    this.decoder=new TextDecoder('utf-8',{fatal:true});
  }
  parse(body) {
    try { this.onMessage(JSON.parse(this.decoder.decode(body))); }
    catch(error) { this.onError(error); }
  }
  push(chunk) {
    this.buffer=Buffer.concat([this.buffer,chunk]);
    while(this.buffer.length){
      if(this.buffer.length>this.maxBytes){this.buffer=Buffer.alloc(0);this.onError(Error('MCP message exceeds the size limit'));return;}
      const head=this.buffer.subarray(0,Math.min(this.buffer.length,MAX_HEADER_BYTES)).toString('latin1');
      if(/^[A-Za-z][A-Za-z0-9-]*:/.test(head)){
        this.mode='headers';
        const end=this.buffer.indexOf('\r\n\r\n');
        if(end<0){
          if(this.buffer.length>MAX_HEADER_BYTES){this.buffer=Buffer.alloc(0);this.onError(Error('MCP headers exceed the size limit'));}
          return;
        }
        if(end>MAX_HEADER_BYTES){this.buffer=Buffer.alloc(0);this.onError(Error('MCP headers exceed the size limit'));return;}
        const header=this.buffer.subarray(0,end).toString('ascii');
        const match=/^Content-Length:\s*(\d+)\s*$/im.exec(header);
        const length=match?Number(match[1]):NaN;
        if(!Number.isSafeInteger(length)||length<1||length>this.maxBytes){
          this.buffer=Buffer.alloc(0);this.onError(Error('Invalid MCP Content-Length'));return;
        }
        const start=end+4;if(this.buffer.length<start+length)return;
        const body=this.buffer.subarray(start,start+length);
        this.buffer=this.buffer.subarray(start+length);this.parse(body);continue;
      }
      const newline=this.buffer.indexOf(10);if(newline<0)return;
      const body=this.buffer.subarray(0,newline);
      this.buffer=this.buffer.subarray(newline+1);
      if(body.toString('ascii').trim())this.parse(body);
    }
  }
}
