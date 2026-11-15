// Host-version differences used by the Node adapter belong here. The browser
// client's save transports are centralized in client.js/savePatch.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export const settingsMode=service=>typeof service?.register==='function'?'namespace':'entry';
export const profileFiber=entry=>entry?.fiber?.ctx?.fiber??entry?.fiber;
export const findOwnEntry=(entries,fiber)=>entries.find(entry=>entry===fiber.entry)??entries.find(entry=>profileFiber(entry)===fiber);
export function bridgeSupport(){
  let version='unknown';try{version=require('@deepseek-ai/dsh-mcp-client/package.json').version;}catch{}
  const tested=['0.1.0-rc.6','0.1.0-rc.7','0.2.1-rc.2','0.2.2-rc.1'].includes(version);
  return {version,tested,legacyApprovalUiUnverified:/^0\.1\./.test(version)};
}
