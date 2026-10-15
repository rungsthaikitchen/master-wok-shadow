const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ctx = { window: {}, console, Date };
vm.createContext(ctx);
for (const file of ['master-wok-model-bundle.js','master-wok.js','master-wok-shadow.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, file),'utf8'), ctx, { filename:file });
}
const model = ctx.window.MasterWokModelV1;
const replay = ctx.window.MasterWokShadowV1.replayReservationsV1;
const classification = model.classifyBasket([{itemId:'pad-thai',qty:1,mods:{}}]);
const order = (id, placedAt, readyMinute) => ({
  orderId:id, placedAt:new Date(placedAt), readyMinute, classification
});
const serviceDate='2026-10-14';
const results = replay(serviceDate, [
  order('C','2026-10-14T18:10:00',1140),
  order('A','2026-10-13T18:41:00',1050),
  order('B','2026-10-14T17:45:00',1110)
]);
assert.equal(results.reservations,3);
assert.deepEqual(Array.from(results.observations,x=>x.orderId),['A','B','C']);
assert.equal(results.observations[0].asOfMinute,990);
assert.equal(results.observations[0].status,'GREEN');
assert.equal(results.observations[1].status,'GREEN');
assert.equal(results.observations[2].status,'GREEN');
assert.equal(results.verified,false);
console.log('PASS: advance booking and chronological protected commitments');
const impossible = replay(serviceDate,[
  order('A','2026-10-14T18:00:00',1110),
  order('B','2026-10-14T18:00:00',1110),
  order('C','2026-10-14T18:00:00',1110),
  order('D','2026-10-14T18:00:00',1110)
]);
assert.ok(impossible.observations.some(x=>x.status==='AMBER'));
assert.equal(impossible.observations.at(-1).status,'UNVERIFIED');
console.log('PASS: unplannable historical acceptance does not fabricate a plan');
const invalid = replay(serviceDate,[order('LATE','2026-10-15T18:00:00',1110)]);
assert.equal(invalid.status,'UNVERIFIED');
assert.match(invalid.reason,/post-service/);
console.log('PASS: post-service order rejected');
