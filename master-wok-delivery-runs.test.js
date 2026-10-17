'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {recommendDeliveryRuns:run}=require('./master-wok-delivery-runs');
const fit=({proposedFoodReady})=>({status:'FIT',foodReadyByOrder:structuredClone(proposedFoodReady)});
function base(){return {timeBasis:'CUSTOMER_ARRIVAL',orders:[{orderId:'A',targetMinute:1140,handoverMinutes:1},{orderId:'B',targetMinute:1140,handoverMinutes:1}],loadingMinutes:2,earliestFoodReadyMinute:990,minCombinedSavingMinutes:1,driverPlanCoverage:'COMPLETE_FOR_PLANNING_WINDOW',existingDriverPlans:[],assessedAt:'2026-10-17T16:00:00Z',maxEstimateAgeMinutes:15,legs:Object.entries({'KITCHEN/A':8,'A/KITCHEN':9,'KITCHEN/B':8,'B/KITCHEN':7,'A/B':3,'B/A':5}).map(([key,n])=>({from:key.split('/')[0],to:key.split('/')[1],durationSeconds:n*60,basis:'ROUTE_DURATION_ESTIMATE',estimatedAt:'2026-10-17T15:59:00Z'}))};}
const leg=(i,a,b,n)=>{i.legs.find(l=>l.from===a&&l.to===b).durationSeconds=n*60;};
const single=()=>{const i=base();i.orders=[i.orders[0]];i.legs=i.legs.filter(l=>l.from!=='B'&&l.to!=='B');return i;};
function limits(r){for(const p of [r.recommendation,r.separateAlternative,r.combinedAlternative].filter(Boolean))for(const d of p.deliveries){assert.ok(Math.abs(d.deviationMinutes)<=10);assert.ok(d.foodToDoorMinutes<=20);assert.equal(d.quality,d.foodToDoorMinutes<15?'PREFERRED':'ACCEPTABLE_FLAGGED');}}
test('combines nearby stops and compares complete trips with asymmetric return',()=>{const r=run(base(),{assessKitchen:fit});assert.equal(r.recommendation.kind,'COMBINED');assert.ok(r.combinedDriverMinutesSaved>0);const t=r.recommendation.trips[0],d=r.recommendation.deliveries.find(d=>d.orderId===t.stopOrder.at(-1));assert.equal(t.endMinute,d.arrivalMinute+1+(d.orderId==='A'?9:7));assert.equal(r.verified,false);limits(r);});
test('both visit orders evaluated; B-first can win',()=>{const i=base();leg(i,'KITCHEN','B',4);leg(i,'B','A',1);leg(i,'A','B',15);const r=run(i,{assessKitchen:fit});assert.deepEqual(r.combinedAlternative.trips[0].stopOrder,['B','A']);limits(r);});
test('window search shifts single delivery to fit driver return; touching boundaries allowed',()=>{const i=single();i.existingDriverPlans=[{startMinute:1100,endMinute:1131}];const r=run(i,{assessKitchen:fit});assert.equal(r.recommendation.deliveries[0].arrivalMinute,1141);assert.equal(r.recommendation.trips[0].startMinute,1131);limits(r);});
test('20 minutes allowed with warning; over 20 excluded',()=>{const i=single();leg(i,'KITCHEN','A',18);const r=run(i,{assessKitchen:fit});assert.equal(r.recommendation.deliveries[0].foodToDoorMinutes,20);assert.equal(r.recommendation.deliveries[0].quality,'ACCEPTABLE_FLAGGED');leg(i,'KITCHEN','A',19);assert.equal(run(i,{assessKitchen:fit}).recommendation,undefined);});
test('under 15 preferred, exactly 15 flagged',()=>{const i=single();for(const [n,q] of [[12,'PREFERRED'],[13,'ACCEPTABLE_FLAGGED']]){leg(i,'KITCHEN','A',n);assert.equal(run(i,{assessKitchen:fit}).recommendation.deliveries[0].quality,q);}});
test('earlier kitchen finish adds holding to food age and can rule out trip',()=>{for(const shift of [-4,-30,1]){const r=run(base(),{assessKitchen:({proposedFoodReady})=>({status:'FIT',foodReadyByOrder:proposedFoodReady.map(x=>({...x,foodReadyMinute:x.foodReadyMinute+shift}))})});if(shift===-4){assert.ok(r.recommendation);limits(r);}else assert.equal(r.recommendation,undefined);}});
test('separate trips preferred when only they keep food under 15',()=>{const i=base();leg(i,'A','B',6);leg(i,'B','A',6);const r=run(i,{assessKitchen:fit});assert.ok(r.separateAlternative.allUnder15);assert.equal(r.combinedAlternative.allUnder15,false);assert.equal(r.recommendation.kind,'SEPARATE');});
test('explicit minimum saving prevents combining for insufficient benefit',()=>{const i=base();i.minCombinedSavingMinutes=120;assert.equal(run(i,{assessKitchen:fit}).recommendation.kind,'SEPARATE');});
test('combined may be only feasible driver plan; no invented savings baseline',()=>{const i=base();i.existingDriverPlans=[{startMinute:0,endMinute:1129},{startMinute:1155,endMinute:1440}];const r=run(i,{assessKitchen:fit});assert.equal(r.separateAlternative,null);assert.equal(r.recommendation.kind,'COMBINED');assert.equal(r.combinedDriverMinutesSaved,null);limits(r);});
test('every directional leg required, including both return and inter-customer legs',()=>{for(const key of ['A/B','B/A','A/KITCHEN','B/KITCHEN']){const i=base();i.legs=i.legs.filter(l=>l.from+'/'+l.to!==key);assert.equal(run(i,{assessKitchen:fit}).reasonCode,'DIRECTIONAL_ROUTE_LEGS_REQUIRED');}});
test('joint kitchen assessment includes both orders and may reject combined departure',()=>{let calls=0;const r=run(base(),{assessKitchen:p=>{calls++;assert.equal(p.proposedFoodReady.length,2);return p.kind==='COMBINED'?{status:'NO_FIT'}:fit(p);}});assert.ok(calls);assert.equal(r.combinedAlternative,null);assert.equal(r.recommendation.kind,'SEPARATE');});
test('missing, throwing, async, incomplete kitchen evidence stays unverified',()=>{for(const assessKitchen of [undefined,()=>{throw Error('private');},async()=>({status:'FIT'}),()=>({status:'FIT',foodReadyByOrder:[]})]){const r=run(base(),{assessKitchen});assert.equal(r.status,'UNVERIFIED');assert.equal(r.searchComplete,false);assert.ok(!JSON.stringify(r).includes('private'));}});
test('invalid identifiers, allowances, coverage, dates, estimates never yield recommendation',()=>{for(const i of [null,{...base(),orders:[]},{...base(),orders:[base().orders[0],base().orders[0]]},{...base(),timeBasis:'FOOD_READY'},{...base(),loadingMinutes:undefined},{...base(),driverPlanCoverage:undefined},{...base(),assessedAt:'2026-10-17T17:00:00Z'},{...base(),assessedAt:'2026-10-17T16:00:00'},{...base(),earliestFoodReadyMinute:NaN}])assert.equal(run(i,{assessKitchen:fit}).status,'UNVERIFIED');});
test('driver return conflicts apply after delivery arrival',()=>{const i=base();i.existingDriverPlans=[{startMinute:1141,endMinute:1440}];const r=run(i,{assessKitchen:fit});if(r.recommendation)for(const t of r.recommendation.trips)assert.ok(t.endMinute<=1141);limits(r);});
test('deterministic and immutable, with callback mutation isolated',()=>{const i=base(),copy=structuredClone(i);const r=run(i,{assessKitchen:p=>{const answer=fit(p);p.proposedFoodReady[0].foodReadyMinute=0;return answer;}});assert.deepEqual(i,copy);assert.deepEqual(r,run(i,{assessKitchen:fit}));assert.match(r.evidenceBasis,/NOT_DRIVER_OR_COOKING_ACTIVITY/);});
test('THE_NIGHT_DAVID_DELIVERED_TO_HALF_OF_MORLEY: long inter-stop detour excluded',()=>{assert.equal(run(base(),{assessKitchen:fit}).recommendation.kind,'COMBINED');const i=base();leg(i,'A','B',30);leg(i,'B','A',30);const r=run(i,{assessKitchen:fit});assert.equal(r.combinedAlternative,null);assert.equal(r.recommendation.kind,'SEPARATE');});
test('window endpoint is included, eleven-minute delay is not silently offered',()=>{
 const i=single();i.existingDriverPlans=[{startMinute:0,endMinute:1140}];
 let r=run(i,{assessKitchen:fit});assert.equal(r.recommendation.deliveries[0].deviationMinutes,10);
 i.existingDriverPlans[0].endMinute=1141;r=run(i,{assessKitchen:fit});assert.equal(r.recommendation,undefined);
});
test('seconds round up; stale reverse legs and duplicate legs fail closed',()=>{
 const i=single();leg(i,'KITCHEN','A',12+1/60);
 assert.equal(run(i,{assessKitchen:fit}).recommendation.deliveries[0].foodToDoorMinutes,15);
 i.legs[1].estimatedAt='2026-10-17T15:00:00Z';assert.equal(run(i,{assessKitchen:fit}).status,'UNVERIFIED');
 const j=base();j.legs.push(j.legs[0]);assert.equal(run(j,{assessKitchen:fit}).status,'UNVERIFIED');
});
test('rejected async kitchen callback is isolated',async()=>{
 const r=run(base(),{assessKitchen:async()=>{throw Error('private callback');}});
 assert.equal(r.status,'UNVERIFIED');await new Promise(resolve=>setImmediate(resolve));
});
test('joint loading and quality limits hold across deterministic varied route matrices',()=>{
 for(let n=0;n<24;n++){
  const i=base();i.orders[1].targetMinute+=n%9-4;
  i.legs.forEach((l,k)=>{l.durationSeconds=(1+(n*7+k*3)%18)*60;});
  const r=run(i,{assessKitchen:fit});limits(r);
  for(const p of [r.separateAlternative,r.combinedAlternative].filter(Boolean)){
   for(let a=0;a<p.trips.length;a++)for(let b=a+1;b<p.trips.length;b++)
    assert.ok(p.trips[a].endMinute<=p.trips[b].startMinute||p.trips[b].endMinute<=p.trips[a].startMinute);
   for(const t of p.trips)for(const d of p.deliveries.filter(d=>t.stopOrder.includes(d.orderId)))
    assert.ok(d.foodReadyMinute<=t.startMinute);
  }
 }
});
test('explicit zero-time inter-stop estimate is allowed, missing duration is not zero',()=>{
 const i=base();leg(i,'A','B',0);leg(i,'B','A',0);
 assert.ok(run(i,{assessKitchen:fit}).combinedAlternative);
 delete i.legs.find(l=>l.from==='A'&&l.to==='B').durationSeconds;
 assert.equal(run(i,{assessKitchen:fit}).status,'UNVERIFIED');
});
