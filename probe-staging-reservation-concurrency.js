'use strict';
// Explicitly opt-in, staging-only, two-connection reservation test.
// Creates and drops an isolated probe table. Does not touch orders/order_items.
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {URL}=require('node:url');
const {reserveWithMasterWok}=require('./master-wok-transaction-writer');
async function main(){
 if(process.env.MW_STAGING_RESERVATION_TEST!=='YES')throw Error('RESERVATION_TEST_OPT_IN_REQUIRED');
 const raw=process.env.MW_STAGING_DATABASE_URL;
 if(!raw)throw Error('STAGING_DATABASE_URL_REQUIRED');
 const url=new URL(raw);
 const expected=(process.env.MW_STAGING_ALLOWED_HOST||'').toLowerCase();
 if(!['postgres:','postgresql:'].includes(url.protocol)||!expected||url.hostname.toLowerCase()!==expected)
  throw Error('STAGING_HOST_ALLOWLIST_REQUIRED_OR_MISMATCH');
 const {Client}=require('pg');
 const config={connectionString:raw,connectionTimeoutMillis:8000,query_timeout:8000};
 const setup=new Client(config),a=new Client(config),b=new Client(config);
 const table='mw_concurrency_probe_'+randomBytes(6).toString('hex');
 const qualified='public.'+table;
 let created=false;
 let releaseFirst,firstPersisted;
 const allowFirst=new Promise(resolve=>releaseFirst=resolve);
 const firstReachedPersist=new Promise(resolve=>firstPersisted=resolve);
 try{
  await setup.connect();await a.connect();await b.connect();
  await setup.query('CREATE TABLE '+qualified+' (booking_key text PRIMARY KEY, service_date text NOT NULL)');
  created=true;
  const serviceDate='2099-01-01';
  const readCommitted=async(conn)=>{
   const result=await conn.query('SELECT booking_key FROM '+qualified+' WHERE service_date=$1',[serviceDate]);
   return {acceptedOrders:result.rows,existingKey:null};
  };
  const assess=async({acceptedOrders})=>({status:acceptedOrders.length===0?'GREEN':'AMBER'});
  const persist=async(conn,{key})=>{
   await conn.query('INSERT INTO '+qualified+' (booking_key,service_date) VALUES ($1,$2)',[key,serviceDate]);
   if(key==='customer-a'){firstPersisted();await allowFirst;}
  };
  const shared={serviceDate,readCommitted,assess,persist};
  const first=reserveWithMasterWok({...shared,connection:a,key:'customer-a',candidate:{id:'a'}});
  await firstReachedPersist;
  // Begin B while A still holds its date lock; B must not read until A commits.
  let secondStarted;
  const secondBegan=new Promise(resolve=>secondStarted=resolve);
  const bConnection={query:async(sql,params)=>{
   const result=await b.query(sql,params);
   if(sql==='BEGIN')secondStarted();
   return result;
  }};
  const second=reserveWithMasterWok({...shared,connection:bConnection,key:'customer-b',candidate:{id:'b'}});
  await secondBegan;
  // Give B an opportunity to attempt the lock while A is still in flight.
  await new Promise(resolve=>setTimeout(resolve,150));
  releaseFirst();
  const [firstResult,secondResult]=await Promise.all([first,second]);
  assert.equal(firstResult.committed,true,'first booking should commit');
  assert.equal(secondResult.committed,false,'second booking must not commit');
  assert.equal(secondResult.status,'AMBER','second booking should detect occupied capacity');
  const rows=await setup.query('SELECT booking_key FROM '+qualified);
  assert.deepEqual(rows.rows.map(r=>r.booking_key),['customer-a']);
  console.log('PASS: two staging reservations serialize; second sees first commitment and cannot double-book');
 }finally{
  if(releaseFirst)releaseFirst();
  if(created)await setup.query('DROP TABLE IF EXISTS '+qualified).catch(e=>console.error('CLEANUP REQUIRED: '+qualified+'; '+e.message));
  await Promise.allSettled([a.end(),b.end(),setup.end()]);
 }
}
main().catch(e=>{console.error('FAIL: '+e.message);process.exitCode=1;});
