// Temporary fixture-only notification transport. No booking authority, provider
// credentials or public-schema access. Disable after the worker rehearsal.
import pg from 'npm:pg@8.23.1';
const {createNotificationDispatcher,createNotificationHttpHandler}=require('./master-wok-notification-dispatch');
if(Deno.env.get('SUPABASE_URL')!=='https://hvrqgufqjslvgiohgkvu.supabase.co')throw Error('PRIVATE_STAGING_REQUIRED');
const pool=new pg.Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:2,connectionTimeoutMillis:10000});
const handler=createNotificationHttpHandler({secret:'__CERTIFICATION_TOKEN__',
 dispatch:createNotificationDispatcher({pool,schema:'master_wok_rehearsal'})});
Deno.serve(handler);
