'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {replay}=require('./master-wok-chronological-replay');
const at=m=>`2026-10-17T${m}:00Z`;
const basket=[{itemId:'panang-curry',qty:1,mods:[{id:'chicken'}]}];
const order=(orderId,target='18:00',extra={})=>({orderId,orderType:'collection',targetAt:at(target),lines:structuredClone(basket),deliveryReadyEstimate:null,...extra});
const decision=(sequence,id,time,actualDecision='ACCEPTED')=>({eventId:'e'+sequence,sequence,at:at(time),kind:'BOOKING_DECISION',actualDecision,order:order(id)});
const reserve=(sequence,id,time,target,commitment='CONFIRMED')=>({eventId:'e'+sequence,sequence,at:at(time),kind:'RESERVATION_SET',commitment,order:order(id,target)});
const release=(sequence,id,time,reason='COMPLETED')=>({eventId:'e'+sequence,sequence,at:at(time),kind:'RESERVATION_RELEASED',orderId:id,reason});
const input=events=>({serviceDate:'2026-10-17',coverage:{basis:'DECISION_EVENT_LOG',complete:true,eventCount:events.length,firstSequence:1,lastSequence:events.length,initialState:'NO_PRIOR_SERVICE_COMMITMENTS',throughAt:'2026-10-17T22:00:00Z'},events});
const green=()=>({status:'GREEN',reasonCode:'HYPOTHETICAL_REPLAY'});

test('all decisions use only then-known commitments; later reschedules never leak backwards',()=>{
 const source=input([decision(1,'a','15:00'),decision(2,'b','15:10'),reserve(3,'a','15:20','19:00'),decision(4,'c','15:30'),
  release(5,'b','15:40','CANCELLED'),decision(6,'d','15:50','DECLINED'),decision(7,'e','16:00','SUGGESTED'),decision(8,'f','16:10')]);
 const untouched=structuredClone(source),seen=[];
 const result=replay(source,{enabled:true,assess:args=>(seen.push(structuredClone(args)),green())});
 assert.equal(result.status,'REPLAYED');assert.equal(result.decisionCount,6);
 assert.deepEqual(result.observations.map(x=>x.priorCommitments),[0,1,2,2,2,3]);
 assert.equal(seen[1].snapshot.reservations.find(r=>r.orderId==='a').readyMinute,1140); //18:00 UTC =19:00 BST
 assert.equal(seen[2].snapshot.reservations.find(r=>r.orderId==='a').readyMinute,1200); //19:00 UTC =20:00 BST
 assert.equal(seen.at(-1).snapshot.reservations.some(r=>r.orderId==='d'),false);
 assert.equal(result.observations.at(-1).priorProposed,1);
 assert.deepEqual(source,untouched);assert.equal(result.verified,false);assert.equal(result.networkRequests,0);
});
test('recorded acceptance remains active even when the hypothetical model says AMBER',()=>{
 const seen=[];
 const result=replay(input([decision(1,'a','15:00'),decision(2,'b','15:10')]),{enabled:true,
  assess:x=>(seen.push(x),{status:'AMBER',reasonCode:'HYPOTHETICAL_REPLAY'})});
 assert.equal(result.observations[0].actualDecision,'ACCEPTED');assert.equal(result.observations[0].prediction,'AMBER');
 assert.equal(seen[1].snapshot.reservations[0].orderId,'a');
});
test('explicit proposed reservations block other decisions; a replacement has no self-conflict',()=>{
 const seen=[];
 const result=replay(input([reserve(1,'a','15:00','19:00','PROPOSED'),decision(2,'b','15:10'),decision(3,'a','15:20')]),
  {enabled:true,assess:x=>(seen.push(x),green())});
 assert.equal(result.observations[0].priorProposed,1);
 assert.equal(seen[1].snapshot.reservations.some(r=>r.orderId==='a'),false);
});
test('delivery arrival is never substituted for food-ready time; missing and stale estimates refuse',()=>{
 const delivery=decision(1,'a','15:00');delivery.order=order('a','18:00',{orderType:'delivery'});
 const result=replay(input([delivery,decision(2,'b','15:10')]),{enabled:true,assess:()=>assert.fail('missing delivery estimate')});
 assert.deepEqual(result.observations.map(x=>x.prediction),['UNVERIFIED','UNVERIFIED']);
 assert.equal(result.observations[0].kitchenReadyMinute,null);
 delivery.order.deliveryReadyEstimate={foodReadyAt:at('17:45'),estimatedAt:at('14:50'),basis:'DELIVERY_PLANNER_ESTIMATE'};
 const seen=[];const prepared=replay(input([delivery,decision(2,'b','15:30')]),{enabled:true,assess:x=>(seen.push(x),green())});
 assert.equal(seen[0].snapshot.proposed.readyMinute,1125); //17:45 UTC =18:45 BST
 assert.equal(prepared.observations[1].prediction,'UNVERIFIED');
});
test('timed completion removes only explicitly released commitments',()=>{
 const result=replay(input([decision(1,'a','15:00'),release(2,'a','15:30'),decision(3,'b','15:40')]),{enabled:true,assess:green});
 assert.equal(result.observations[1].priorCommitments,0);
 assert.equal(result.remainingCommitments,1);
});
test('complete sequence is deterministic across input order; missing/duplicate/backdated events reject before assessment',()=>{
 const source=input([decision(1,'a','15:00'),decision(2,'b','15:10')]);
 assert.deepEqual(replay(source,{enabled:true,assess:green}),replay({...source,events:[...source.events].reverse()},{enabled:true,assess:green}));
 for(const mutate of [x=>x.coverage.complete=false,x=>x.coverage.basis='CURRENT_SAVED_STATE',x=>x.events[1].sequence=3,
  x=>x.events[1].eventId='e1',x=>x.events[1].at=at('14:59'),x=>x.events[1].order.targetAt='2026-02-30T18:00:00Z',
  x=>x.events[1].order.lines[0].qty=0,x=>x.events[1].privateAddress='PRIVATE']){
  const bad=structuredClone(source);mutate(bad);
  const result=replay(bad,{enabled:true,assess:()=>assert.fail('invalid input assessed')});
  assert.equal(result.status,'UNVERIFIED');assert.deepEqual(result.observations,[]);
 }
});
test('same-clock backend order does not fabricate subsecond placement for current kitchen adapter',()=>{
 const result=replay(input([decision(1,'a','15:00'),decision(2,'b','15:00')]),{enabled:true,assess:green});
 assert.equal(result.observations[1].reasonCode,'ASSESSMENT_CLOCK_TIE_UNSUPPORTED');
});
test('default off and elapsed time limit prevent accidental expensive replay',()=>{
 assert.equal(replay(null,{assess:()=>assert.fail('disabled')}).status,'DISABLED');
 let now=0;
 const result=replay(input([decision(1,'a','15:00'),decision(2,'b','15:10')]),{enabled:true,maxElapsedMs:1,clock:()=>now++,assess:green});
 assert.equal(result.reasonCode,'REPLAY_TIME_BUDGET_EXHAUSTED');assert.deepEqual(result.observations,[]);
});
test('real kitchen engine handles the chronological event stream in London, independently of parent timezone',()=>{
 const source=input([decision(1,'a','15:00'),reserve(2,'a','15:10','18:30'),decision(3,'b','15:20'),release(4,'a','15:30','CANCELLED'),decision(5,'c','15:40')]);
 const script="let text='';process.stdin.on('data',x=>text+=x);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(require('./master-wok-chronological-replay').replay(JSON.parse(text),{enabled:true}))));";
 const child=spawnSync(process.execPath,['-e',script],{cwd:__dirname,input:JSON.stringify(source),encoding:'utf8',env:{PATH:process.env.PATH,TZ:'Europe/London'},timeout:20000});
 assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);
 assert.equal(result.status,'REPLAYED');assert.equal(result.decisionCount,3);
 assert.equal(result.observations.every(x=>x.prediction==='GREEN'),true);
 assert.equal(result.evidenceBasis,'RECORDED_EVENTS_WITH_HYPOTHETICAL_KITCHEN_ASSESSMENTS');
});
test('assessor cannot mutate later reservations or leak private failure details',()=>{
 let calls=0;
 const result=replay(input([decision(1,'a','15:00'),decision(2,'b','15:10'),decision(3,'c','15:20')]),{enabled:true,assess:x=>{
  calls++;if(calls===2)x.snapshot.reservations[0].lines[0].qty=99;
  if(calls===3)assert.equal(x.snapshot.reservations[0].lines[0].qty,1);
  return green();
 }});
 assert.equal(result.status,'REPLAYED');assert.equal(calls,3);
 const failure=replay(input([decision(1,'a','15:00')]),{enabled:true,assess:()=>{throw Error('PRIVATE_CUSTOMER_ADDRESS');}});
 assert.equal(failure.status,'UNVERIFIED');assert.equal(JSON.stringify(failure).includes('PRIVATE_CUSTOMER_ADDRESS'),false);
});
test('delivery food transit has an inclusive twenty-minute cap and rejects future estimate evidence',()=>{
 for(const [foodReadyAt,expected] of [[at('17:40'),'GREEN'],['2026-10-17T17:39:59Z','UNVERIFIED']]){
  const d=decision(1,'a','15:00');d.order=order('a','18:00',{orderType:'delivery',deliveryReadyEstimate:{foodReadyAt,estimatedAt:at('14:59'),basis:'DELIVERY_PLANNER_ESTIMATE'}});
  assert.equal(replay(input([d]),{enabled:true,assess:green}).observations[0].prediction,expected);
 }
 const d=decision(1,'a','15:00');d.order=order('a','18:00',{orderType:'delivery',deliveryReadyEstimate:{foodReadyAt:at('17:45'),estimatedAt:at('15:01'),basis:'DELIVERY_PLANNER_ESTIMATE'}});
 assert.equal(replay(input([d]),{enabled:true,assess:()=>assert.fail('future evidence')}).reasonCode,'DELIVERY_ESTIMATE_CONTRACT_REQUIRED');
});
test('a new suggestion cannot erase an existing confirmed time before customer confirmation',()=>{
 const seen=[];
 const source=input([reserve(1,'a','15:00','18:00'),reserve(2,'a','15:05','19:00','PROPOSED'),
  decision(3,'b','15:10'),reserve(4,'a','15:15','19:00','CONFIRMED'),decision(5,'c','15:20')]);
 const result=replay(source,{enabled:true,assess:x=>(seen.push(x),green())});
 assert.equal(result.status,'REPLAYED');
 assert.equal(seen[0].snapshot.reservations[0].readyMinute,1140);
 assert.equal(seen[1].snapshot.reservations.find(r=>r.orderId==='a').readyMinute,1200);
 assert.equal(result.observations[0].priorProposed,0);
});
test('CLI stays disabled by default and replays the full anonymous service fixture when enabled',()=>{
 const cli=require('node:path').join(__dirname,'master-wok-chronological-replay.js');
 const disabled=spawnSync(process.execPath,[cli],{encoding:'utf8',env:{PATH:process.env.PATH,TZ:'Europe/London'},timeout:5000});
 assert.equal(JSON.parse(disabled.stdout).status,'DISABLED');
 const fixture=require('./fixtures/chronological-synthetic-service.json');
 const enabled=spawnSync(process.execPath,[cli],{input:JSON.stringify(fixture),encoding:'utf8',env:{PATH:process.env.PATH,TZ:'Europe/London',MASTER_WOK_EVENT_REPLAY_ENABLED:'true'},timeout:20000});
 assert.equal(enabled.status,0,enabled.stderr);const r=JSON.parse(enabled.stdout);
 assert.equal(r.decisionCount,5);assert.equal(r.observations.length,5);
 assert.equal(r.observations.find(o=>o.orderId==='synthetic-d').reasonCode,'DELIVERY_READY_ESTIMATE_REQUIRED');
 assert.equal(r.observations.at(-1).prediction,'GREEN');assert.equal(r.verified,false);
 const invalid=spawnSync(process.execPath,[cli],{input:'INVALID_PRIVATE_PAYLOAD',encoding:'utf8',env:{PATH:process.env.PATH,TZ:'Europe/London',MASTER_WOK_EVENT_REPLAY_ENABLED:'true'},timeout:5000});
 assert.equal(invalid.status,1);assert.equal(invalid.stdout.includes('PRIVATE_PAYLOAD'),false);
});
test('missing initial coverage and events beyond the source watermark reject before assessment',()=>{
 for(const change of [c=>c.initialState='UNKNOWN',c=>c.throughAt=at('14:00')]){
  const source=input([decision(1,'a','15:00')]);change(source.coverage);
  const r=replay(source,{enabled:true,assess:()=>assert.fail('incomplete coverage assessed')});
  assert.equal(r.status,'UNVERIFIED');assert.deepEqual(r.observations,[]);
 }
});
