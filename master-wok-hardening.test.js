'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createLiveShadowObserver } = require('./master-wok-live-shadow');
const { createRecordStore,summarize } = require('./master-wok-record-store');
const { createReplayAssessment } = require('./master-wok-server-adapter');
const event = { eventKey:'decision_000002',serviceDate:'2026-10-14',outcome:'ACCEPTED',
  requestedMinute:1080,decidedMinute:1085,decisionAt:'2026-10-14T15:00:00Z',snapshot:{secret:'never-store'} };
const good = () => ({status:'GREEN',reasonCode:'HYPOTHETICAL_REPLAY'});

test('only explicit boolean true enables observer; null event isolated',async () => {
  let calls=0;
  const options={assess:()=>{calls++;},persist:()=>{calls++;}};
  assert.equal((await createLiveShadowObserver({...options,enabled:'false'}).observe(event)).reason,'DISABLED');
  assert.equal((await createLiveShadowObserver({...options,enabled:true}).observe(null)).reason,'INVALID_EVENT');
  assert.equal(calls,0);
});
test('throwing logger cannot reject observer',async () => {
  const observer=createLiveShadowObserver({enabled:true,assess:good,persist:()=>{throw Error();},logger:()=>{throw Error();}});
  assert.equal((await observer.observe(event)).reason,'PERSIST_FAILED');
  assert.equal((await observer.observe({})).reason,'INVALID_EVENT');
});
test('stalled assessment persists uncertainty with bounded wait',async () => {
  let saved;
  const observer=createLiveShadowObserver({enabled:true,timeoutMs:10,assess:()=>new Promise(()=>{}),persist:r=>{saved=r;}});
  assert.equal((await observer.observe(event)).prediction,'UNVERIFIED');
  assert.equal(saved.reasonCode,'ASSESSMENT_ERROR');
});
test('stalled persistence returns without changing decision',async () => {
  const observer=createLiveShadowObserver({enabled:true,timeoutMs:10,assess:good,persist:()=>new Promise(()=>{})});
  assert.equal((await observer.observe(event)).reason,'PERSIST_FAILED');
});
test('assessment receives a private snapshot copy',async () => {
  const observer=createLiveShadowObserver({enabled:true,assess:({snapshot})=>{snapshot.secret='changed';return good();},persist:()=>{}});
  await observer.observe(event);
  assert.equal(event.snapshot.secret,'never-store');
});
test('durable store survives reopen, deduplicates concurrent retries and refuses conflicts',async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mw-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const store=await createRecordStore(dir);
  const observer=createLiveShadowObserver({enabled:true,assess:good,persist:store.persist});
  const results=await Promise.all(Array.from({length:12},()=>observer.observe(event)));
  assert.ok(results.every(r=>r.observed));
  const reopened=await createRecordStore(dir);
  const records=await reopened.readAll();
  assert.equal(records.length,1);
  assert.equal(records[0].decidedMinute-records[0].requestedMinute,5);
  assert.equal(JSON.stringify(records).includes('never-store'),false);
  await assert.rejects(reopened.persist({...records[0],prediction:'AMBER'}),/CONFLICT/);
  await assert.rejects(reopened.persist({...records[0],email:'private'}),/INVALID/);
  assert.equal(summarize(records).matrix['2026-10-14/GREEN/ACCEPTED'],1);
});
test('corrupt record is detected, never silently omitted',async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mw-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const store=await createRecordStore(dir);
  await fs.writeFile(path.join(dir,'a'.repeat(64)+'.json'),'bad');
  await assert.rejects(store.readAll());
});
test('server adapter requires decision history, rejects invalid menu data and isolates engine',() => {
  const assess=createReplayAssessment();
  const snapshot={complete:true,basis:'PRE_DECISION_HISTORY',decisionAt:'2026-10-14T15:00:00Z',reservations:[],
    proposed:{orderId:'candidate',readyMinute:1080,lines:[{itemId:'pad-thai',qty:1,mods:[]}]}};
  const result=assess({serviceDate:event.serviceDate,snapshot});
  if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Europe/London') {
    assert.equal(result.status,'GREEN');
    assert.equal(assess({serviceDate:event.serviceDate,snapshot:{...snapshot,complete:false}}).status,'UNVERIFIED');
    assert.equal(assess({serviceDate:event.serviceDate,snapshot:{...snapshot,proposed:{...snapshot.proposed,lines:[{itemId:'unknown',qty:1}]}}}).status,'UNVERIFIED');
  } else assert.equal(result.reasonCode,'SERVICE_TIMEZONE_REQUIRED');
});
test('replay rejects malformed dates, null rows, duplicate IDs and times outside production day',async () => {
  const context=vm.createContext({window:{},Date});
  for(const file of ['master-wok-model-bundle.js','master-wok.js','master-wok-shadow.js']) vm.runInContext(await fs.readFile(path.join(__dirname,file),'utf8'),context);
  const replay=context.window.MasterWokShadowV1.replayReservationsV1;
  assert.match(replay('2026-02-30',[]).reason,/Invalid service date/);
  assert.equal(replay(event.serviceDate,[null]).observations.length,0);
  const classification=context.window.MasterWokModelV1.classifyBasket([{itemId:'pad-thai',qty:1}]);
  const row={orderId:'x',placedAt:new Date('2026-10-13T15:00:00Z'),readyMinute:1080,classification};
  assert.equal(replay(event.serviceDate,[row,row]).observations.length,0);
  assert.equal(replay(event.serviceDate,[{...row,readyMinute:1321}]).observations.length,0);
  assert.equal(replay(event.serviceDate,[{...row,readyMinute:980}]).observations.length,0);
});
test('throwing event properties and asynchronous logger failures are isolated',async () => {
 const observer=createLiveShadowObserver({enabled:true,assess:good,persist:()=>{throw Error();},logger:async()=>{throw Error();}});
 const evil={get eventKey(){throw Error();}};
 assert.equal((await observer.observe(evil)).reason,'INVALID_EVENT');
 assert.equal((await observer.observe(event)).reason,'PERSIST_FAILED');
});
test('hypothetical jobs crossing decision time remain blocked, without claiming actual activity',async()=>{
 const calls=[];
 const context=vm.createContext({window:{},Date});
 vm.runInContext(await fs.readFile(path.join(__dirname,'master-wok-shadow.js'),'utf8'),context);
 context.window.MasterWokModelV1={calculateCombinedKitchenPressure:()=>({productionWindow:{rawMinutes:10}})};
 context.window.MasterWokV1={config:{kitchenStartMinute:990},schedule:(orders,options)=>{
   calls.push({orders,options});
   return {feasible:true,exhausted:false,timeline:orders.map(row=>({id:row.orderId,start:1060,finish:1070}))};
 }};
 const result=context.window.MasterWokShadowV1.replayReservationsV1('2026-10-14',[
   {orderId:'A',placedAt:new Date('2026-10-14T16:00:00'),readyMinute:1080,classification:{}},
   {orderId:'B',placedAt:new Date('2026-10-14T17:45:00'),readyMinute:1100,classification:{}}
 ]);
 assert.equal(calls[2].options.blockedIntervals[0].start,1060);
 assert.equal(calls[2].orders.length,1);
 assert.equal(calls[2].orders[0].orderId,'B');
 assert.equal(result.evidenceBasis,'HYPOTHETICAL_PLANS_NOT_COOKING_ACTIVITY');
 assert.equal(result.verified,false);
});
test('chronological replay deterministic across shuffled input',async()=>{
 const context=vm.createContext({window:{},Date});
 for(const file of ['master-wok-model-bundle.js','master-wok.js','master-wok-shadow.js']) vm.runInContext(await fs.readFile(path.join(__dirname,file),'utf8'),context);
 const classification=context.window.MasterWokModelV1.classifyBasket([{itemId:'pad-thai',qty:1}]);
 const rows=Array.from({length:10},(_,i)=>({orderId:String(i),placedAt:new Date('2026-10-13T10:'+String(i).padStart(2,'0')+':00'),readyMinute:1030+i*20,classification}));
 const replay=context.window.MasterWokShadowV1.replayReservationsV1;
 assert.equal(JSON.stringify(replay('2026-10-14',rows)),JSON.stringify(replay('2026-10-14',[...rows].reverse())));
});
