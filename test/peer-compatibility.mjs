import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import semver from 'semver';
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url))),range=pkg.peerDependencies['@deepseek-ai/dsh-mcp-client'];
for(const version of ['0.1.0-rc.2','0.1.0-rc.6','0.1.0-rc.7','0.1.5','0.1.7','0.2.0-rc.2','0.2.1-rc.2','0.2.2-rc.1','0.2.2'])assert(semver.satisfies(version,range),'Supported bridge rejected: '+version);
for(const version of ['0.0.9','0.3.0','1.0.0'])assert(!semver.satisfies(version,range),'Unverified major/minor accepted: '+version);
assert(semver.satisfies('3.18.5',pkg.peerDependencies['@deepseek-ai/schemastery']));assert(!semver.satisfies('4.0.0',pkg.peerDependencies['@deepseek-ai/schemastery']));
const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url)));assert.deepEqual(lock.packages[''].peerDependencies,pkg.peerDependencies);assert.equal(lock.version,pkg.version);
console.log(JSON.stringify({passed:true,explicitPrereleaseSupport:true,bridgeRange:range,lockAligned:true}));
