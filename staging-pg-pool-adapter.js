'use strict';
// Staging-only pool compatibility guard for an externally supplied pg-compatible driver.
// This module neither imports a database driver nor opens a connection.
function createStagingPoolFactory(Pool){
 if(typeof Pool!=='function')throw Error('PG_COMPATIBLE_POOL_REQUIRED');
 return function createPool({connectionString,max=3,connectionTimeoutMillis=10000}={}){
  if(typeof connectionString!=='string'||!/^postgres(?:ql)?:\/\//.test(connectionString))
   throw Error('STAGING_DATABASE_URL_REQUIRED');
  if(!Number.isInteger(max)||max<1||max>3||
     !Number.isInteger(connectionTimeoutMillis)||connectionTimeoutMillis<1000||connectionTimeoutMillis>30000)
   throw Error('STAGING_POOL_LIMITS_REQUIRED');
  const raw=new Pool({connectionString,max,connectionTimeoutMillis});
  if(typeof raw?.connect!=='function'||typeof raw?.query!=='function')
   throw Error('PG_COMPATIBLE_POOL_INTERFACE_REQUIRED');
  return {
   query:(sql,params)=>raw.query(sql,params),
   async connect(){
    const client=await raw.connect();
    if(typeof client?.query!=='function'||typeof client?.release!=='function')
     throw Error('PG_COMPATIBLE_CLIENT_INTERFACE_REQUIRED');
    let released=false;
    return {
     query:(sql,params)=>{
      if(released)throw Error('STAGING_CLIENT_ALREADY_RELEASED');
      return client.query(sql,params);
     },
     release:()=>{
      if(released)throw Error('STAGING_CLIENT_ALREADY_RELEASED');
      released=true;
      return client.release();
     }
    };
   },
   end:()=>typeof raw.end==='function'?raw.end():undefined
  };
 };
}
module.exports={createStagingPoolFactory};
