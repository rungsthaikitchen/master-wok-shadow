// Default-off offline staging adapter. No runtime imports, fetch or database client.
const QUERY='SELECT master_wok_event_test.submit_checkout($1::uuid,$2::text,$3::uuid,$4::uuid,$5::jsonb) AS result';
const PROJECT='hvrqgufqjslvgiohgkvu';
function uuid(x){return typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);}
class SubmissionAttempt{
 constructor(options={}){
  this.enabled=options.enabled===true;
  if(!this.enabled)return;
  const {project,routeId,requestId,orderId,quoteId,checkout}=options;
  if(project!==PROJECT||![routeId,orderId,quoteId].every(uuid)||typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId))throw Error('STAGING_CHECKOUT_COMMAND_REQUIRED');
  let snapshot;
  try{snapshot=JSON.stringify(checkout,(_k,v)=>{if(typeof v==='number'&&!Number.isFinite(v))throw Error();return v;});}catch{throw Error('STAGING_CHECKOUT_PAYLOAD_REQUIRED');}
  if(!checkout||Array.isArray(checkout)||typeof checkout!=='object'||!snapshot||Buffer.byteLength(snapshot)>100000)throw Error('STAGING_CHECKOUT_PAYLOAD_REQUIRED');
  // Request and order IDs are supplied once by the caller and retained for retries.
  this.parameters=JSON.stringify([routeId.toLowerCase(),requestId,orderId.toLowerCase(),quoteId.toLowerCase(),JSON.parse(snapshot)]);
 }
 async submit(transport){
  if(!this.enabled)return {status:'DISABLED',sourceRequests:0,verified:false};
  if(typeof transport!=='function')throw Error('STAGING_CHECKOUT_TRANSPORT_REQUIRED');
  let rows;
  try{rows=await transport({query:QUERY,parameters:JSON.parse(this.parameters)});}catch{throw Error('CHECKOUT_SUBMISSION_FAILED');}
  if(!Array.isArray(rows)||rows.length!==1||!rows[0]||Object.keys(rows[0]).join(',')!=='result'||!['RECORDED','ALREADY_RECORDED'].includes(rows[0].result))throw Error('CHECKOUT_COMMITTED_RECEIPT_REQUIRED');
  return {status:rows[0].result,sourceRequests:1,verified:false};
 }
}
module.exports={SubmissionAttempt,QUERY,PROJECT};
