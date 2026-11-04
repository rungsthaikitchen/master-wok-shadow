'use strict';
// Explicit opt-in PostgreSQL staging lock probe. No table changes or orders.
// Run with MW_STAGING_LOCK_TEST=YES and a staging-only PG connection URL.
// Uses two independent sessions and the same advisory key as the writer.
const assert=require('node:assert/strict');
const {URL}=require('node:url');
async function main(){
 if(process.env.MW_STAGING_LOCK_TEST!=='YES')throw Error('OPT_IN_REQUIRED');
 const raw=process.env.MW_STAGING_DATABASE_URL;
 if(!raw)throw Error('STAGING_DATABASE_URL_REQUIRED');
 const parsed=new URL(raw);
 if(!['postgres:','postgresql:'].includes(parsed.protocol))throw Error('INVALID_DB_PROTOCOL');
 const host=parsed.hostname.toLowerCase();
 const expected=(process.env.MW_STAGING_ALLOWED_HOST||'').toLowerCase();
 if(!expected||host!==expected)throw Error('STAGING_HOST_ALLOWLIST_REQUIRED_OR_MISMATCH');
 const {Client}=require('pg');
 const config={connectionString:raw,connectionTimeoutMillis:8000,query_timeout:8000};
 const a=new Client(config),b=new Client(config);
 let aOpen=false,bOpen=false;
 try{
  await a.connect();await b.connect();
  const first=await a.query('select current_database() as db, current_user as role, inet_server_addr()::text as server');
  console.log('Connected to explicitly allowlisted staging host; database='+first.rows[0].db);
  await a.query('BEGIN');aOpen=true;
  await b.query('BEGIN');bOpen=true;
  const serviceDate='2099-01-01';
  const sql='select pg_try_advisory_xact_lock(hashtextextended($1::text, 47822)) as acquired';
  assert.equal((await a.query(sql,[serviceDate])).rows[0].acquired,true,'first connection should acquire lock');
  assert.equal((await b.query(sql,[serviceDate])).rows[0].acquired,false,'second connection must not acquire same lock');
  await a.query('COMMIT');aOpen=false;
  assert.equal((await b.query(sql,[serviceDate])).rows[0].acquired,true,'second connection should acquire after release');
  await b.query('ROLLBACK');bOpen=false;
  console.log('PASS: independent staging sessions serialize the Master Wok date advisory lock');
 }finally{
  if(aOpen)await a.query('ROLLBACK').catch(()=>{});
  if(bOpen)await b.query('ROLLBACK').catch(()=>{});
  await Promise.allSettled([a.end(),b.end()]);
 }
}
main().catch(e=>{console.error('FAIL: '+e.message);process.exitCode=1;});
