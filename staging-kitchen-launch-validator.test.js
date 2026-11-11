'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planCoordinatedKitchen}=require('./staging-coordinated-kitchen');
const {validateKitchenTimeline}=require('./staging-kitchen-launch-validator');
const at=(h,m)=>new Date(2026,9,17,h,m);
const orders=[{orderId:'A',readyMinute:1140,placedAt:at(17,30)}];
const rows=[{id:'A',items:[{item_id:'stir-crispy',qty:1,modifiers:[]}]}];
test('real coordinated prototype is checked against order placement',()=>{
 const plan=planCoordinatedKitchen(orders,rows);
 const result=validateKitchenTimeline(orders,plan,rows);
 assert.equal(result.status,'VALIDATED_STAGING_TIMELINE');
 assert.equal(result.bookingApprovalAllowed,false);
});
test('rejects fryer work scheduled before order placement',()=>{
 const plan=planCoordinatedKitchen(orders,rows);
 plan.fryer.jobs[0].start=1000;
 const result=validateKitchenTimeline(orders,plan,rows);
 assert.ok(result.issues.some(x=>x.code==='BEFORE_ORDER_PLACED'));
});
test('rejects two jobs occupying the same basket simultaneously',()=>{
 const plan=planCoordinatedKitchen(orders,rows);
 plan.fryer.jobs.push({...plan.fryer.jobs[0]});
 const result=validateKitchenTimeline(orders,plan,rows);
 assert.ok(result.issues.some(x=>x.code==='RESOURCE_OVERLAP'));
});
test('rejects fryer completion after wok begins',()=>{
 const plan=planCoordinatedKitchen(orders,rows);
 plan.fryer.jobs[0].finish=plan.wok.jobs[0].start+1;
 const result=validateKitchenTimeline(orders,plan,rows);
 assert.ok(result.issues.some(x=>x.code==='FRY_WOK_DEPENDENCY_UNVERIFIED'));
});

test('four-ring validator rejects incorrect vessels, a fifth ring, and kitchen blackout overlap',()=>{
 const items=['green-curry','red-curry','panang-curry','coconut-rice'].map(item_id=>({item_id,qty:1,modifiers:[]}));
 const rows=[{id:'A',items}];
 const p=planCoordinatedKitchen(orders,rows,{sharedRings:true,confirmedStarterRecipes:true});
 assert.equal(validateKitchenTimeline(orders,p,rows).status,'VALIDATED_STAGING_TIMELINE');
 const wrong=structuredClone(p);wrong.wok.jobs[0].vessel='unknown';
 assert.ok(validateKitchenTimeline(orders,wrong,rows).issues.some(i=>i.code==='INVALID_VESSEL'));
 const fifth=structuredClone(p);fifth.wok.jobs.push({...fifth.wok.jobs[0],vessel:'pan-5'});
 assert.ok(validateKitchenTimeline(orders,fifth,rows).issues.some(i=>i.code==='RING_CAPACITY_EXCEEDED'));
 assert.ok(validateKitchenTimeline(orders,p,rows,{blackouts:[{start:990,finish:1320}]}).issues.some(i=>i.code==='BLACKOUT_OVERLAP'));
});

test('independent validation rejects new work overlapping a protected microwave reservation',()=>{
 const rows=[{id:'A',items:[{item_id:'pork-dumplings',qty:1,modifiers:[]}]}];
 const p=planCoordinatedKitchen(orders,rows,{sharedRings:true,confirmedStarterRecipes:true});
 const j=p.auxiliary.jobs[0];
 const result=validateKitchenTimeline(orders,p,rows,{fixedAuxiliary:[{...j,orderIds:['cancelled'],allocations:j.allocations.map(a=>({...a,orderId:'cancelled'}))}]});
 assert.ok(result.issues.some(i=>i.code==='PROTECTED_RESOURCE_OVERLAP'));
});

test('frying for identical one-portion batches is counted at each exact cooking deadline',()=>{
 const rows=[{id:'A',items:[{item_id:'stir-crispy',qty:5,modifiers:[]}]}];
 const p=planCoordinatedKitchen(orders,rows,{sharedRings:true,confirmedStarterRecipes:true});
 assert.equal(p.status,'COORDINATED_PROTOTYPE');
 assert.equal(validateKitchenTimeline(orders,p,rows).status,'VALIDATED_STAGING_TIMELINE');
 const deadlines=p.fryer.jobs.flatMap(j=>j.allocations.map(a=>a.deadline)),last=Math.max(...deadlines);
 assert.ok(Math.min(...deadlines)<last);
 const bad=structuredClone(p);
 const allocation=bad.fryer.jobs.flatMap(j=>j.allocations).find(a=>a.deadline<last);allocation.deadline=last;
 assert.ok(validateKitchenTimeline(orders,bad,rows).issues.some(i=>i.code==='FRYER_DEADLINE_COVERAGE_INVALID'));
 const oversized=structuredClone(p);oversized.wok.jobs[0].portions=2;
 assert.ok(validateKitchenTimeline(orders,oversized,rows).issues.some(i=>i.code==='WOK_PORTION_CAPACITY_EXCEEDED'));
});

