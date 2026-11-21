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
  constructor({onMessage,onError,maxBytes=16*1024*1024,allowHeaders=true}) {
    this.onMessage=onMessage;this.onError=onError;this.maxBytes=maxBytes;
    this.allowHeaders=allowHeaders;
    this.mode='line';
    this.parts=[];
    this.size=0;
    this.headers=null;
    this.headerSize=0;
    this.headerPrefix=0;
    this.remaining=0;
    this.discardLine=false;
    this.decoder=new TextDecoder('utf-8',{fatal:true});
  }
  parse(body) {
    try { this.onMessage(JSON.parse(this.decoder.decode(body))); }
    catch(error) { this.onError(error); }
  }
  append(part) {
    if (part.length) { this.parts.push(part); this.size += part.length; }
  }
  take() {
    const body=this.parts.length===1 ? this.parts[0] : Buffer.concat(this.parts,this.size);
    this.parts=[];
    this.size=0;
    return body;
  }
  finishLine() {
    const line=this.take();
    if (this.headers!==null) {
      if (line.length===1 && line[0]===13) {
        const header=this.headers.join('\n');
        this.headers=null;
        this.headerSize=0;
        const lengths=[...header.matchAll(/^Content-Length:[ \t]*(\d+)[ \t]*\r$/gim)];
        const length=lengths.length===1 ? Number(lengths[0][1]) : NaN;
        if (!Number.isSafeInteger(length)||length<1||length>this.maxBytes) {
          this.onError(Error('Invalid MCP Content-Length'));
        } else { this.remaining=length; }
        return;
      }
      this.headerSize+=line.length+1;
      if (this.headerSize>MAX_HEADER_BYTES+2 || line.at(-1)!==13) {
        this.headers=null;
        this.headerSize=0;
        this.onError(Error('Invalid or oversized MCP headers'));
      } else { this.headers.push(line.toString('latin1')); }
      return;
    }
    if (line.length>this.maxBytes) {
      this.onError(Error('MCP message exceeds the size limit'));
      return;
    }
    this.mode='line';
    if (line.some(byte=>byte!==9 && byte!==13 && byte!==32)) this.parse(line);
  }
  push(chunk) {
    for (let offset=0;offset<chunk.length;) {
      if (this.remaining) {
        const count=Math.min(this.remaining,chunk.length-offset);
        this.append(chunk.subarray(offset,offset+count));
        offset+=count;
        this.remaining-=count;
        if (!this.remaining) this.parse(this.take());
        continue;
      }
      const newline=chunk.indexOf(10,offset);
      const end=newline===-1 ? chunk.length : newline;
      if (!this.discardLine) {
        if (this.allowHeaders && this.headers===null && this.headerPrefix>=0) {
          for(let index=offset;index<end;index++) {
            const byte=chunk[index];
            const letter=byte>=65&&byte<=90 || byte>=97&&byte<=122;
            if (letter || (this.headerPrefix>0 && (byte>=48&&byte<=57 || byte===45))) {
              this.headerPrefix++;
              continue;
            }
            if (byte===58 && this.headerPrefix>0) {
              this.headers=[];
              this.mode='headers';
            }
            this.headerPrefix=-1;
            break;
          }
        }
        const limit=this.headers!==null ? MAX_HEADER_BYTES+2-this.headerSize :
          this.allowHeaders && this.headerPrefix>=0 ? Math.max(this.maxBytes,MAX_HEADER_BYTES) : this.maxBytes;
        if (this.size+end-offset>limit) {
          const wasHeader=this.headers!==null;
          this.take();
          this.headers=null;
          this.headerSize=0;
          this.headerPrefix=0;
          if (wasHeader) {
            this.onError(Error('MCP headers exceed the size limit'));
            return;
          }
          this.discardLine=true;
          this.onError(Error('MCP message or headers exceed the size limit'));
        } else { this.append(chunk.subarray(offset,end)); }
      }
      if (newline===-1) break;
      offset=newline+1;
      if (this.discardLine) this.discardLine=false;
      else this.finishLine();
      if (this.headers===null) this.headerPrefix=0;
    }
  }
}
