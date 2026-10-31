'use strict';
// Real staging PostgreSQL end-to-end booking seam rehearsal.
// Reads public staging orders only; writes test records to private rehearsal schema.
// Requires STAGING_DATABASE_URL, CONFIRM_STAGING_ONLY=YES, and pg.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {bookStagingCandidate}=require('./staging-booking-integration');
async function main(){
 const raw=process.env.STAGING_DATABASE_URL;
 if(!raw)throw Error('STAGING_DATABASE_URL_REQUIRED');
 if(process.env.CONFIRM_STAGING_ONLY!=='YES')throw Error('STAGING_CONFIRMATION_REQUIRED');
 const url=new URL(raw),host=url.hostname.toLowerCase(),user=decodeURIComponent(url.username);
 const ref='hvrqgufqjslvgiohgkvu';
 const direct=host==='db.'+ref+'.supabase.co'&&user==='postgres';
 const pooler=/^aws-[0-9]+-[a-z0-9-]+[.]pooler[.]supabase[.]com$/.test(host)&&user==='postgres.'+ref;
 if(!direct&&!pooler)throw Error('NOT_VERIFIED_STAGING_DATABASE_HOST_OR_USER');
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:raw,max:2,connectionTimeoutMillis:10000});
 const date='2099-01-02',prefix='booking-integration-'+randomUUID()+'-';
 let prepared=false;
 try{
  // Private schema is never exposed through checkout or public REST APIs.
  const setup=await pool.connect();
  try{
   await setup.query('BEGIN');
   await setup.query('CREATE SCHEMA IF NOT EXISTS master_wok_rehearsal');
   await setup.query('CREATE TABLE IF NOT EXISTS master_wok_rehearsal.booking_integration (key text primary key, service_date date not null, fingerprint text not null)');
   await setup.query('REVOKE ALL ON SCHEMA master_wok_rehearsal FROM PUBLIC, anon, authenticated');
   await setup.query('REVOKE ALL ON TABLE master_wok_rehearsal.booking_integration FROM PUBLIC, anon, authenticated');
   await setup.query('COMMIT');
   prepared=true;
  }catch(e){await setup.query('ROLLBACK');throw e;}finally{setup.release();}
  const model={classifyBasket:()=>({})};
  const engine={assessCapacityV1:()=>({status:'GREEN'})};
  const candidate={orderId:prefix+'candidate',placedAt:'2099-01-02T17:00:00Z',readyMinute:1140};
  const run=async(mode,key,masterWokAssess)=>{
   const conn=await pool.connect();
   try{return await bookStagingCandidate({
    connection:conn,serviceDate:date,key,candidate,model,engine,bookingMode:mode,masterWokAssess,
    lookupKey:async(c,k)=>{
     const r=await c.query('SELECT fingerprint FROM master_wok_rehearsal.booking_integration WHERE key=$1',[k]);
     return r.rows[0]||null;
    },
    persist:async(c,{key,serviceDate,fingerprint})=>{
     await c.query('INSERT INTO master_wok_rehearsal.booking_integration (key,service_date,fingerprint) VALUES ($1,$2,$3)',[key,serviceDate,fingerprint]);
    }
   });}finally{conn.release();}
  };
  // First prove shadow assessment cannot write.
  const shadow=await run('MASTER_WOK',prefix+'shadow',async()=>({status:'COORDINATED_PROTOTYPE',bookingApprovalAllowed:false}));
  assert.equal(shadow.committed,false,'shadow must not commit');
  const legacy=await run('LEGACY',prefix+'legacy');
  assert.equal(legacy.committed,true,'legacy should commit test-only reservation');
  const replay=await run('LEGACY',prefix+'legacy');
  assert.equal(replay.committed,false,'replay must not duplicate');
  assert.equal(replay.reason,'REPLAY');
  const rows=await pool.query('SELECT key FROM master_wok_rehearsal.booking_integration WHERE key LIKE $1',[prefix+'%']);
  assert.deepEqual(rows.rows.map(r=>r.key),[prefix+'legacy'],'only legacy rehearsal record may exist');
  process.stdout.write('STAGING_BOOKING_INTEGRATION_PASS: real staging read, locked legacy commit, idempotent replay, shadow rollback\n');
 }finally{
  try{
   if(prepared)await pool.query('DELETE FROM master_wok_rehearsal.booking_integration WHERE key LIKE $1',[prefix+'%']);
  }finally{await pool.end();}
 }
}
main().catch(e=>{process.stderr.write('STAGING_BOOKING_INTEGRATION_FAILED: '+e.message+'\n');process.exitCode=1;});
