'use strict';
const fs=require('node:fs');
const path=require('node:path');
function assertSecureStagingBundle(source){
 if(typeof source!=='string'||!source.trim())throw Error('BUNDLE_MISSING');
 if(/privateStagingConfiguration/.test(source))throw Error('EMBEDDED_STAGING_CONFIG_FORBIDDEN');
 if(/(?:MASTER_WOK_BOOKING_SECRET|MASTER_WOK_NOTIFICATION_SECRET)\s*["']?\s*:\s*["']/.test(source))
  throw Error('EMBEDDED_SECRET_FORBIDDEN');
 if(/(?:MASTER_WOK_BOOKING_SECRET|MASTER_WOK_NOTIFICATION_SECRET)["']?\s*,?\s*\)/.test(source))
  throw Error('SUSPICIOUS_SECRET_BOOTSTRAP');
 if(!source.includes("Deno.env.get"))throw Error('ENVIRONMENT_BOOTSTRAP_REQUIRED');
 if(!source.includes("RELEASE_NOT_CERTIFIED_OR_CONFIGURED"))throw Error('FAIL_CLOSED_RESPONSE_REQUIRED');
 return true;
}
if(require.main===module){
 const file=process.argv[2];
 if(!file)throw Error('USAGE: node scripts/assert-secure-staging-bundle.cjs <generated-index.ts>');
 assertSecureStagingBundle(fs.readFileSync(path.resolve(file),'utf8'));
 console.log('Staging bundle static security checks PASS');
}
module.exports={assertSecureStagingBundle};
