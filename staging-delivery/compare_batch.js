'use strict';
// Fixed local bridge: no provider, HTTP client, credentials or database writer.
const fs=require('node:fs');
const {createStagingComparison}=require('../master-wok-delivery-comparison');
const CASE_KEYS=['COMBINED_CLEAR','SEPARATE_TARGETS','COLLECTION_BUSY','DRIVER_BUSY','MISSING_REVERSE_LEG','UNACKNOWLEDGED_PROPOSAL'];
function compareBatch(input) {
 if(!input || !Array.isArray(input.cases)||input.cases.length<1||input.cases.length>50)throw Error('CASE_LIMIT');
 const seen=new Set(),records=[];
 for(const c of input.cases){
  if(!c||typeof c.caseKey!=='string'||seen.has(c.caseKey)||
    !Array.isArray(c.source?.candidateIds)||c.source.candidateIds.length<1||c.source.candidateIds.length>2||
    new Set(c.source.candidateIds).size!==c.source.candidateIds.length)throw Error('INVALID_CASE');
  seen.add(c.caseKey);
  const result=createStagingComparison(c.caseKey,c.source,{enabled:true});
  if(result.records.length!==c.source.candidateIds.length)throw Error('INCOMPLETE_COMPARISON');
  if(!['RECOMMENDED','UNVERIFIED'].includes(c.expectedPrediction)||
    ![null,'COMBINED','SEPARATE'].includes(c.expectedKind)||
    result.records.some(r=>r.prediction!==c.expectedPrediction||r.planKind!==c.expectedKind))throw Error('REHEARSAL_REGRESSION');
  records.push(...result.records);
 }
 if(seen.size!==CASE_KEYS.length||CASE_KEYS.some(key=>!seen.has(key)))throw Error('INCOMPLETE_REHEARSAL');
 return {caseKeys:[...seen],records};
}
if(require.main===module){
 try {
  const bytes=fs.readFileSync(0);if(bytes.length>5000000)throw Error('INPUT_LIMIT');
  process.stdout.write(JSON.stringify(compareBatch(JSON.parse(bytes))));
 }catch{process.stderr.write('COMPARISON_FAILED\n');process.exitCode=1;}
}
module.exports={compareBatch};
