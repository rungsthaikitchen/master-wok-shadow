// Bounded pre-service migration rehearsal; never accesses the public schema.
import pg from 'npm:pg@8.23.1';
const {createPlanSeeder}=require('./master-wok-plan-seed');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {readBookingAvailability}=require('./master-wok-availability-reader');
const {catalog}=require('./master-wok-commercial');
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
require('./master-wok-model-bundle');
const TOKEN='__CERTIFICATION_TOKEN__',RUN='__BROWSER_RUN__',EXPIRES='__BROWSER_EXPIRES__';
const date='2026-11-05',schema='master_wok_rehearsal',prefix='seed-'+RUN+'-';
const rewrite=c=>({query:(sql,args)=>c.query(sql.replaceAll('public.orders',schema+'.orders')
 .replaceAll('public.order_items',schema+'.order_items').replaceAll('public.service_state',schema+'.service_state')
 .replaceAll('public.booking_blackouts',schema+'.booking_blackouts'),args)});
Deno.serve(async req=>{
 if(Deno.env.get('SUPABASE_URL')!=='https://hvrqgufqjslvgiohgkvu.supabase.co'||
  !/^[a-f0-9]{64}$/.test(TOKEN)||!/^[a-f0-9]{16}$/.test(RUN)||
  req.headers.get('authorization')!=='Bearer '+TOKEN)return new Response('Forbidden',{status:403});
 if(!Number.isFinite(Date.parse(EXPIRES))||Date.now()>Date.parse(EXPIRES))return new Response('Expired',{status:410});
 if(req.method!=='POST')return new Response('POST required',{status:405});
 const pool=new pg.Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:3,connectionTimeoutMillis:10000});
 const check=(ok,reason)=>{if(!ok)throw Error(reason);};
 let owns=false,result;
 try{
  const c=await pool.connect();
  try{
   await beginBookingTransaction(c,{serviceDates:[date]});
   const control=(await c.query(`SELECT mode,revision FROM ${schema}.master_wok_launch_control WHERE id=1`)).rows[0];
   check(control?.mode==='LEGACY'&&Number(control.revision)===6,'CONTROL_CHANGED');
   check(!(await c.query(`SELECT id FROM ${schema}.orders WHERE (coalesce(confirmed_time,preferred_time) AT TIME ZONE 'Europe/London')::date=$1::date`,[date])).rows.length,'DATE_NOT_EMPTY');
   check(!(await c.query(`SELECT service_date FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows.length,'PLAN_ALREADY_PRESENT');
   const baskets=[['green-curry','jasmine-rice','fish-cakes'],['pad-thai','fried-prawns','sticky-rice'],
    ['stir-crispy','egg-rice','veg-spring-rolls'],['panang-curry','coconut-rice','thai-sausage'],
    ['pad-see-ew','pork-dumplings','jasmine-rice'],['stir-basil','fried-egg','spare-ribs'],
    ['massaman-curry','jasmine-rice','chicken-satay'],['stir-cashew','sticky-rice','moo-ping'],
    ['pad-kee-mao','fried-tofu','jasmine-rice'],['red-curry','coconut-rice','fish-cakes'],
    ['stir-sweetsour','egg-rice','fried-prawns'],['panang-curry','jasmine-rice','veg-spring-rolls']];
   for(let i=0;i<baskets.length;i++){
    const ready=new Date(date+'T17:20:00Z');ready.setUTCMinutes(ready.getUTCMinutes()+i*20);
    const id=(await c.query(`INSERT INTO ${schema}.orders(status,created_at,preferred_time,confirmed_time,idempotency_key,capacity_scheduler) VALUES('confirmed','2026-11-03T12:00:00Z',$1,$1,$2,'LEGACY') RETURNING id`,[ready.toISOString(),prefix+i])).rows[0].id;
    for(const itemId of baskets[i]){
     const item=catalog.items.find(x=>x.id===itemId);check(!!item,'UNKNOWN_MENU_ITEM');
     await c.query(`INSERT INTO ${schema}.order_items(order_id,item_id,name,unit_price,qty,modifiers,spice) VALUES($1,$2,$3,9,1,'[]'::jsonb,1)`,[id,itemId,item.name||itemId]);
    }
   }
   await c.query('COMMIT');owns=true;
  }catch(e){try{await c.query('ROLLBACK');}catch(_){}throw e;}finally{c.release();}
  const seed=createPlanSeeder({pool,model:globalThis.MasterWokModelV1,releaseId:'seed-rehearsal-'+RUN,schema,
   readOrders:(c,d)=>readCapacityCommitments(rewrite(c),d),readAvailability:(c,d)=>readBookingAvailability(rewrite(c),d)});
  const dry=await seed({serviceDate:date,expectedRevision:6});check(dry.ok&&!dry.committed,'DRY_RUN_FAILED');
  check(!(await pool.query(`SELECT service_date FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows.length,'DRY_RUN_WROTE');
  const concurrent=await Promise.all([seed({serviceDate:date,expectedRevision:6,commit:true}),seed({serviceDate:date,expectedRevision:6,commit:true})]);
  check(concurrent.filter(r=>r.committed).length===1&&concurrent.filter(r=>r.reason==='SERVICE_PLAN_ALREADY_EXISTS').length===1,'CONCURRENT_SEED_FAILED');
  const saved=(await pool.query(`SELECT revision,plan FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0];
  check(Number(saved?.revision)===1,'PLAN_OVERWRITTEN');
  result={status:'PASS',scope:'REAL_PRIVATE_DATABASE_PRE_SERVICE_SEED',dryRun:dry,concurrent,
   existingLegacyOrders:12,basketLines:36,persistedPlanRevision:Number(saved.revision),productionWrites:0,notificationsSent:0};
 }catch(error){result={status:'FAIL',reason:['CONTROL_CHANGED','DATE_NOT_EMPTY','PLAN_ALREADY_PRESENT','DRY_RUN_FAILED','DRY_RUN_WROTE','CONCURRENT_SEED_FAILED','PLAN_OVERWRITTEN'].includes(error.message)?error.message:'SEED_REHEARSAL_FAILED',productionWrites:0};}
 finally{
  if(owns){
   const c=await pool.connect();
   try{
    await beginBookingTransaction(c,{serviceDates:[date]});
    const foreign=(await c.query(`SELECT id FROM ${schema}.orders WHERE (coalesce(confirmed_time,preferred_time) AT TIME ZONE 'Europe/London')::date=$1::date AND coalesce(idempotency_key,'') NOT LIKE $2`,[date,prefix+'%'])).rows;
    check(!foreign.length,'FOREIGN_ORDER_CLEANUP_REFUSED');
    await c.query(`DELETE FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date]);
    await c.query(`DELETE FROM ${schema}.orders WHERE idempotency_key LIKE $1`,[prefix+'%']);
    await c.query('COMMIT');result.fixtureCleanup=true;
   }catch(_){try{await c.query('ROLLBACK');}catch(_){}result.fixtureCleanup=false;result.status='FAIL';}finally{c.release();}
  }
  await pool.end();
 }
 return Response.json(result,{status:result.status==='PASS'?200:409});
});
