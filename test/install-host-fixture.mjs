// CI-only isolated host installation. Never edits an existing profile.
import {mkdir,readdir,writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
const [version,directory]=process.argv.slice(2);
if(!['0.1.0-rc.6','0.1.0-rc.7','0.2.1-rc.2','0.2.2-rc.1','0.2.2-rc.3','0.2.2-rc.5'].includes(version)||!directory||!path.isAbsolute(directory))throw new Error('Pass a supported exact host version and an absolute empty fixture directory');
const existing=await readdir(directory).catch(error=>{if(error.code!=='ENOENT')throw error;return [];});
if(existing.length)throw new Error('Refusing to overwrite an existing host fixture');
const response=await fetch(`https://registry.npmjs.org/@deepseek-ai%2Fdsh/${version}`);
if(!response.ok)throw new Error('Cannot read the exact host manifest: '+response.status);
const meta=await response.json();
const overrides=Object.fromEntries(Object.entries(meta.dependencies??{}).filter(([name,range])=>name.startsWith('@deepseek-ai/')&&range.includes(version)).map(([name])=>[name,version]));
for(const name of ['dsh-tools','dsh-settings','dsh-mcp-client'])overrides['@deepseek-ai/'+name]=version;
await mkdir(directory,{recursive:true});
await writeFile(path.join(directory,'package.json'),JSON.stringify({private:true,description:'Isolated fixed-version host test fixture',dependencies:{'@deepseek-ai/dsh':version},overrides},null,2)+'\n');
const npm=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const result=spawnSync(process.execPath,[npm,'install','--prefix',directory,'--ignore-scripts','--no-audit','--no-fund'],{windowsHide:true,stdio:'inherit'});
if(result.error||result.status!==0)throw result.error??new Error('Host fixture install failed');
const require=createRequire(path.join(directory,'package.json'));
for(const name of ['dsh-tools','dsh-settings','dsh-mcp-client']){
  const installed=JSON.parse(await readFile(require.resolve('@deepseek-ai/'+name+'/package.json'),'utf8'));
  if(installed.version!==version)throw new Error('Host fixture drift: '+name+' '+installed.version);
}
console.log(JSON.stringify({passed:true,version,modules:path.join(directory,'node_modules'),exactHostPackages:true}));
