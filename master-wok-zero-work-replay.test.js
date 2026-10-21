'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const {createReplayAssessment}=require('./master-wok-server-adapter');
const {replay}=require('./master-wok-chronological-replay');
const sources=['master-wok-model-bundle.js','master-wok.js','master-wok-shadow.js'].map(f=>fs.readFileSync(require('node:path').join(__dirname,f),'utf8'));
function context(){const c=vm.createContext({window:{},Date});for(const s of sources)vm.runInContext(s,c);return c;}
function london(fn){const prior=process.env.TZ;process.env.TZ='Europe/London';try{return fn();}finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}}
const rice=[{itemId:'jasmine-rice',qty:1,mods:[]}];const curry=[{itemId:'panang-curry',qty:1,mods:[{id:'chicken'}]}];
const snapshot=(lines=rice)=>({complete:true,basis:'PRE_DECISION_HISTORY',decisionAt:'2026-10-21T12:00:00Z',reservations:[],proposed:{orderId:'candidate',readyMinute:1080,lines}});
test('zero work is explicit opt-in; empty schedule creates no cooking job or actual activity',()=>london(()=>{
 const c=context(),classification=c.window.MasterWokModelV1.classifyBasket(rice);
 const row={orderId:'rice',placedAt:new Date('2026-10-21T12:00:00Z'),readyMinute:1080,classification};
 const fn=c.window.MasterWokShadowV1.replayReservationsV1;
 assert.equal(fn('2026-10-21',[row]).observations[0].status,'UNVERIFIED');
 assert.equal(fn('2026-10-21',[row],{allowZeroRungWork:'true'}).observations[0].status,'UNVERIFIED');
 const schedule=c.window.MasterWokV1.schedule,calls=[];
 c.window.MasterWokV1={...c.window.MasterWokV1,schedule:(orders,options)=>{calls.push(orders);return schedule(orders,options);}};
 const result=fn('2026-10-21',[row],{allowZeroRungWork:true});
 assert.equal(result.observations[0].status,'GREEN');assert.deepEqual(calls.map(a=>a.length),[0,0]);
 assert.equal(result.reservations,1);assert.equal(result.verified,false);assert.equal(result.evidenceBasis,'HYPOTHETICAL_PLANS_NOT_COOKING_ACTIVITY');
}));
test('known rice and Sam-only baskets have no Rung conflict while mixed baskets retain cooking load',()=>london(()=>{
 const assess=createReplayAssessment();
 for(const lines of [rice,[{itemId:'chicken-spring-rolls',qty:1,mods:[]}],curry.concat(rice)])assert.equal(assess({serviceDate:'2026-10-21',snapshot:snapshot(lines)}).status,'GREEN');
 const s=snapshot(curry);const without=assess({serviceDate:'2026-10-21',snapshot:s});
 s.reservations=[{orderId:'earlier-rice',placedAt:'2026-10-21T11:00:00Z',readyMinute:1080,lines:rice}];
 assert.deepEqual(assess({serviceDate:'2026-10-21',snapshot:s}),without);
}));
test('zero-work replay preserves failures, deadlines, invalid menus and incomplete history',()=>london(()=>{
 const assess=createReplayAssessment();
 for(const s of [Object.assign(snapshot(),{complete:false}),Object.assign(snapshot(),{decisionAt:'2026-10-21T18:00:00Z'}),snapshot([{itemId:'unknown',qty:1,mods:[]}]),snapshot([])])assert.equal(assess({serviceDate:'2026-10-21',snapshot:s}).status,'UNVERIFIED');
 const s=snapshot();s.reservations=[{orderId:'impossible-noodles',placedAt:'2026-10-21T10:00:00Z',readyMinute:1000,lines:[{itemId:'pad-thai',qty:100,mods:[]}]}];
 assert.equal(assess({serviceDate:'2026-10-21',snapshot:s}).status,'UNVERIFIED');
 const c=context();c.window.MasterWokModelV1={...c.window.MasterWokModelV1,calculateCombinedKitchenPressure:()=>({productionWindow:{rawMinutes:0,reservedMinutes:undefined}})};
 const r=c.window.MasterWokShadowV1.replayReservationsV1('2026-10-21',[{orderId:'bad',placedAt:new Date('2026-10-21T12:00:00Z'),readyMinute:1080,classification:{}}],{allowZeroRungWork:true});
 assert.equal(r.observations[0].status,'UNVERIFIED');
}));
test('zero-work delivery still requires a food-ready estimate and the booking remains a commitment',()=>london(()=>{
 const fixture=structuredClone(require('./fixtures/cross-date-authenticated-capture.json'));
 const b=fixture.streams[0].batch;
 for(const e of b.events)if(e.order)e.order.orderType='delivery';
 const r=replay(b,{enabled:true});
 assert.equal(r.status,'REPLAYED');assert.equal(r.remainingCommitments,1);
 assert.ok(r.observations.every(o=>o.prediction==='UNVERIFIED'&&o.reasonCode==='DELIVERY_READY_ESTIMATE_REQUIRED'&&o.verified===false));
}));
