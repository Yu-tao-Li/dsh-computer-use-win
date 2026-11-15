import assert from 'node:assert/strict';import {settingsMode,profileFiber,findOwnEntry,bridgeSupport} from '../mcp/host-compat.mjs';
const fiber={},legacy={fiber},modern={fiber:{ctx:{fiber}}},other={fiber:{}};
assert.equal(settingsMode({register(){}}),'namespace');assert.equal(settingsMode({configure(){}}),'entry');
assert.equal(profileFiber(legacy),fiber);assert.equal(profileFiber(modern),fiber);
assert.equal(findOwnEntry([other,legacy],fiber),legacy);assert.equal(findOwnEntry([other,modern],fiber),modern);
fiber.entry=other;assert.equal(findOwnEntry([legacy,other],fiber),other);
const support=bridgeSupport();assert.equal(typeof support.version,'string');assert.equal(typeof support.tested,'boolean');
console.log(JSON.stringify({passed:true,legacyAndModernEntryOwnership:true,settingsInterfacesCentralized:true}));
