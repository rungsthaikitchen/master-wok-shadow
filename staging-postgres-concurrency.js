'use strict';
// Optional staging-only PostgreSQL concurrency rehearsal.
// Requires: npm install --no-save pg
// Set STAGING_DATABASE_URL to the STAGING database only. Never production.
// Run: node staging-postgres-concurrency.js
const assert=require('node:assert/strict');
const {reserveWithMasterWok}=require('./master-wok-transaction-writer');
async function main(){
 const url=process.env.STAGING_DATABASE_URL;
 if(!url)throw Error('STAGING_DATABASE_URL_REQUIRED');
 const parsed=new URL(url);
 const host=parsed.hostname.toLowerCase();
 // Explicit guard: operator must acknowledge the intended staging target.
 if(process.env.CONFIRM_STAGING_ONLY!=='YES')throw Error('STAGING_CONFIRMATION_REQUIRED');
 if(!host||!host.includes('hvrqgufqjslvgiohgkvu')||host.includes('ubyjrrsvbbqomitpaidb'))throw Error('NOT_VERIFIED_STAGING_DATABASE_HOST');
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:url,max:2,connectionTimeoutMillis:10000});
 const serviceDate='2099-01-02'; // non-production rehearsal date
 const keyPrefix='staging-rehearsal-'+process.pid+'-';
 // Dedicated private schema: never expose test data through public REST APIs.
 const setup=await pool.connect();
 try{
  await setup.query('BEGIN');
  await setup.query('CREATE SCHEMA IF NOT EXISTS master_wok_rehearsal');
  await setup.query('CREATE TABLE IF NOT EXISTS master_wok_rehearsal.concurrent_bookings (key text primary key, service_date date not null)');
  await setup.query('REVOKE ALL ON SCHEMA master_wok_rehearsal FROM PUBLIC, anon, authenticated');
  await setup.query('REVOKE ALL ON TABLE master_wok_rehearsal.concurrent_bookings FROM PUBLIC, anon, authenticated');
  await setup.query('DELETE FROM master_wok_rehearsal.concurrent_bookings WHERE key LIKE $1',[keyPrefix+'%']);
  await setup.query('COMMIT');
 }catch(e){await setup.query('ROLLBACK');throw e;}finally{setup.release();}
 const run=async name=>{
  const conn=await pool.connect();
  try{return await reserveWithMasterWok({
   connection:conn,serviceDate,key:keyPrefix+name,candidate:{id:name},
   readCommitted:async c=>{
    const rows=await c.query('SELECT key FROM master_wok_rehearsal.concurrent_bookings WHERE service_date=$1 AND key LIKE $2',[serviceDate,keyPrefix+'%']);
    return {acceptedOrders:rows.rows};
   },
   assess:async({acceptedOrders})=>({status:acceptedOrders.length===0?'GREEN':'AMBER'}),
   persist:async(c,{key})=>{await c.query('INSERT INTO master_wok_rehearsal.concurrent_bookings (key,service_date) VALUES ($1,$2)',[key,serviceDate]);}
  });}finally{conn.release();}
 };
 try{
  const results=await Promise.all([run('a'),run('b')]);
  assert.equal(results.filter(x=>x.committed).length,1);
  const count=await pool.query('SELECT count(*)::integer AS n FROM master_wok_rehearsal.concurrent_bookings WHERE service_date=$1 AND key LIKE $2',[serviceDate,keyPrefix+'%']);
  assert.equal(count.rows[0].n,1);
  process.stdout.write('STAGING_POSTGRES_CONCURRENCY_PASS: one of two committed; second rejected after lock\\n');
 }finally{
  await pool.query('DELETE FROM master_wok_rehearsal.concurrent_bookings WHERE key LIKE $1',[keyPrefix+'%']);
  await pool.end();
 }
}
main().catch(e=>{process.stderr.write('STAGING_POSTGRES_CONCURRENCY_FAILED: '+e.message+'\\n');process.exitCode=1;});
