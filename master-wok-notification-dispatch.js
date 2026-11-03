'use strict';
// Provider calls happen outside database transactions. An expired send or unknown
// provider outcome is quarantined, never automatically resent. Explicit rejection
// may select the customer's fallback; accepted channels are never sent again.
const {lockKitchenWriter}=require('./master-wok-transaction-writer');
const UUID=/^[0-9a-f-]{36}$/i;
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function validMessage(m){return m&&['sms','email','pushover'].includes(m.channel)&&
 typeof m.body==='string'&&m.body.length>0&&m.body.length<=16000&&
 (m.channel==='pushover'?typeof m.title==='string':typeof m.recipient==='string'&&m.recipient.length<=320)&&
 (m.channel!=='email'||typeof m.subject==='string');}
function createNotificationDispatcher({pool,schema='public',orderKeyPrefix}={}){
 if(!pool||!['public','master_wok_rehearsal'].includes(schema))throw Error('INVALID_NOTIFICATION_CONFIGURATION');
 if(orderKeyPrefix!==undefined&&(schema!=='master_wok_rehearsal'||!/^[A-Za-z0-9-]{8,100}-$/.test(orderKeyPrefix)))
  throw Error('PRIVATE_NOTIFICATION_SCOPE_REQUIRED');
 const events='"'+schema+'".master_wok_notification_outbox',deliveries='"'+schema+'".master_wok_notification_deliveries';
 const scoped=parameter=>orderKeyPrefix?` AND EXISTS(SELECT 1 FROM "${schema}".orders scope_order WHERE scope_order.id=${events}.order_id AND scope_order.idempotency_key LIKE $${parameter})`:'';
 return async function dispatch(input){
  const connection=await pool.connect();
  try{
   await connection.query('BEGIN');await connection.query("SET LOCAL statement_timeout='10s'");
   // Same lock order as lifecycle: kitchen, then outbox/delivery/order rows.
   // Never hold an outbox row while waiting for a fenced order update.
   await connection.query("SET LOCAL lock_timeout='5s'");
   await lockKitchenWriter(connection);
   let response;
   if(input?.action==='claim'){
    const event=(await connection.query(`SELECT * FROM ${events} WHERE (
     (status='pending' AND next_attempt_at<=clock_timestamp()) OR
     (status='processing' AND leased_until<clock_timestamp()))${scoped(1)} ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,orderKeyPrefix?[orderKeyPrefix+'%']:[])).rows[0];
    if(!event){await connection.query('COMMIT');return {event:null};}
    if(event.status==='processing'){
     const expired=await connection.query(`UPDATE ${deliveries} SET status='uncertain' WHERE event_id=$1 AND status='sending' RETURNING id`,[event.id]);
     if(expired.rows.length){
      await connection.query(`UPDATE ${events} SET status='needs_attention',lease_token=null,leased_until=null WHERE id=$1`,[event.id]);
      await connection.query('COMMIT');return {event:null,attentionRequired:true};
     }
    }
    const order=(await connection.query(`SELECT status,is_test,confirm_token,confirmed_time,preferred_time FROM "${schema}".orders WHERE id=$1`,[event.order_id])).rows[0];
    const payload=event.payload;
    const stale=!order||order.is_test||!payload?.notification_mode||
     (payload.notification_mode==='time_suggested'&&(order.status!=='proposed'||order.confirm_token!==payload.confirm_token))||
     (payload.notification_mode==='time_confirmed'&&(order.status==='cancelled'||new Date(order.confirmed_time||order.preferred_time).getTime()!==new Date(payload.preferred_time).getTime()))||
     (payload.notification_mode==='order_created'&&['cancelled','declined','rejected'].includes(order.status));
    if(stale){await connection.query(`UPDATE ${events} SET status='skipped',lease_token=null,leased_until=null WHERE id=$1`,[event.id]);
     await connection.query('COMMIT');return {event:null,skipped:true};}
    const token=crypto.randomUUID();
    await connection.query(`UPDATE ${events} SET status='processing',lease_token=$2,leased_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1 WHERE id=$1`,[event.id,token]);
    response={event:{id:event.id,token,payload,prepared:!!event.prepared_messages}};
   }else{
    if(!UUID.test(input?.eventId||'')||!UUID.test(input?.token||''))throw Error('INVALID_NOTIFICATION_CLAIM');
    const event=(await connection.query(`SELECT *,leased_until>clock_timestamp() AS lease_valid FROM ${events} WHERE id=$1${scoped(2)} FOR UPDATE`,orderKeyPrefix?[input.eventId,orderKeyPrefix+'%']:[input.eventId])).rows[0];
    if(!event||event.lease_token!==input.token||event.status!=='processing'||!event.lease_valid)throw Error('NOTIFICATION_LEASE_EXPIRED');
    if(input.action==='prepare'){
     const messages=input.messages;
     if(!Array.isArray(messages)||!messages.length||messages.length>20||new Set(messages.map(m=>m.key)).size!==messages.length||
      messages.some(m=>!/^[-a-z0-9_]{1,80}$/.test(m.key)||!validMessage(m.primary)||(m.fallback&&!validMessage(m.fallback))))throw Error('INVALID_NOTIFICATION_MESSAGES');
     if(event.prepared_messages&&stable(event.prepared_messages)!==stable(messages))throw Error('NOTIFICATION_MANIFEST_CONFLICT');
     if(!event.prepared_messages){
      const priorStaff=(await connection.query(`SELECT staff_notified_at FROM "${schema}".orders WHERE id=$1`,[event.order_id])).rows[0]?.staff_notified_at;
      for(const m of messages)await connection.query(`INSERT INTO ${deliveries}(event_id,delivery_key,message,fallback,status) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)`,[event.id,m.key,JSON.stringify(m.primary),m.fallback?JSON.stringify(m.fallback):null,m.key==='staff_push'&&priorStaff?'sent':'pending']);
      await connection.query(`UPDATE ${events} SET prepared_messages=$2::jsonb WHERE id=$1`,[event.id,JSON.stringify(messages)]);
     }
     response={ok:true};
    }else if(input.action==='next'){
     if(!event.prepared_messages)throw Error('NOTIFICATION_PREPARATION_REQUIRED');
     const delivery=(await connection.query(`SELECT * FROM ${deliveries} WHERE event_id=$1 AND
      status IN ('pending','failed') AND next_attempt_at<=clock_timestamp() ORDER BY delivery_key LIMIT 1 FOR UPDATE`,[event.id])).rows[0];
     if(delivery){
      await connection.query(`UPDATE ${deliveries} SET status='sending',attempts=attempts+1 WHERE id=$1`,[delivery.id]);
      await connection.query(`UPDATE ${events} SET leased_until=clock_timestamp()+interval '5 minutes' WHERE id=$1`,[event.id]);
      response={delivery:{id:delivery.id,message:delivery.message}};
     }else{
      const state=(await connection.query(`SELECT status FROM ${deliveries} WHERE event_id=$1`,[event.id])).rows;
      // A sending row means the worker lost its result; do not lease another
      // channel or finish until its result is recorded or its lease expires.
      if(state.some(r=>r.status==='sending'))throw Error('NOTIFICATION_RESULT_REQUIRED');
      const status=state.every(r=>r.status==='sent')?'sent':state.some(r=>r.status==='uncertain')?'needs_attention':'pending';
      await connection.query(`UPDATE ${events} SET status=$2,lease_token=null,leased_until=null,
       next_attempt_at=clock_timestamp()+interval '1 minute',sent_at=CASE WHEN $2='sent' THEN clock_timestamp() ELSE null END WHERE id=$1`,[event.id,status]);
      response={delivery:null,status};
     }
    }else if(input.action==='result'){
     if(!UUID.test(input.deliveryId||'')||!['sent','failed','uncertain'].includes(input.outcome))throw Error('INVALID_NOTIFICATION_RESULT');
     const d=(await connection.query(`SELECT * FROM ${deliveries} WHERE id=$1 AND event_id=$2 FOR UPDATE`,[input.deliveryId,event.id])).rows[0];
     if(!d)throw Error('NOTIFICATION_DELIVERY_NOT_FOUND');
     if(d.status===input.outcome){response={ok:true,replayed:true};}
     else{
      if(d.status!=='sending')throw Error('NOTIFICATION_RESULT_CONFLICT');
      if(input.outcome==='failed'&&d.fallback){
       await connection.query(`UPDATE ${deliveries} SET message=fallback,fallback=null,status='pending',attempts=0 WHERE id=$1`,[d.id]);
      }else{
       const status=input.outcome==='failed'&&d.attempts>=3?'uncertain':input.outcome;
       await connection.query(`UPDATE ${deliveries} SET status=$2,provider_id=$3,next_attempt_at=clock_timestamp()+interval '1 minute' WHERE id=$1`,[d.id,status,typeof input.providerId==='string'?input.providerId.slice(0,200):null]);
       if(d.delivery_key==='staff_push')await connection.query(`UPDATE "${schema}".orders SET
        staff_notify_attempts=coalesce(staff_notify_attempts,0)+1,
        staff_notified_at=CASE WHEN $2='sent' THEN coalesce(staff_notified_at,clock_timestamp()) ELSE staff_notified_at END,
        staff_notify_error=CASE WHEN $2='sent' THEN null ELSE 'Master Wok notification requires retry or review' END WHERE id=$1`,[event.order_id,input.outcome]);
      }
      response={ok:true};
     }
    }else throw Error('INVALID_NOTIFICATION_ACTION');
   }
   await connection.query('COMMIT');return response;
  }catch(error){try{await connection.query('ROLLBACK');}catch(_){}throw error;}
  finally{connection.release();}
 };
}
function createNotificationHttpHandler({secret,dispatch}={}){
 if(typeof secret!=='string'||secret.length<32||typeof dispatch!=='function')throw Error('NOTIFICATION_SECRET_REQUIRED');
 return async request=>{
  const digest=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  const supplied=request.headers.get('x-master-wok-notification-secret')||'';
  if(supplied.length>256)return new Response('Forbidden',{status:401});
  const [a,b]=await Promise.all([digest(secret),digest(supplied)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  if(diff)return new Response('Forbidden',{status:401});
  if(request.method!=='POST')return new Response('POST required',{status:405});
  try{
   const body=await request.text();if(new TextEncoder().encode(body).length>131072)return new Response('Too large',{status:413});
   return Response.json(await dispatch(JSON.parse(body)),{headers:{'Cache-Control':'no-store'}});
  }catch(_){return Response.json({error:'NOTIFICATION_OPERATION_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store'}});}
 };
}
module.exports={createNotificationDispatcher,createNotificationHttpHandler};
