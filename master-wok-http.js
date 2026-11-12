'use strict';
// Shared Fetch handler for the server-only gateway. No client field selects an
// assessor, schema, authority or launch mode. No stack/SQL/secrets leave here.
async function equalSecret(a,b){
 const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const [x,y]=await Promise.all([hash(a),hash(b)]);let diff=0;
 for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
async function readBody(request,limit){
 const reader=request.body?.getReader();if(!reader)throw Error('INVALID_BODY');
 const chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;
  length+=value.byteLength;if(length>limit)throw Error('BODY_TOO_LARGE');chunks.push(value);
 }}catch(error){await reader.cancel().catch(()=>{});throw error;}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function createBookingHttpHandler({secret,checkout,lifecycle,serviceControl,readMode,availability,readPreviewOrders,basketReview,basketReviewAdmin,payments}={}){
 if(typeof secret!=='string'||secret.length<32||secret.length>256||typeof checkout!=='function'||
  typeof lifecycle?.adminAction!=='function'||typeof lifecycle?.customerResponse!=='function'||
  typeof serviceControl!=='function'||typeof readMode!=='function')throw Error('INVALID_HTTP_CONFIGURATION');
 const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 return async request=>{
  if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  const supplied=request.headers.get('x-master-wok-secret')||'';
  if(supplied.length>256||!await equalSecret(supplied,secret))return json({error:'UNAUTHORIZED'},401);
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return json({error:'JSON_REQUIRED'},415);
  let input;
  try{input=await readBody(request,65536);}catch(error){return json({committed:false,error:error.message==='BODY_TOO_LARGE'?'BODY_TOO_LARGE':'INVALID_JSON'},error.message==='BODY_TOO_LARGE'?413:400);}
  if(!input||Array.isArray(input)||typeof input!=='object')return json({committed:false,error:'INVALID_REQUEST'},400);
  try{
   if(input.operation==='mode'){
    const mode=await readMode();if(!['LEGACY','DRAINING','MASTER_WOK'].includes(mode))throw Error('INVALID_MODE');
    return json({mode});
   }
   if(!input.payload||Array.isArray(input.payload)||typeof input.payload!=='object')return json({committed:false,error:'INVALID_PAYLOAD'},400);
   const operations={...(payments?{payments}:{}),...(basketReviewAdmin?{basket_review_admin:basketReviewAdmin}:{}),...(basketReview?{basket_review:basketReview}:{}),checkout,admin_action:lifecycle.adminAction,customer_response:lifecycle.customerResponse,service_control:serviceControl,...(availability?{availability}:{})};
   if(!Object.hasOwn(operations,input.operation))return json({committed:false,error:'UNKNOWN_OPERATION'},400);
   const run=input.operation==='admin_action'&&input.payload.action==='preview_list_orders'&&readPreviewOrders
    ?readPreviewOrders:operations[input.operation];
   const result=await run(input.payload);
   if(input.operation==='checkout'){
    if(result?.status==='GREEN'&&result.response?.orderId)return json({...result.response,success:true,committed:result.committed,replayed:result.reason==='REPLAY'});
    const unavailable=['TRANSACTION_FAILED','CONNECTION_OR_TIME_INVALID','INVALID_BOOKING_MODE'].includes(result?.reason);
    return json({success:false,committed:false,error:result?.reason||'BOOKING_NOT_APPROVED'},unavailable?503:409);
   }
   if(!result||typeof result!=='object')throw Error('INVALID_WRITER_RESPONSE');
   const status=result.success||result.ok?200:([400,404,409,503].includes(result.statusCode)?result.statusCode:409);
   return json(result,status);
  }catch(_){
   // An exception can occur after a commit. Do not claim rollback or retry with
   // a new key. The client retains its original key for uncertain outcomes.
   return json({success:false,error:'WRITER_UNAVAILABLE_RETRY_SAME_REQUEST'},503);
  }
 };
}
module.exports={createBookingHttpHandler};
