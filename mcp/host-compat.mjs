// Host-version differences used by the Node adapter belong here. The browser
// client's save transports are centralized in client.js/savePatch.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const bridgePackage='@deepseek-ai/dsh-mcp-client/package.json';
const testedBridges=new Set(['0.1.0-rc.6','0.1.0-rc.7','0.2.1-rc.2','0.2.2-rc.1','0.2.2-rc.3','0.2.2-rc.5']);
export const settingsMode=service=>typeof service?.register==='function'?'namespace':'entry';
export const profileFiber=entry=>entry?.fiber?.ctx?.fiber??entry?.fiber;
export const findOwnEntry=(entries,fiber)=>entries.find(entry=>entry===fiber.entry)??entries.find(entry=>profileFiber(entry)===fiber);
export function bridgeSupport(){
  let version='unknown';
  const peerMismatches=[];
  try {
    const manifest=require(bridgePackage);
    version=manifest.version;
    const bridgeRequire=createRequire(require.resolve(bridgePackage));
    for(const [name,expected] of Object.entries(manifest.peerDependencies??{})){
      // Report only declared exact DSH versions and observed mismatches.
      if(!name.startsWith('@deepseek-ai/dsh-')||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(expected))continue;
      try {
        const actual=bridgeRequire(name+'/package.json').version;
        if(typeof actual==='string'&&actual!==expected)peerMismatches.push({name:name.slice('@deepseek-ai/'.length),expected,actual});
      } catch {}
    }
  } catch {}
  return {version,tested:testedBridges.has(version),legacyApprovalUiUnverified:/^0\.1\./.test(version),peerMismatches};
}

export function bridgeDiagnostics(bridge, connection, tools, configuredToolCount, peerMismatches){
  let status, registeredToolCount;
  try { if(connection)status=bridge.connectionStatusOf?.(connection)?.current(); } catch {}
  try {
    const schemas=tools?.schemas?.();
    if(Array.isArray(schemas))registeredToolCount=schemas.filter(tool=>tool?.name?.startsWith('mcp__wincu__')).length;
  } catch {}
  return {
    configuredToolCount, registeredToolCount,
    state:status?.state??'unavailable', bridgeToolCount:status?.toolCount,
    ...(typeof status?.reason==='string'?{reason:status.reason}:{}),
    ...(typeof status?.lastError==='string'?{lastError:status.lastError}:{}),
    ...(peerMismatches.length?{peerMismatches}:{}),
  };
}
