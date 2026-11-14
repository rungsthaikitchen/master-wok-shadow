'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {calculateAmendment,createAmendmentWriter,snapshot}=require('./master-wok-amendments');
const base={id:'00000000-0000-4000-8000-000000000001',order_ref:'SYNTHETIC-AMEND',status:'confirmed',paid:false,loyalty_settled:false,order_type:'delivery',subtotal:'22.50',discount:'0.00',discount_amount:'0.00',loyalty_discount:'0.00',delivery_fee:'3.00',total:'25.50',discount_code:null,preferred_time:'2026-11-12T20:00:00Z',loyalty_points_earned_pending:22,loyalty_points_redeem_pending:0,loyalty_expected_balance:35};
const changes={orderType:'collection',deliveryAddress:'',deliveryFee:'',discountCode:''},now='2026-11-12T16:00:00Z';
const quote={straightLineMiles:1,routeMiles:2,customerLatitude:53.74,customerLongitude:-1.57};
const discount={code:'MIDWEEK10',active:true,discount_type:'percent',discount_value:10,allowed_weekdays:[3,4]};
test('delivery to collection removes charge and coordinates, preserving basket value',()=>{const p=calculateAmendment(base,changes,{now});assert.equal(p.total,22.5);assert.equal(p.delivery_fee,0);assert.equal(p.customer_lat,null);assert.equal(p.loyalty_points_earned_pending,22);});
test('collection to delivery derives fee, hard radius and free delivery from saved subtotal',()=>{
 const o={...base,order_type:'collection',delivery_fee:0,total:22.5};const c={...changes,orderType:'delivery',deliveryAddress:'Synthetic address'};
 assert.equal(calculateAmendment(o,c,{now,quote}).total,25.5);
 assert.equal(calculateAmendment({...o,subtotal:30,total:30},c,{now,quote}).delivery_fee,0);
 assert.throws(()=>calculateAmendment(o,c,{now,quote:{...quote,straightLineMiles:3.01}}),/NOT_ELIGIBLE/);
 assert.equal(calculateAmendment(o,{...c,deliveryFee:'0.00'},{now,quote}).delivery_fee,0);
 assert.throws(()=>calculateAmendment(o,{...c,deliveryFee:'0.001'},{now,quote}),/MONEY/);
});
test('adding a code recalculates food total and pending points; no new reward',()=>{
 const p=calculateAmendment(base,{...changes,discountCode:'midweek10'},{now,discount});assert.equal(p.total,20.25);assert.equal(p.discount_amount,2.25);assert.equal(p.loyalty_points_earned_pending,20);assert.equal(p.loyalty_expected_balance,33);assert.equal(p.loyalty_discount,0);
 assert.throws(()=>calculateAmendment({...base,preferred_time:'2026-11-14T20:00:00Z'},{...changes,discountCode:'MIDWEEK10'},{now,discount}),/WRONG_SERVICE_DAY/);
});
test('removing code retains existing loyalty, full discount releases unused redemption',()=>{
 const o={...base,discount_code:'OLD',discount_amount:2.5,loyalty_discount:5,discount:7.5,total:18,loyalty_points_redeem_pending:100,loyalty_reward_applied:true,loyalty_points_earned_pending:15,loyalty_expected_balance:30};
 const p=calculateAmendment(o,changes,{now});assert.equal(p.total,17.5);assert.equal(p.loyalty_discount,5);assert.equal(p.loyalty_points_redeem_pending,100);
 const full=calculateAmendment(o,{...changes,discountCode:'FREE'},{now,discount:{code:'FREE',active:true,discount_type:'percent',discount_value:100}});assert.equal(full.total,0);assert.equal(full.loyalty_points_redeem_pending,0);assert.equal(full.loyalty_expected_balance,115);
});
test('unchanged expired code is preserved and inconsistent historic totals are refused',()=>{
 const o={...base,discount_code:'OLD',discount_amount:2,discount:2,total:23.5};assert.equal(calculateAmendment(o,{...changes,discountCode:'OLD'},{now}).total,20.5);
 assert.throws(()=>calculateAmendment({...base,total:2},changes,{now}),/EXISTING_TOTALS/);
 assert.throws(()=>calculateAmendment(base,{...changes,deliveryFee:'1.00'},{now}),/COLLECTION/);
 assert.throws(()=>calculateAmendment(base,{...changes,total:1},{now}),/INVALID_AMENDMENT/);
});
function harness({order=base,payment=null,assessment=true,failAudit=false,deliveryQuote=quote}={}){
 let state=structuredClone(order),backup,audit=[],queries=[],saves=0;
 const c={release(){},async query(sql,args=[]){queries.push(sql);
  if(sql==='BEGIN')backup=structuredClone(state);
  if(sql==='ROLLBACK')state=backup;
  if(sql.startsWith('SELECT request_fingerprint'))return {rows:audit.filter(x=>x.key===args[0])};
  if(sql.startsWith('SELECT * FROM "public".orders'))return {rows:[structuredClone(state)]};
  if(sql.startsWith('SELECT * FROM "public".order_payments'))return {rows:payment?[payment]:[]};
  if(sql.startsWith('SELECT actor,reason'))return {rows:[]};
  if(sql.startsWith('SELECT clock_timestamp'))return {rows:[{now}]};
  if(sql.startsWith('SELECT * FROM "public".discount_codes'))return {rows:[discount]};
  if(sql.startsWith('UPDATE "public".orders')){const fields=[...sql.matchAll(/"([a-z_]+)"=\$/g)].map(m=>m[1]);fields.forEach((k,i)=>state[k]=args[i+1]);}
  if(sql.startsWith('INSERT INTO "public".order_amendments')){if(failAudit)throw Error('AUDIT_DOWN');audit.push({key:args[1],request_fingerprint:args[2],response:JSON.parse(args[7]),after:JSON.parse(args[6]),actor:args[3],reason:args[4]});}
  return {rows:[]};}};
 const run=createAmendmentWriter({pool:{connect:async()=>c},assertWriteAllowed:async()=>{},quoteDelivery:async()=>deliveryQuote,assessMutation:async()=>assessment?{status:'GREEN',bookingApprovalAllowed:true,plansByDate:{'2026-11-12':{ok:true}}}:{status:'RED'},planStore:{read:async()=>null,save:async()=>saves++}});
 const read=()=>run({action:'amend_read',orderId:base.id,staffActor:'staff@example.invalid'});
 return {run,read,get state(){return state;},queries,audit,get saves(){return saves;}};
}
const input={orderId:base.id,staffActor:'staff@example.invalid',changes,reason:'Customer requested collection',idempotencyKey:'00000000-0000-4000-8000-000000000002'};
test('preview rolls back; save writes order, plan and audit; retry replays before stale-version check',async()=>{
 const h=harness(),r=await h.read();assert.equal(r.success,true);
 const p=await h.run({...input,action:'amend_preview',expectedVersion:r.version});assert.equal(p.success,true);assert.equal(h.state.total,base.total);assert.equal(h.audit.length,0);assert.equal(h.saves,0);
 const save={...input,action:'amend_save',expectedVersion:r.version,expectedPreview:p.preview};const s=await h.run(save);assert.equal(s.committed,true);assert.equal(h.state.total,22.5);assert.equal(h.audit.length,1);assert.equal(h.saves,1);
 const retry=await h.run(save);assert.equal(retry.replayed,true);assert.equal(h.audit.length,1);
 assert.equal((await h.run({...save,reason:'different'})).reason,'AMENDMENT_IDEMPOTENCY_CONFLICT');
});
test('stale order, active paid order and failed capacity refuse without a commit',async()=>{
 for(const order of [{...base,paid:true},{...base,loyalty_settled:true}]){const h=harness({order});assert.equal((await h.read()).success,false);assert.ok(!h.queries.includes('COMMIT'));}
 const paid=harness({payment:{id:'p'}});assert.equal((await paid.read()).reason,'AMENDMENT_PAYMENT_ALREADY_RECORDED');
 const h=harness({assessment:false}),r=await h.read();assert.equal((await h.run({...input,action:'amend_preview',expectedVersion:r.version})).reason,'AMENDMENT_SCHEDULE_NOT_AVAILABLE');assert.equal(h.state.order_type,'delivery');
 assert.equal((await h.run({...input,action:'amend_preview',expectedVersion:'wrong'})).reason,'AMENDMENT_ORDER_CHANGED_REFRESH');
});
test('audit failure rolls order back and a changed preview can never save',async()=>{
 const h=harness({failAudit:true}),r=await h.read(),p=await h.run({...input,action:'amend_preview',expectedVersion:r.version});
 assert.equal((await h.run({...input,action:'amend_save',expectedVersion:r.version,expectedPreview:'wrong'})).reason,'AMENDMENT_PRICE_CHANGED_REVIEW');
 const s=await h.run({...input,action:'amend_save',expectedVersion:r.version,expectedPreview:p.preview});assert.equal(s.success,false);assert.equal(h.state.total,base.total);assert.ok(!h.queries.includes('COMMIT'));
});
test('same mode monetary correction does not replan; snapshot normalizes SQL decimals',async()=>{
 const h=harness(),r=await h.read();const p=await h.run({...input,action:'amend_preview',changes:{...changes,orderType:'delivery',deliveryAddress:'Synthetic address',deliveryFee:'0.00'},expectedVersion:r.version});assert.equal(p.success,true);
 assert.equal(snapshot({...base,total:25.5}).total,snapshot(base).total);
});

test('SQL numeric coordinate round trips do not turn a fee correction into a schedule change',async()=>{
 const order={...base,delivery_address:'Synthetic address',customer_lat:'53.74',customer_lng:'-1.57',delivery_straight_line_miles:'1',delivery_route_miles:'2'};
 const h=harness({order,assessment:false}),r=await h.read();
 const p=await h.run({...input,action:'amend_preview',expectedVersion:r.version,changes:{...changes,orderType:'delivery',deliveryAddress:'Synthetic address',deliveryFee:'0.00'}});
 assert.equal(p.success,true);assert.equal(p.after.total,'22.50');assert.equal(h.saves,0);
});

test('completed paid amendment preserves receipt and never reads or saves kitchen plans',async()=>{
 const h=harness({order:{...base,status:'completed',paid:true},payment:{id:'p',bill_amount:'25.50',bill_method:'card',tip_amount:'2.00',tip_method:'cash'},assessment:false});
 const r=await h.read();assert.equal(r.completedAmendment,true);
 const p=await h.run({...input,action:'amend_preview',expectedVersion:r.version});assert.equal(p.success,true);assert.equal(p.paymentAfter.balance.overpayment,'3.00');assert.equal(p.paymentAfter.tipAmount,'2.00');
 const saved=await h.run({...input,action:'amend_save',expectedVersion:r.version,expectedPreview:p.preview});assert.equal(saved.committed,true);assert.equal(h.state.status,'completed');assert.equal(h.state.payment_status,'overpaid');assert.equal(h.saves,0);assert.ok(!h.queries.some(s=>s.includes('UPDATE "public".order_payments')));
});
test('completed delivery classification requires explicit fee and never invents a route',()=>{
 const p=calculateAmendment({...base,status:'completed'}, {...changes,orderType:'delivery',deliveryAddress:'',deliveryFee:'4.00'},{now,completed:true});assert.equal(p.delivery_fee,4);assert.equal(p.total,26.5);assert.equal(p.customer_lat,null);
 assert.throws(()=>calculateAmendment(base,{...changes,orderType:'delivery'},{now,completed:true}),/COMPLETED_DELIVERY_FEE/);
});

test('staff delivery-area exception requires an explicit charge and never skips valid coordinates',()=>{
 const o={...base,order_type:'collection',delivery_fee:0,total:22.5},c={...changes,orderType:'delivery',deliveryAddress:'Synthetic outside address',deliveryAreaOverride:true,deliveryFee:'4.00'},outside={...quote,straightLineMiles:3.28};
 assert.equal(calculateAmendment(o,c,{now,quote:outside}).total,26.5);
 assert.throws(()=>calculateAmendment(o,{...c,deliveryAreaOverride:false},{now,quote:outside}),/NOT_ELIGIBLE/);
 assert.throws(()=>calculateAmendment(o,{...c,deliveryFee:''},{now,quote:outside}),/MANUAL_FEE/);
 assert.throws(()=>calculateAmendment(o,{...c,deliveryAreaOverride:'true'},{now,quote:outside}),/INVALID_AMENDMENT/);
 assert.throws(()=>calculateAmendment(o,c,{now,quote:{...outside,customerLatitude:NaN}}),/NOT_ELIGIBLE/);
});
test('staff area override is previewed, tied to the reason, saved and audited atomically',async()=>{
 const h=harness({order:{...base,order_type:'collection',delivery_fee:0,total:22.5},deliveryQuote:{...quote,straightLineMiles:3.28}}),r=await h.read();
 const i={...input,changes:{...changes,orderType:'delivery',deliveryAddress:'Synthetic address',deliveryAreaOverride:true,deliveryFee:'4.00'},reason:'Staff agreed delivery-area exception',action:'amend_preview',expectedVersion:r.version};
 assert.equal((await h.run({...i,reason:''})).reason,'AMENDMENT_AREA_OVERRIDE_REASON_REQUIRED');
 const p=await h.run(i);assert.equal(p.success,true);assert.equal(p.deliveryAreaOverride.applied,true);assert.equal(h.audit.length,0);
 assert.equal((await h.run({...i,action:'amend_save',reason:'Changed reason',expectedPreview:p.preview})).reason,'AMENDMENT_PRICE_CHANGED_REVIEW');
 const save=await h.run({...i,action:'amend_save',expectedPreview:p.preview});assert.equal(save.committed,true);assert.equal(h.audit[0].after.delivery_area_override.actor,'staff@example.invalid');assert.equal(h.audit[0].after.delivery_area_override.straightLineMiles,3.28);assert.equal(h.audit[0].reason,i.reason);
});
test('area override cannot bypass a failed kitchen or driver assessment',async()=>{
 const h=harness({order:{...base,order_type:'collection',delivery_fee:0,total:22.5},deliveryQuote:{...quote,straightLineMiles:3.28},assessment:false}),r=await h.read();
 const p=await h.run({...input,action:'amend_preview',expectedVersion:r.version,changes:{...changes,orderType:'delivery',deliveryAddress:'Synthetic',deliveryAreaOverride:true,deliveryFee:'4.00'}});
 assert.equal(p.reason,'AMENDMENT_SCHEDULE_NOT_AVAILABLE');assert.equal(h.state.order_type,'collection');assert.equal(h.audit.length,0);
});

test('staff correction confirms stored proposed time, preserves decline history, audits and sends no message',async()=>{
 const h=harness({order:{...base,status:'customer_declined_time',confirmed_time:null,preferred_time:'2026-11-12T18:30:00Z',proposed_time:'2026-11-12T18:45:00Z'}}),r=await h.read();
 assert.equal(r.staffTimeConfirmationAvailable,true);
 const i={...input,action:'amend_confirm_time',expectedVersion:r.version,reason:'Customer selected decline by mistake; agreed time confirmed verbally',proposedTime:'2026-11-12T19:00:00Z'};
 const save=await h.run(i);assert.equal(save.committed,true);assert.equal(h.state.status,'confirmed');assert.equal(h.state.confirmed_time,'2026-11-12T18:45:00.000Z');assert.equal(h.state.preferred_time,'2026-11-12T18:30:00Z');assert.equal(h.state.confirm_token,null);assert.equal(save.customerNotificationSent,false);
 assert.equal(h.audit[0].after.time_confirmation.source,'STAFF_RECORDED_CUSTOMER_AGREEMENT');assert.equal(h.audit[0].actor,'staff@example.invalid');assert.ok(!h.queries.some(q=>q.includes('master_wok_notification_outbox')||q.includes('master_wok_time_responses')));
 assert.equal((await h.run(i)).replayed,true);assert.equal(h.audit.length,1);
 assert.equal((await h.run({...i,reason:'Different'})).reason,'AMENDMENT_IDEMPOTENCY_CONFLICT');
});
test('staff confirmation refuses stale state, missing reason, nonstaff and failed capacity',async()=>{
 const o={...base,status:'customer_declined_time',proposed_time:'2026-11-12T20:15:00Z'};
 const h=harness({order:o,assessment:false}),r=await h.read(),i={...input,action:'amend_confirm_time',expectedVersion:r.version};
 assert.equal((await h.run({...i,reason:''})).reason,'AMENDMENT_REASON_AND_KEY_REQUIRED');
 assert.equal((await h.run({...i,staffActor:''})).reason,'AMENDMENT_STAFF_REQUIRED');
 assert.equal((await h.run({...i,expectedVersion:'stale'})).reason,'AMENDMENT_ORDER_CHANGED_REFRESH');
 assert.equal((await h.run(i)).reason,'AMENDMENT_SCHEDULE_NOT_AVAILABLE');assert.equal(h.state.status,'customer_declined_time');assert.equal(h.audit.length,0);
});
test('staff confirmation needs an unresolved proposal and audit insertion must succeed',async()=>{
 const h=harness(),r=await h.read();assert.equal((await h.run({...input,action:'amend_confirm_time',expectedVersion:r.version})).reason,'AMENDMENT_NO_PROPOSED_TIME_TO_CONFIRM');
 const bad=harness({order:{...base,status:'proposed',proposed_time:'2026-11-12T20:15:00Z'},failAudit:true}),read=await bad.read();
 assert.equal((await bad.run({...input,action:'amend_confirm_time',expectedVersion:read.version})).success,false);assert.equal(bad.state.status,'proposed');
});
