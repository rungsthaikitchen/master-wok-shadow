'use strict';
// Staging bootstrap entrypoint template. A build step must bundle this module and
// the approved staging certificate; this file is NOT directly deployable.
const {readStagingBootstrapConfig}=require('./staging-secure-bootstrap-config');
function createStagingEdgeHandler({getEnv,certificate,sourceSha256,createDeploymentRuntime,
 createPool,model}={}){
 try{
  if(typeof createDeploymentRuntime!=='function'||typeof createPool!=='function'||
   !model||typeof model!=='object')
   throw Error('STAGING_RUNTIME_REQUIRED');
  const config=readStagingBootstrapConfig({getEnv,certificate,sourceSha256});
  const pool=createPool({connectionString:config.databaseUrl,max:3,connectionTimeoutMillis:10000});
  return createDeploymentRuntime({pool,model,certificate,sourceSha256,
   projectRef:config.projectRef,releaseId:config.releaseId,
   secret:config.secret,notificationSecret:config.notificationSecret,
   deliveryProjectRef:config.deliveryProjectRef,
   deliveryPublicKey:config.deliveryPublicKey,
   paymentsEnabled:config.paymentsEnabled,
   reviewApprovalsEnabled:config.reviewApprovalsEnabled});
 }catch(_){
  return ()=>Response.json({error:'RELEASE_NOT_CERTIFIED_OR_CONFIGURED'},
   {status:503,headers:{'Cache-Control':'no-store'}});
 }
}
module.exports={createStagingEdgeHandler};
