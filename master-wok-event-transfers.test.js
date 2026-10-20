const test=require('node:test'),assert=require('node:assert/strict');
const {replay,validateEventBatch}=require('./master-wok-chronological-replay');
const {validateTransferPair}=require('./master-wok-event-transfers');
const order=(day)=>({orderId:'synthetic-move',orderType:'collection',targetAt:day+'T18:00:00Z',lines:[{itemId:'jasmine-rice',qty:1,mods:[]}],deliveryReadyEstimate:null});
const batch=(day,events)=>({serviceDate:day,events,coverage:{basis:'DECISION_EVENT_LOG',complete:true,eventCount:events.length,firstSequence:1,lastSequence:events.length,initialState:'NO_PRIOR_SERVICE_COMMITMENTS',throughAt:'2026-10-20T12:00:00Z'}});
function pair(){return [batch('2026-10-20',[{eventId:'create',sequence:1,at:'2026-10-20T10:00:00Z',kind:'RESERVATION_SET',order:order('2026-10-20'),commitment:'PROPOSED'},{eventId:'move_out',sequence:2,at:'2026-10-20T11:00:00Z',kind:'RESERVATION_TRANSFERRED_OUT',orderId:'synthetic-move',transferId:'move',toServiceDate:'2026-10-21'}]),batch('2026-10-21',[{eventId:'move_in',sequence:1,at:'2026-10-20T11:00:00Z',kind:'RESERVATION_TRANSFERRED_IN',order:order('2026-10-21'),actualDecision:'SUGGESTED',transferId:'move',fromServiceDate:'2026-10-20'}])];}
test('transfer pairing is default off and matches both complete histories',()=>{
 assert.equal(validateTransferPair().status,'DISABLED');const [a,b]=pair();assert.equal(validateTransferPair(a,b,'move',{enabled:true}).status,'PAIRED');
 assert.equal(replay(a,{enabled:true}).remainingCommitments,0);assert.equal(replay(b,{enabled:true}).remainingCommitments,1);assert.equal(replay(b,{enabled:true}).decisionCount,1);
});
test('source replies are stale, incoming offer accepts exactly once and can move back',()=>{
 const [a,b]=pair();a.events.push({eventId:'stale',sequence:3,at:'2026-10-20T11:01:00Z',kind:'PROPOSAL_RESPONSE',orderId:'synthetic-move',proposalEventId:'create',response:'ACCEPTED'});a.coverage.eventCount=a.coverage.lastSequence=3;
 assert.throws(()=>validateEventBatch(a),/STALE_PROPOSAL_RESPONSE/);
 b.events.push({eventId:'accept',sequence:2,at:'2026-10-20T11:01:00Z',kind:'PROPOSAL_RESPONSE',orderId:'synthetic-move',proposalEventId:'move_in',response:'ACCEPTED'});b.coverage.eventCount=b.coverage.lastSequence=2;
 assert.equal(replay(b,{enabled:true}).remainingCommitments,1);
 const [x,y]=pair();x.events.push({...y.events[0],eventId:'back_in',sequence:3,at:'2026-10-20T11:02:00Z',order:order('2026-10-20'),transferId:'back',fromServiceDate:'2026-10-21'});x.coverage.eventCount=x.coverage.lastSequence=3;
 assert.equal(replay(x,{enabled:true}).remainingCommitments,1);
});
test('missing counterpart, mismatched clock or occupied destination refuses pairing/ingress',()=>{
 const [a,b]=pair();const changed=structuredClone(b);changed.events[0].at='2026-10-20T11:00:01Z';assert.equal(validateTransferPair(a,changed,'move',{enabled:true}).status,'UNVERIFIED');
 assert.equal(validateTransferPair(a,b,'absent',{enabled:true}).status,'UNVERIFIED');
 b.events.push({...b.events[0],sequence:2,eventId:'duplicate-transfer',transferId:'another'});b.coverage.eventCount=b.coverage.lastSequence=2;
 assert.throws(()=>validateEventBatch(b),/TRANSFER_DESTINATION_OCCUPIED/);
});
test('actual staging exports pair moves in both directions without a residual commitment',()=>{
 const {source_batch:a,destination_batch:b}=require('./fixtures/cross-date-staging-capture.json');
 assert.equal(validateTransferPair(a,b,'move-forward',{enabled:true}).status,'PAIRED');
 assert.equal(validateTransferPair(b,a,'move-back',{enabled:true}).status,'PAIRED');
 for(const s of [a,b]){const r=replay(s,{enabled:true});assert.equal(r.status,'REPLAYED');assert.equal(r.remainingCommitments,0);assert.equal(r.decisionCount,1);assert.equal(r.verified,false);}
});
test('a paired transfer cannot change the basket or carry a delivery estimate',()=>{
 const [a,b]=pair();b.events[0].order.lines[0].qty=2;
 assert.equal(validateTransferPair(a,b,'move',{enabled:true}).status,'UNVERIFIED');
 const [x,y]=pair();y.events[0].order.orderType='delivery';y.events[0].order.deliveryReadyEstimate={basis:'DELIVERY_PLANNER_ESTIMATE',estimatedAt:y.events[0].at,foodReadyAt:'2026-10-21T17:50:00Z',arrivalAt:'2026-10-21T18:00:00Z'};
 assert.throws(()=>validateEventBatch(y),/TRANSFER_CONTRACT_REQUIRED/);
});
