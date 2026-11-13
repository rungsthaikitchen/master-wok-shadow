// One-date private staging repair. Retains all orders, commitments and old plan
// in the audit. Never allowed on production, after work starts, or new sources.
import pg from 'npm:pg@8.23.1';
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {readBookingAvailability}=require('./master-wok-availability-reader');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {relativePlacement}=require('./master-wok-clock');
const {createDeliveryCapacity}=require('./master-wok-delivery-capacity');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {priceBasket}=require('./master-wok-commercial');
require('./master-wok-model-bundle');
const token='__CERTIFICATION_TOKEN__',expires=Number('__BROWSER_EXPIRES__'),date='2026-11-13',source='b64ff2df-d3ba-4863-a786-a65095626c58',key='8de2a5d2-2873-421d-8985-fbe5d9080f01';
const pool=new pg.Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:1});
const rewrite=c=>({query:(sql,args)=>c.query(sql.replaceAll('public.orders','master_wok_rehearsal.orders').replaceAll('public.order_items','master_wok_rehearsal.order_items').replaceAll('public.service_state','master_wok_rehearsal.service_state').replaceAll('public.booking_blackouts','master_wok_rehearsal.booking_blackouts'),args)});
Deno.serve(async req=>{
 if(Deno.env.get('SUPABASE_URL')!=='https://hvrqgufqjslvgiohgkvu.supabase.co'||Date.now()>expires||req.headers.get('x-master-wok-secret')!==token||req.method!=='POST')return Response.json({error:'Unavailable'},{status:403});
 let c;try{
 const {apply=false}=await req.json();c=await pool.connect();await beginBookingTransaction(c,{serviceDates:[date],key:'staging-plan-model-repair'});
 const prior=(await c.query('SELECT response FROM master_wok_rehearsal.order_amendments WHERE idempotency_key=$1',[key])).rows[0];if(prior){await c.query('ROLLBACK');return Response.json({...prior.response,replayed:true});}
 const now=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now;
 const stored=(await c.query('SELECT plan,revision FROM master_wok_rehearsal.master_wok_service_plans WHERE service_date=$1 FOR UPDATE',[date])).rows[0];
 if(Number(stored?.revision)!==1||stored.plan.modelVersion!=='combined-kitchen-protected-v3')throw Error('EXPECTED_OLD_PLAN_CHANGED');
 const clock=relativePlacement(now,date),minute=clock.getHours()*60+clock.getMinutes();
 if(new Date(now).toISOString().slice(0,10)!==date)throw Error('REPAIR_DATE_REQUIRED');
 const jobs=[...stored.plan.wok.jobs,...stored.plan.fryer.jobs,...stored.plan.auxiliary?.jobs||[]];
 if(jobs.some(j=>!Number.isFinite(j.start)||j.start<=minute)||(stored.plan.delivery?.trips||[]).length)throw Error('STARTED_OR_DELIVERY_WORK_REFUSED');
 const rows=await readCapacityCommitments(rewrite(c),date);
 if(rows.length!==1||rows[0].source_order_id!==source||!rows[0].idempotency_key.startsWith('release-nov6-delivery-')||rows[0].order_type!=='collection')throw Error('EXPECTED_SYNTHETIC_SOURCE_CHANGED');
 const orders=normalizeStagingOrders({rows,model:globalThis.MasterWokModelV1,serviceDate:date}).map(o=>({...o,placedAt:relativePlacement(o.placedAt,date)}));
 const availability=await readBookingAvailability(rewrite(c),date);
 const capacity=createDeliveryCapacity({stagingSharedRings:true,quoteLeg:async()=>{throw Error('EXTERNAL_ROUTE_REFUSED');}});
 const prepared=prepareStagingBasket({id:'availability-candidate',createdAt:now,serviceDate:date,readyMinute:1140,items:priceBasket([{item_id:'stir-pepper',qty:1,modifiers:[{id:'chicken'}],spice:1}]).items,model:globalThis.MasterWokModelV1});
 const proposedOrder={...prepared.candidate,placedAt:relativePlacement(now,date),items:prepared.rawRow.items,rawRow:prepared.rawRow,validatedHeader:{preferred_time:date+'T19:00:00Z',order_type:'collection'}};
 const before=await capacity.verify({assessmentPurpose:'AVAILABILITY_HINT',serviceDate:date,acceptedOrders:orders,rawRows:rows,state:{now,availability,previousPlan:stored.plan},proposedOrder},{maxSearchNodes:1000,maxCompleteChecks:8});
 const replanned=await capacity.replan({orders,rows,previousPlan:null,serviceDate:date,now,availability});
 if(replanned.status!=='VALIDATED_PROTECTED_PLAN'||replanned.plan?.modelVersion!=='combined-kitchen-four-ring-staging-v1')throw Error('NEW_PLAN_NOT_VALIDATED:'+replanned.reason);
 const after=await capacity.verify({assessmentPurpose:'AVAILABILITY_HINT',serviceDate:date,acceptedOrders:orders,rawRows:rows,state:{now,availability,previousPlan:replanned.plan},proposedOrder},{maxSearchNodes:1000,maxCompleteChecks:8});
 if(after.status!=='VERIFIED_KITCHEN_CAPACITY')throw Error('POST_REPAIR_PROBE_REFUSED:'+after.reason);
 const response={success:true,applied:apply,serviceDate:date,sourceOrders:1,oldModel:stored.plan.modelVersion,newModel:replanned.plan.modelVersion,before:{status:before.status,reason:before.reason},after:{status:after.status,reason:after.reason},notifications:0,productionMutations:0};
 if(!apply){await c.query('ROLLBACK');return Response.json(response);}
 await createServicePlanStore({schema:'master_wok_rehearsal'}).save(c,date,replanned.plan);
 const snapshot={id:source,status:rows[0].status,total:rows[0].total,order_type:rows[0].order_type};
 await c.query('INSERT INTO master_wok_rehearsal.order_amendments(order_id,idempotency_key,request_fingerprint,actor,reason,before_details,after_details,response) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)',[source,key,'staging-plan-model-upgrade-2026-11-13','david@rungsthaikitchen.co.uk','Repair incompatible old-model synthetic staging plan before work starts. Preserve existing order and commitment; rebuild using current four-ring model. No production changes.',JSON.stringify({...snapshot,servicePlan:stored.plan,planRevision:stored.revision}),JSON.stringify({...snapshot,servicePlan:replanned.plan,planRevision:Number(stored.revision)+1}),JSON.stringify(response)]);
 await c.query('COMMIT');return Response.json(response);
 }catch(e){if(c)await c.query('ROLLBACK');return Response.json({success:false,reason:e.message},{status:409});}finally{c?.release();}
});
