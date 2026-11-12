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
function harness({order=base,payment=null,assessment=true,failAudit=false}={}){
 let state=structuredClone(order),backup,audit=[],queries=[],saves=0;
 const c={release(){},async query(sql,args=[]){queries.push(sql);
  if(sql==='BEGIN')backup=structuredClone(state);
  if(sql==='ROLLBACK')state=backup;
  if(sql.startsWith('SELECT request_fingerprint'))return {rows:audit.filter(x=>x.key===args[0])};
  if(sql.startsWith('SELECT * FROM "public".orders'))return {rows:[structuredClone(state)]};
  if(sql.startsWith('SELECT id FROM "public".order_payments'))return {rows:payment?[payment]:[]};
  if(sql.startsWith('SELECT actor,reason'))return {rows:[]};
  if(sql.startsWith('SELECT clock_timestamp'))return {rows:[{now}]};
  if(sql.startsWith('SELECT * FROM "public".discount_codes'))return {rows:[discount]};
  if(sql.startsWith('UPDATE "public".orders')){const fields=[...sql.matchAll(/"([a-z_]+)"=\$/g)].map(m=>m[1]);fields.forEach((k,i)=>state[k]=args[i+1]);}
  if(sql.startsWith('INSERT INTO "public".order_amendments')){if(failAudit)throw Error('AUDIT_DOWN');audit.push({key:args[1],request_fingerprint:args[2],response:JSON.parse(args[7])});}
  return {rows:[]};}};
 const run=createAmendmentWriter({pool:{connect:async()=>c},assertWriteAllowed:async()=>{},quoteDelivery:async()=>quote,assessMutation:async()=>assessment?{status:'GREEN',bookingApprovalAllowed:true,plansByDate:{'2026-11-12':{ok:true}}}:{status:'RED'},planStore:{read:async()=>null,save:async()=>saves++}});
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
test('stale order, paid order, completed order and failed capacity refuse without a commit',async()=>{
 for(const order of [{...base,paid:true},{...base,loyalty_settled:true},{...base,status:'completed'}]){const h=harness({order});assert.equal((await h.read()).success,false);assert.ok(!h.queries.includes('COMMIT'));}
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
