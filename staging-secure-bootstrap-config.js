'use strict';
// Staging-only bootstrap configuration helper. Not a standalone Edge Function.
// The bundle builder must supply a verified source digest and staging certificate.
const STAGING_PROJECT_REF='hvrqgufqjslvgiohgkvu';
const DELIVERY_PROJECT_REF='ubyjrrsvbbqomitpaidb';
function readStagingBootstrapConfig({getEnv,sourceSha256,certificate}={}){
 if(typeof getEnv!=='function')throw Error('STAGING_ENV_REQUIRED');
 const url=getEnv('SUPABASE_URL');
 if(url!=='https://'+STAGING_PROJECT_REF+'.supabase.co')throw Error('STAGING_PROJECT_REQUIRED');
 const projectRef=STAGING_PROJECT_REF;
 const releaseId=getEnv('MASTER_WOK_RELEASE_ID');
 const secret=getEnv('MASTER_WOK_BOOKING_SECRET');
 const notificationSecret=getEnv('MASTER_WOK_NOTIFICATION_SECRET');
 const deliveryProjectRef=getEnv('MASTER_WOK_DELIVERY_PROJECT_REF');
 const deliveryPublicKey=getEnv('MASTER_WOK_DELIVERY_PUBLIC_KEY');
 const databaseUrl=getEnv('SUPABASE_DB_URL');
 const paymentsFlag=getEnv('MASTER_WOK_PAYMENTS');
 const reviewsFlag=getEnv('MASTER_WOK_REVIEW_APPROVALS');
 if(typeof secret!=='string'||secret.length<32||
  typeof notificationSecret!=='string'||notificationSecret.length<32||
  secret===notificationSecret||
  typeof releaseId!=='string'||!releaseId||
  typeof databaseUrl!=='string'||!databaseUrl||
  typeof deliveryPublicKey!=='string'||!deliveryPublicKey||
  deliveryProjectRef!==DELIVERY_PROJECT_REF||
  !['enabled','disabled'].includes(paymentsFlag)||
  !['enabled','disabled'].includes(reviewsFlag)||
  !/^[a-f0-9]{64}$/.test(sourceSha256||'')||
  certificate?.status!=='CANDIDATE_FOR_STAGING'&&certificate?.status!=='CERTIFIED_FOR_STAGING'||
  certificate?.projectRef!==projectRef||
  certificate?.schema!=='master_wok_rehearsal'||
  certificate?.deliveryProjectRef!==deliveryProjectRef||
  certificate?.sourceSha256!==sourceSha256||
  certificate?.releaseId!==releaseId)
  throw Error('STAGING_BOOTSTRAP_NOT_CONFIGURED');
 return {projectRef,releaseId,secret,notificationSecret,deliveryProjectRef,
  deliveryPublicKey,databaseUrl,paymentsEnabled:paymentsFlag==='enabled',
  reviewApprovalsEnabled:reviewsFlag==='enabled',sourceSha256};
}
module.exports={readStagingBootstrapConfig};
