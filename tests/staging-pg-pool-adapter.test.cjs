'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createStagingPoolFactory}=require('../staging-pg-pool-adapter');
function fakePool(){
 const calls=[];let released=0;let constructed;
 class Pool{
  constructor(options){constructed=options;}
  query(sql,params){calls.push({via:'pool',sql,params});return Promise.resolve({rows:[]});}
  async connect(){
   return {
    query(sql,params){calls.push({via:'client',sql,params});return Promise.resolve({rows:[]});},
    release(){released++;}
   };
  }
  end(){return Promise.resolve();}
 }
 return {Pool,calls,get released(){return released;},get constructed(){return constructed;}};
}
const options={connectionString:'postgresql://placeholder.invalid/db',max:3,connectionTimeoutMillis:10000};
test('retains one client for begin, query, commit and releases once',async()=>{
 const fake=fakePool();
 const pool=createStagingPoolFactory(fake.Pool)(options);
 const client=await pool.connect();
 await client.query('BEGIN');
 await client.query('SELECT $1',[1]);
 await client.query('COMMIT');
 client.release();
 assert.deepEqual(fake.calls.map(x=>[x.via,x.sql]),[['client','BEGIN'],['client','SELECT $1'],['client','COMMIT']]);
 assert.equal(fake.released,1);
 assert.throws(()=>client.query('SELECT 1'),/STAGING_CLIENT_ALREADY_RELEASED/);
 assert.throws(()=>client.release(),/STAGING_CLIENT_ALREADY_RELEASED/);
});
test('supports rollback and independent pool queries',async()=>{
 const fake=fakePool();
 const pool=createStagingPoolFactory(fake.Pool)(options);
 const client=await pool.connect();
 await client.query('BEGIN');
 await client.query('ROLLBACK');
 client.release();
 await pool.query('SELECT 1');
 assert.deepEqual(fake.calls.map(x=>x.sql),['BEGIN','ROLLBACK','SELECT 1']);
});
test('rejects missing driver, invalid URL and excessive connection limits',()=>{
 assert.throws(()=>createStagingPoolFactory(null),/PG_COMPATIBLE_POOL_REQUIRED/);
 const make=createStagingPoolFactory(fakePool().Pool);
 assert.throws(()=>make({...options,connectionString:''}),/STAGING_DATABASE_URL_REQUIRED/);
 assert.throws(()=>make({...options,max:10}),/STAGING_POOL_LIMITS_REQUIRED/);
});
