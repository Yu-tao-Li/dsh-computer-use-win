// Chromium's inherited DevTools pipe uses NUL-terminated UTF-8 JSON. No TCP
// listener is created, so other local processes cannot discover a debug port.
export class BrowserPipe {
  constructor(child,{maxBytes=64*1024*1024}={}){
    this.writer=child.stdio[3];this.reader=child.stdio[4];
    this.parts=[];this.bytes=0;this.closed=false;this.maxBytes=maxBytes;
    this.reader.on('data',chunk=>this.receive(chunk));
    this.reader.on('end',()=>this.close());this.reader.on('error',()=>this.close());
    this.writer.on('error',()=>this.close());child.once('exit',()=>this.close());child.once('error',()=>this.close());
  }
  receive(chunk){
    if(this.closed)return;
    let start=0;
    for(;;){
      const end=chunk.indexOf(0,start),part=chunk.subarray(start,end<0?chunk.length:end);
      this.bytes+=part.length;
      if(this.bytes>this.maxBytes){this.close();return;}
      if(part.length)this.parts.push(part);
      if(end<0)return;
      const text=Buffer.concat(this.parts,this.bytes).toString('utf8');this.parts=[];this.bytes=0;
      if(text)this.onmessage?.(text);
      if(this.closed)return;
      start=end+1;if(start===chunk.length)return;
    }
  }
  send(text){if(this.closed)throw new Error('BROWSER_DISCONNECTED: DevTools pipe closed');this.writer.write(text+'\0','utf8');}
  close(){if(this.closed)return;this.closed=true;this.writer.destroy();this.reader.destroy();this.parts=[];this.bytes=0;this.onclose?.();}
}
