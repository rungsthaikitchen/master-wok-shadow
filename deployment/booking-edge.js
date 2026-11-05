// Deployable transport, still disabled by the committed DRAFT certificate.
// No fixture authorization, test identity or cleanup operation exists here.
import pg from 'npm:pg@8.23.1';
const {createDeploymentRuntime}=require('./master-wok-deployment');
const certificate=require('./master-wok-release-candidate.json');
require('./master-wok-model-bundle');
let handler;
try{
 const url=Deno.env.get('SUPABASE_URL')||'';
 const privateStagingConfiguration=__RUNTIME_CONFIGURATION__;
 if(Object.keys(privateStagingConfiguration).length&&url!=='https://hvrqgufqjslvgiohgkvu.supabase.co')
  throw Error('PRIVATE_STAGING_CONFIGURATION_ONLY');
 const getEnv=name=>Object.hasOwn(privateStagingConfiguration,name)?privateStagingConfiguration[name]:Deno.env.get(name);
 const projectRef=url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
 if(!projectRef)throw Error('INVALID_PROJECT');
 const pool=new pg.Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:3,connectionTimeoutMillis:10000});
 handler=createDeploymentRuntime({pool,model:globalThis.MasterWokModelV1,certificate,
  sourceSha256:'__RUNTIME_SOURCE_SHA256__',projectRef,
  releaseId:getEnv('MASTER_WOK_RELEASE_ID'),secret:getEnv('MASTER_WOK_BOOKING_SECRET'),
  deliveryProjectRef:getEnv('MASTER_WOK_DELIVERY_PROJECT_REF')||projectRef,
  notificationSecret:getEnv('MASTER_WOK_NOTIFICATION_SECRET'),
  deliveryPublicKey:getEnv('MASTER_WOK_DELIVERY_PUBLIC_KEY')});
}catch(_){
 handler=()=>Response.json({error:'RELEASE_NOT_CERTIFIED_OR_CONFIGURED'},
  {status:503,headers:{'Cache-Control':'no-store'}});
}
Deno.serve(handler);
