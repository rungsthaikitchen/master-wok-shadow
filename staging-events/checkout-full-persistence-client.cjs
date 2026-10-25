// Default-off, dependency-injected OFFLINE staging candidate. No database/network import.
const {prepareCheckout,PROJECT}=require('./checkout-production-field-adapter.cjs');
const QUERY='SELECT master_wok_event_test.submit_full_checkout($1::uuid,$2::text,$3::uuid,$4::uuid,$5::jsonb) AS result';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
class FullSubmissionAttempt{
 #parameters; #enabled=false;
 constructor(options={}){
  if(options.enabled!==true)return;
  const {routeId,quoteId}=options;
  if(!uuid(routeId)||!uuid(quoteId))throw Error('FULL_CHECKOUT_BINDING_REQUIRED');
  const mapped=prepareCheckout(options);
  if(!mapped.engineProjection)throw Error('FULL_CHECKOUT_TARGET_UNVERIFIED');
  const payload={source:mapped.source,orderAlias:mapped.engineProjection.orderId,privateWrite:mapped.privateWrite};
  if(Buffer.byteLength(JSON.stringify(payload))>250000)throw Error('FULL_CHECKOUT_PAYLOAD_TOO_LARGE');
  this.#parameters=JSON.stringify([routeId,mapped.binding.requestId,mapped.binding.orderId,quoteId,payload]);
  this.#enabled=true;
 }
 async submit(transport){
  if(!this.#enabled)return {status:'DISABLED',sourceRequests:0,verified:false};
  if(typeof transport!=='function')throw Error('FULL_CHECKOUT_TRANSPORT_REQUIRED');
  let rows;
  try{rows=await transport({query:QUERY,parameters:JSON.parse(this.#parameters)});}catch{throw Error('FULL_CHECKOUT_SUBMISSION_FAILED');}
  if(!Array.isArray(rows)||rows.length!==1||!rows[0]||Object.keys(rows[0]).join(',')!=='result'||!['RECORDED','ALREADY_RECORDED'].includes(rows[0].result))throw Error('FULL_CHECKOUT_COMMITTED_RECEIPT_REQUIRED');
  return {status:rows[0].result,sourceRequests:1,verified:false,prediction:'UNVERIFIED'};
 }
}
module.exports={FullSubmissionAttempt,QUERY,PROJECT};
