import {readFile,writeFile} from 'node:fs/promises';import {McpTestClient} from './mcp-test-client.mjs';import path from 'node:path';
const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url))).version,modes=[];
for(const mode of ['full','lite','lazy']){
 const env={...process.env,WCU_TOOL_MODE:mode,WCU_SETTINGS_JSON:'{}'};delete env.WCU_ENABLED_TOOLS;
 const client=new McpTestClient(process.execPath,[path.resolve(import.meta.dirname,'../mcp/server.mjs')],{env});
 try{const init=await client.init(),{tools}=await client.request('tools/list'),serialized=JSON.stringify({tools});modes.push({mode,tools:tools.length,utf16CodeUnits:serialized.length,utf8Bytes:Buffer.byteLength(serialized),instructionsUtf16CodeUnits:(init.instructions??'').length});}finally{client.close();}
}
const report={version,measurement:'JSON.stringify({tools: tools/list.tools}); instructions measured separately; no token estimate',modes};
if(process.argv.includes('--write'))await writeFile(new URL('../docs/tool-context-sizes.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
