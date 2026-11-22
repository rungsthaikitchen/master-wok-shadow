'use strict';
// A strict interface gate for the future Edge adapter. No connection is opened here.
function assertStagingEdgeAdapter({getEnv,createPool,serve,model,certificate,sourceSha256}={}){
 if(typeof getEnv!=='function'||typeof createPool!=='function'||typeof serve!=='function')
  throw Error('EDGE_ADAPTER_REQUIRED');
 if(!model||typeof model!=='object'||!certificate||typeof certificate!=='object')
  throw Error('EDGE_MODEL_AND_CERTIFICATE_REQUIRED');
 if(certificate.projectRef!=='hvrqgufqjslvgiohgkvu'||
    certificate.schema!=='master_wok_rehearsal'||
    certificate.deliveryProjectRef!=='ubyjrrsvbbqomitpaidb'||
    !['CANDIDATE_FOR_STAGING','CERTIFIED_FOR_STAGING'].includes(certificate.status)||
    !/^[a-f0-9]{64}$/.test(sourceSha256||'')||
    certificate.sourceSha256!==sourceSha256)
  throw Error('EDGE_STAGING_CERTIFICATE_REQUIRED');
 return true;
}
module.exports={assertStagingEdgeAdapter};
