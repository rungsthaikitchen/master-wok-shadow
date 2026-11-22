'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','master-wok-availability.js'),'utf8');
function build(overrides={}){
 const events=[];
 const connection={query:async()=>({rows:[]}),release(){}};
 const mocks={
  './master-wok-transaction-writer':{beginBookingTransaction:async()=>{}},
  './master-wok-hint-snapshot':{beginHintSnapshot:async()=>{}},
  './master-wok-commitment-reader':{readCapacityCommitments:async()=>[]},
  './staging-order-snapshot':{normalizeStagingOrders:()=>[]},
  './staging-canonical-basket':{prepareStagingBasket:()=>({status:'PREPARED',candidate:{},rawRow:{items:[]}})},
  './master-wok-commercial':{priceBasket:()=>({items:[],subtotalCents:0})},
  './master-wok-service-plan-store':{createServicePlanStore:()=>({read:async()=>null})},
  './master-wok-clock':{localDate:()=> '2026-11-25',relativePlacement:()=>0},
  './staging-booking-integration':{londonPlacement:()=>new Date('2026-11-25T18:30:00Z')}
 };
 const module={exports:{}};
 vm.runInNewContext(source,{module,require:id=>mocks[id],console});
 const create=module.exports.createBasketAvailability;
 const handler=create({pool:{connect:overrides.connect|| (async()=>connection)},model:{},
  readAvailability:async()=>[],assessBooking:overrides.assessBooking|| (async()=>({status:'GREEN',bookingApprovalAllowed:true})),
  assertWriteAllowed:overrides.assertWriteAllowed|| (async()=>{}),
  readSnapshot:overrides.readSnapshot|| (async()=>({now:'2026-11-25T17:00:00Z',rows:[],availability:{},previousPlan:null})),
  onFailure:event=>events.push(event)});
 return {handler,events};
}
const input={times:['2026-11-25T18:30:00Z'],items:[],orderType:'collection'};
for(const [label,overrides,stage] of [
 ['connection',{connect:async()=>{throw Error('PRIVATE_DB_PASSWORD');}},'DB_CONNECT'],
 ['authority',{assertWriteAllowed:async()=>{throw Error('PRIVATE_MODE_DETAILS');}},'AUTHORITY_CHECK'],
 ['assessment',{assessBooking:async()=>{throw Error('PRIVATE_CUSTOMER_DETAILS');}},'ASSESSMENT']
]){
 test('sanitises '+label+' failure without changing public response',async()=>{
  const {handler,events}=build(overrides);
  const response=await handler(input);
  assert.equal(JSON.stringify(response),JSON.stringify({success:false,statusCode:503,reason:'AVAILABILITY_UNAVAILABLE'}));
  assert.equal(events.length,1);
  assert.equal(JSON.stringify(events[0]),JSON.stringify({operation:'availability',stage,category:'UNEXPECTED_FAILURE'}));
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_/);
 });
}
test('successful availability does not emit diagnostics',async()=>{
 const {handler,events}=build();
 const result=await handler(input);
 assert.equal(result.success,true);
 assert.equal(events.length,0);
});
test('diagnostics callback failures cannot alter availability response',async()=>{
 const {handler}=build({connect:async()=>{throw Error('DB_FAILED');}});
 const result=await handler(input);
 assert.equal(result.statusCode,503);
});
