'use strict';
const {priceBasket}=require('./master-wok-commercial');

function normalizeReview(input){
 if(!input||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.requestKey||'')||
  !['collection','delivery'].includes(input.orderType)||
  typeof input.customer?.name!=='string'||!input.customer.name.trim()||input.customer.name.length>200||
  typeof input.customer.phone!=='string'||!/^\+?[0-9 ()-]{7,40}$/.test(input.customer.phone)||
  input.customer.phone.replace(/\D/g,'').length<8||
  typeof input.preferredTime!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(input.preferredTime)||
  !Number.isFinite(Date.parse(input.preferredTime)))throw Error('INVALID_REVIEW_REQUEST');
 let priced;
 try{priced=priceBasket(input.items);}catch(_){throw Error('INVALID_REVIEW_REQUEST');}
 const address=input.orderType==='delivery'&&typeof input.deliveryAddress==='string'?input.deliveryAddress.trim():null;
 if(input.orderType==='delivery'&&(typeof address!=='string'||address.length<5||address.length>1000))
  throw Error('INVALID_REVIEW_REQUEST');
 return {requestKey:input.requestKey.toLowerCase(),customerName:input.customer.name.trim(),
  customerPhone:input.customer.phone.trim(),orderType:input.orderType,
  preferredTime:new Date(input.preferredTime).toISOString(),basket:priced.items,deliveryAddress:address};
}

function createBasketReviewStore({pool,schema='public',assessReview}){
 if(!pool||!['public','master_wok_rehearsal'].includes(schema))throw Error('INVALID_REVIEW_CONFIGURATION');
 const table='"'+schema+'".master_wok_basket_reviews';
 return async input=>{
  const review=normalizeReview(input);
  let assessment={status:'UNAVAILABLE',message:'Scheduling analysis is unavailable. Discuss the basket before agreeing a time.'};
  if(assessReview)try{assessment=describeReviewAssessment(await assessReview(review));}catch(_){}
  // Compare the stored request on replay. A reused key cannot replace a basket.
  const values=[review.requestKey,review.customerName,review.customerPhone,review.orderType,
   review.preferredTime,JSON.stringify(review.basket),review.deliveryAddress,JSON.stringify(assessment)];
  const result=await pool.query(
   'INSERT INTO '+table+' AS saved (request_key,customer_name,customer_phone,order_type,preferred_time,basket,delivery_address,assessment) '
   +'VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb) ON CONFLICT(request_key) DO UPDATE SET request_key=saved.request_key '
   +'WHERE saved.customer_name=excluded.customer_name AND saved.customer_phone=excluded.customer_phone '
   +'AND saved.order_type=excluded.order_type AND saved.preferred_time=excluded.preferred_time '
   +'AND saved.basket=excluded.basket AND saved.delivery_address IS NOT DISTINCT FROM excluded.delivery_address RETURNING id,status',values);
  if(result.rows.length!==1)return {success:false,statusCode:409,reason:'REVIEW_REQUEST_KEY_CONFLICT'};
  return {success:true,reviewId:result.rows[0].id,status:result.rows[0].status,bookingApprovalAllowed:false};
 };
}
module.exports={normalizeReview,createBasketReviewStore};

// Called only by the authenticated server-to-server Admin boundary. A review
// status can never create an order or bypass a booking assessment.
function createBasketReviewAdmin({pool,schema='public'}){
 if(!pool||!['public','master_wok_rehearsal'].includes(schema))throw Error('INVALID_REVIEW_CONFIGURATION');
 const table='"'+schema+'".master_wok_basket_reviews';
 return async input=>{
  if(input?.action==='list'){
   const result=await pool.query('SELECT id,status,customer_name,customer_phone,order_type,preferred_time,delivery_address,basket,assessment,created_at,updated_at FROM '+table+
    " WHERE status IN ('pending','contacted') ORDER BY created_at ASC,id ASC LIMIT 100");
   return {success:true,reviews:result.rows,bookingApprovalAllowed:false};
  }
  if(input?.action!=='set_status'||!['pending','contacted','resolved','closed'].includes(input.status)||
   !['pending','contacted','resolved','closed'].includes(input.expectedStatus)||
   !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.reviewId||''))
   return {success:false,statusCode:400,reason:'INVALID_REVIEW_ACTION'};
  const result=await pool.query('UPDATE '+table+' SET status=$1,updated_at=clock_timestamp() WHERE id=$2 AND status=$3 RETURNING id,status',
   [input.status,input.reviewId,input.expectedStatus]);
  return result.rows.length===1?{success:true,review:result.rows[0],bookingApprovalAllowed:false}:
   {success:false,statusCode:409,reason:'REVIEW_CHANGED_REFRESH'};
 };
}
module.exports.createBasketReviewAdmin=createBasketReviewAdmin;

// Explain only the server assessor's result. Search limits and missing coverage
// are uncertainty, never evidence that the customer's basket is impossible.
function describeReviewAssessment(result){
 const reasons={
  BLACKOUT:'The requested time falls in a closed or fully booked period.',
  OUTSIDE_SERVICE_WINDOW:'The requested time is outside the service window.',
  ORDERS_PAUSED:'Ordering is paused at the moment.',
  BELOW_EXISTING_MINIMUM_LEAD:'The requested time does not allow the minimum preparation lead time.',
  BELOW_SERVICE_MINIMUM_LEAD:'The requested time does not allow the extra lead time set in Admin.',
  INSUFFICIENT_LEAD_TIME:'The current model needs more preparation time.',
  FIXED_BATCH_CAPACITY_EXCEEDED:'The current hob model could not fit the cooking batches within its time and holding limits. This is not proof that the physical kitchen cannot make this basket.'
 };
 const hint=result?.success===true&&result.hints?.[0];
 if(hint?.available===true)return {status:'MODEL_FIT',message:'The current model now finds room at the requested time. This review has not booked or reserved it.'};
 const reason=hint?.reason;
 if(Object.hasOwn(reasons,reason))return {status:'MODEL_RESTRICTION',reason,message:reasons[reason]};
 return {status:'UNVERIFIED',message:'The engine could not verify a schedule or identify a confirmed bottleneck. Discuss the basket before agreeing a time.'};
}
module.exports.describeReviewAssessment=describeReviewAssessment;
