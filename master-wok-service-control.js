'use strict';
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const modes={normal:0,busy:0.5,very_busy:1,paused:0};
function instant(value){
 if(typeof value!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))
  throw Error('INVALID_CONTROL_TIME');
 return new Date(value).toISOString();
}
function text(value){
 if(value==null||value==='')return null;
 if(typeof value!=='string'||value.length>2000)throw Error('INVALID_CONTROL_MESSAGE');
 return value.trim()||null;
}
function createServiceControlWriter({pool,schema='public',assertWriteAllowed}={}){
 if(!pool||typeof pool.connect!=='function'||typeof assertWriteAllowed!=='function'||
  !['public','master_wok_rehearsal'].includes(schema))throw Error('INVALID_SERVICE_CONTROL_CONFIGURATION');
 const table=name=>'"'+schema+'".'+name;
 return async function control(input){
  if(!input||!['set_service_state','create_blackout','deactivate_blackout'].includes(input.action))
   return {ok:false,committed:false,statusCode:400,reason:'UNSUPPORTED_SERVICE_CONTROL_ACTION'};
  let connection;
  try{
   connection=await pool.connect();await beginBookingTransaction(connection);
   await assertWriteAllowed(connection);
   let result;
   if(input.action==='set_service_state'){
    if(!Object.hasOwn(modes,input.mode))throw Error('INVALID_SERVICE_MODE');
    result=await connection.query(`UPDATE ${table('service_state')} SET mode=$1,capacity_throttle=$2,
     customer_message=$3,effective_until=$4,updated_at=clock_timestamp() WHERE id=1 RETURNING *`,
     [input.mode,modes[input.mode],text(input.customer_message),input.effective_until?instant(input.effective_until):null]);
   }else if(input.action==='create_blackout'){
    if(!['closed','fully_booked'].includes(input.kind))throw Error('INVALID_BLACKOUT_KIND');
    const start=instant(input.start_at),end=instant(input.end_at);
    if(end<=start)throw Error('INVALID_BLACKOUT_RANGE');
    result=await connection.query(`INSERT INTO ${table('booking_blackouts')}(kind,start_at,end_at,message,active)
     VALUES($1,$2,$3,$4,true) RETURNING *`,[input.kind,start,end,text(input.message)]);
   }else{
    if(!UUID.test(input.blackout_id||''))throw Error('INVALID_BLACKOUT_ID');
    result=await connection.query(`UPDATE ${table('booking_blackouts')} SET active=false WHERE id=$1 RETURNING *`,[input.blackout_id]);
   }
   if(result.rows.length!==1){await connection.query('ROLLBACK');return {ok:false,committed:false,statusCode:404,reason:'CONTROL_RECORD_NOT_FOUND'};}
   await connection.query('COMMIT');
   return {ok:true,committed:true,[input.action==='set_service_state'?'service_state':'blackout']:result.rows};
  }catch(error){
   if(connection)try{await connection.query('ROLLBACK');}catch(_){}
   const validation=/^INVALID_(CONTROL_|SERVICE_MODE|BLACKOUT_)/.test(error.message||'');
   return {ok:false,committed:false,statusCode:validation?400:503,
    reason:validation?error.message:'SERVICE_CONTROL_UNAVAILABLE'};
  }finally{connection?.release();}
 };
}
module.exports={createServiceControlWriter};
