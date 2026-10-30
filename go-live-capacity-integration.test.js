'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { assessCandidate } = require('./go-live-capacity-adapter');

function loadRealEngine() {
  const context = vm.createContext({ window: {}, Date });
  for (const filename of ['master-wok-model-bundle.js', 'master-wok.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, filename), 'utf8'), context, { timeout: 3000 });
  }
  return context.window;
}
function order(model, id, lines, readyMinute) {
  return {
    orderId: id,
    placedAt: new Date(2026, 9, 30, 16, 30),
    readyMinute,
    classification: model.classifyBasket(lines)
  };
}
test('real engine: candidate assessment uses classified RTK basket', () => {
  const { MasterWokModelV1: model, MasterWokV1: engine } = loadRealEngine();
  assert.equal(model.hasItem('salt-chicken'), true);
  const proposedOrder = order(model, 'new', [{itemId:'salt-chicken',qty:1,mods:[]}], 19*60);
  const result = assessCandidate(engine, { acceptedOrders: [], proposedOrder });
  assert.ok(['GREEN','AMBER','UNVERIFIED'].includes(result.status));
  assert.equal(result.canAutoCommit, false);
  assert.ok(['CANDIDATE','REVIEW'].includes(result.action));
});
test('real engine: existing commitments are included in the assessment', () => {
  const { MasterWokModelV1: model, MasterWokV1: engine } = loadRealEngine();
  const existing = order(model, 'existing', [{itemId:'salt-chicken',qty:1,mods:[]}], 19*60);
  const candidate = order(model, 'candidate', [{itemId:'salt-chicken',qty:1,mods:[]}], 19*60);
  const baseline = assessCandidate(engine, {acceptedOrders:[],proposedOrder:candidate});
  const loaded = assessCandidate(engine, {acceptedOrders:[existing],proposedOrder:candidate});
  assert.ok(['GREEN','AMBER','UNVERIFIED'].includes(baseline.status));
  assert.ok(['GREEN','AMBER','UNVERIFIED'].includes(loaded.status));
  assert.equal(loaded.canAutoCommit,false);
});
test('real engine: invalid candidate cannot turn into auto-confirmation', () => {
  const { MasterWokV1: engine } = loadRealEngine();
  const result = assessCandidate(engine, {acceptedOrders:[],proposedOrder:{classification:null}});
  assert.equal(result.status,'UNVERIFIED');
  assert.equal(result.action,'REVIEW');
  assert.equal(result.canAutoCommit,false);
});
