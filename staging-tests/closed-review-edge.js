// Fixed private staging SQL rehearsal. Every change is rolled back; no provider
// or booking/notification writer is imported or called.
import pg from 'npm:pg@8.23.1';
const {createBasketReviewStore}=require('./master-wok-basket-review');
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
const TOKEN_HASH='__CERTIFICATION_TOKEN__',EXPIRES='__BROWSER_EXPIRES__';
Deno.serve(async request=>{
 const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST'||Deno.env.get('SUPABASE_URL')!=='https://hvrqgufqjslvgiohgkvu.supabase.co'||Date.now()>Date.parse(EXPIRES))return reply({error:'DISABLED'},403);
 const token=request.headers.get('x-rehearsal-token')||'';
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 if(!/^[a-f0-9]{64}$/.test(token)||digest!==TOKEN_HASH)return reply({error:'UNAUTHORIZED'},401);
 const pool=new pg.Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:1,connectionTimeoutMillis:10000});let c;const checks=[],keys=[];
 const check=(ok,name)=>{if(!ok)throw Error(name);checks.push(name);};
 const input=time=>{const requestKey=crypto.randomUUID();keys.push(requestKey);return {requestKey,orderType:'collection',customer:{name:'Private closed-review fixture',phone:'07700900123'},preferredTime:'2026-12-12T'+time+':00Z',items:[{item_id:'chips',qty:1,modifiers:[]}]};};
 try{
  c=await pool.connect();await beginBookingTransaction(c);
  const blackout=(await c.query("INSERT INTO master_wok_rehearsal.booking_blackouts(kind,start_at,end_at,active,message) VALUES('closed','2026-12-12T16:30:00Z','2026-12-12T22:30:00Z',true,'Private rollback fixture') RETURNING id")).rows[0].id;
  const save=createBasketReviewStore({schema:'master_wok_rehearsal',pool:{query:(sql,args)=>c.query(sql,args)},assessReview:async()=>{throw Error('Diagnostic intentionally unavailable');}});
  const denied=await save(input('20:00'));check(denied.reason==='REVIEW_TIME_CLOSED'&&denied.statusCode===409,'closure_rejected_despite_diagnostic_failure');
  check(!(await c.query('SELECT id FROM master_wok_rehearsal.master_wok_basket_reviews WHERE request_key=$1',[keys[0]])).rows.length,'closed_review_not_saved');
  check((await save(input('16:30'))).reason==='REVIEW_TIME_CLOSED','closure_start_inclusive');
  check((await save(input('22:30'))).success===true,'closure_end_exclusive');
  await c.query("UPDATE master_wok_rehearsal.booking_blackouts SET kind='fully_booked' WHERE id=$1",[blackout]);
  const requestBody=input('20:00'),accepted=await save(requestBody);check(accepted.success===true,'fully_booked_review_allowed');
  await c.query("UPDATE master_wok_rehearsal.booking_blackouts SET kind='closed' WHERE id=$1",[blackout]);
  const replay=await save(requestBody);check(replay.success&&replay.reviewId===accepted.reviewId,'existing_identical_review_replays_after_closure');
  const conflict=await save({...requestBody,customer:{name:'Different fixture',phone:'07700900123'}});check(conflict.reason==='REVIEW_REQUEST_KEY_CONFLICT','closed_replay_still_checks_identity');
  await c.query('UPDATE master_wok_rehearsal.booking_blackouts SET active=false WHERE id=$1',[blackout]);
  check((await save(input('20:00'))).success===true,'inactive_closure_ignored');
  const changed=createBasketReviewStore({schema:'master_wok_rehearsal',pool:{query:(sql,args)=>c.query(sql,args)},assessReview:async()=>{
   await c.query('UPDATE master_wok_rehearsal.booking_blackouts SET active=true WHERE id=$1',[blackout]);
   return {success:true,hints:[{available:true}]};
  }});
  check((await changed(input('20:00'))).reason==='REVIEW_TIME_CLOSED','closure_rechecked_after_assessment');
  await c.query('ROLLBACK');
  check(!(await c.query('SELECT id FROM master_wok_rehearsal.master_wok_basket_reviews WHERE request_key=ANY($1::uuid[])',[keys])).rows.length,'no_reviews_persisted');
  check(!(await c.query('SELECT id FROM master_wok_rehearsal.booking_blackouts WHERE id=$1',[blackout])).rows.length,'no_closures_persisted');
  return reply({success:true,checks,notificationsSent:0,persistentReviews:0});
 }catch(error){return reply({success:false,checks,error:error.message},500);}
 finally{if(c){try{await c.query('ROLLBACK');}catch(_){}c.release();}await pool.end();}
});
