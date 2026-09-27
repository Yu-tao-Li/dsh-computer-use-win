import { spawn } from 'node:child_process';
export class McpTestClient {
  constructor(command,args=[],options={}) {
    this.child=spawn(command,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],...options});
    this.next=1; this.pending=new Map(); this.stderr=''; this.buffer=''; this.transcript=[];
    this.child.stderr.on('data',data=>{this.stderr+=data});
    this.child.stdout.on('data',data=>{
      this.buffer+=data;
      let end;
      while((end=this.buffer.indexOf('\n'))>=0){
        const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);
        if(!line.trim())continue;
        let message;try{message=JSON.parse(line)}catch{continue}
        const wait=this.pending.get(message.id);
        if(wait){clearTimeout(wait.timer);this.pending.delete(message.id);message.error?wait.reject(new Error(JSON.stringify(message.error))):wait.resolve(message.result)}
      }
    });
    this.child.on('error',error=>this.fail(error));
    this.child.on('exit',code=>this.fail(new Error('MCP exited: '+code)));
  }
  fail(error){for(const wait of this.pending.values()){clearTimeout(wait.timer);wait.reject(error)}this.pending.clear()}
  request(method,params={},timeout=60000){
    const id=this.next++;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('MCP timeout: '+method))},timeout);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
  }
  async init(){const result=await this.request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'dsh-desktop-intake',version:'1.0.0'}});this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');return result}
  async call(name,args={}){const result=await this.request('tools/call',{name,arguments:args});this.transcript.push({at:new Date().toISOString(),name,args,result});return result}
  close(){this.child.stdin.end();this.child.kill()}
}
