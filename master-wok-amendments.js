'use strict';
const {beginBookingTransaction,lockServiceDates}=require('./master-wok-transaction-writer');
const {commitmentTimes}=require('./master-wok-commitment-reader');
const {localDate,relativePlacement}=require('./master-wok-clock');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {paymentSummary,completedLoyalty}=require('./master-wok-completed-amendments');
const {discountCents}=require('./master-wok-commercial');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const FIELDS=['order_type','delivery_address','customer_lat','customer_lng','delivery_fee','delivery_straight_line_miles','delivery_route_miles','delivery_distance_source','subtotal','discount_code','discount_amount','discount','discount_label','total','loyalty_discount','loyalty_points_redeem_pending','loyalty_points_earned_pending','loyalty_reward_applied','loyalty_expected_balance'];
function money(value){if(value===null||value===undefined||value===''||!/^\d+(?:\.\d{1,2})?$/.test(String(value))||!Number.isSafeInteger(Math.round(Number(value)*100)))throw Error('INVALID_AMENDMENT_MONEY');return Math.round(Number(value)*100);}
function snapshot(order){const moneyFields=new Set(['delivery_fee','subtotal','discount_amount','discount','total','loyalty_discount']);return Object.fromEntries(['id','order_ref','status','paid','payment_status','loyalty_settled','preferred_time','confirmed_time','proposed_time','confirm_token','is_test',...FIELDS].map(k=>[k,moneyFields.has(k)&&order[k]!=null?(money(order[k])/100).toFixed(2):order[k]??null]));}
async function digest(value){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function checkEditable(o,payment){
 if(o.is_test)throw Error('AMENDMENT_TEST_ORDER_REFUSED');
 if(o.status==='completed')return;
 if(!['pending','accepted','confirmed','customer_accepted_time'].includes(o.status))throw Error('AMENDMENT_REQUIRES_ACTIVE_ORDER');
 if(o.paid||payment||o.payment_status==='paid')throw Error('AMENDMENT_PAYMENT_ALREADY_RECORDED');
 if(o.loyalty_settled)throw Error('AMENDMENT_LOYALTY_ALREADY_SETTLED');
 if(o.is_test)throw Error('AMENDMENT_TEST_ORDER_REFUSED');
}
function calculateAmendment(order,changes,{now,discount,quote,completed=false}={}){
 if(!changes||Array.isArray(changes)||Object.keys(changes).some(k=>!['orderType','deliveryAddress','deliveryFee','discountCode','deliveryAreaOverride'].includes(k))||
  !['collection','delivery'].includes(changes.orderType)||typeof changes.discountCode!=='string'||changes.discountCode.length>80)throw Error('INVALID_AMENDMENT_CHANGES');
 if(changes.deliveryAreaOverride!==undefined&&typeof changes.deliveryAreaOverride!=='boolean')throw Error('INVALID_AMENDMENT_CHANGES');
 if(changes.deliveryAreaOverride===true&&(changes.orderType!=='delivery'||changes.deliveryFee===''||changes.deliveryFee==null))throw Error('AMENDMENT_AREA_OVERRIDE_MANUAL_FEE_REQUIRED');
 const type=changes.orderType,code=changes.discountCode.trim().toUpperCase(),oldCode=String(order.discount_code||'').trim().toUpperCase();
 const subtotal=money(order.subtotal),oldCodeDiscount=money(order.discount_amount||0),oldLoyalty=money(order.loyalty_discount||0),oldDiscount=money(order.discount||0);
 if(oldCodeDiscount+oldLoyalty!==oldDiscount||money(order.total)!==subtotal-oldDiscount+money(order.delivery_fee||0))throw Error('AMENDMENT_EXISTING_TOTALS_NEED_REVIEW');
 // Never reprice an existing basket against today's menu or grant a new reward.
 const amount=code===oldCode?oldCodeDiscount:discountCents(discount,code,subtotal,{now,preferredTime:order.confirmed_time||order.preferred_time});
 const loyalty=Math.min(oldLoyalty,Math.max(0,subtotal-amount));
 const food=Math.max(0,subtotal-amount-loyalty),earned=Math.floor(food/100),oldEarned=Number(order.loyalty_points_earned_pending||0);
 if(!Number.isInteger(oldEarned)||!Number.isInteger(Number(order.loyalty_expected_balance||0)))throw Error('AMENDMENT_INVALID_LOYALTY_STATE');
 let fee=0,delivery={delivery_address:null,customer_lat:null,customer_lng:null,delivery_straight_line_miles:null,delivery_route_miles:null,delivery_distance_source:null};
 if(type==='delivery'&&completed){
  if(changes.deliveryFee===''||changes.deliveryFee==null)throw Error('AMENDMENT_COMPLETED_DELIVERY_FEE_REQUIRED');
  fee=money(changes.deliveryFee);if(fee>10000)throw Error('DELIVERY_FEE_TOO_HIGH');
  if(typeof changes.deliveryAddress!=='string'||changes.deliveryAddress.length>1000)throw Error('INVALID_AMENDMENT_CHANGES');
  const address=changes.deliveryAddress.trim();
  delivery={delivery_address:address||null,customer_lat:null,customer_lng:null,delivery_straight_line_miles:null,delivery_route_miles:null,delivery_distance_source:null};
  if(order.order_type==='delivery'&&address===(order.delivery_address||''))for(const k of Object.keys(delivery))delivery[k]=order[k]??null;
 }else if(type==='delivery'){
  if(typeof changes.deliveryAddress!=='string'||!changes.deliveryAddress.trim()||changes.deliveryAddress.length>1000)throw Error('DELIVERY_ADDRESS_REQUIRED');
  if(!quote||!Number.isFinite(quote.straightLineMiles)||quote.straightLineMiles<0||(quote.straightLineMiles>3&&changes.deliveryAreaOverride!==true)||
   !Number.isFinite(quote.customerLatitude)||!Number.isFinite(quote.customerLongitude)||Math.abs(quote.customerLatitude)>90||Math.abs(quote.customerLongitude)>180)throw Error('DELIVERY_ADDRESS_NOT_ELIGIBLE');
  const route=quote.routeMiles;if(route!=null&&(!Number.isFinite(route)||route<0))throw Error('INVALID_ROUTE_QUOTE');
  const band=route==null?null:[{max:1.5,fee:200},{max:2.5,fee:300},{max:4,fee:400}].find(b=>route<=b.max);
  fee=changes.deliveryFee===''||changes.deliveryFee==null?(subtotal>=3000?0:band?.fee??300):money(changes.deliveryFee);
  if(fee>10000)throw Error('DELIVERY_FEE_TOO_HIGH');
  delivery={delivery_address:changes.deliveryAddress.trim(),customer_lat:quote.customerLatitude,customer_lng:quote.customerLongitude,
   delivery_straight_line_miles:quote.straightLineMiles,delivery_route_miles:route??null,delivery_distance_source:band?'route':'fallback'};
 }else if(changes.deliveryFee!==''&&changes.deliveryFee!=null&&money(changes.deliveryFee)!==0)throw Error('COLLECTION_CANNOT_HAVE_DELIVERY_FEE');
 return {order_type:type,...delivery,delivery_fee:fee/100,discount_code:code||null,discount_amount:amount/100,
  discount:(amount+loyalty)/100,discount_label:code?'Discount code '+code:loyalty?'Loyalty reward':null,
  loyalty_discount:loyalty/100,loyalty_points_earned_pending:earned,
  loyalty_points_redeem_pending:loyalty>0?Number(order.loyalty_points_redeem_pending||0):0,
  loyalty_reward_applied:loyalty>0,
  loyalty_expected_balance:Number(order.loyalty_expected_balance||0)-oldEarned+earned+(loyalty===0?Number(order.loyalty_points_redeem_pending||0):0),total:(food+fee)/100};
}
function createAmendmentWriter({pool,schema='public',assertWriteAllowed,assessMutation,quoteDelivery,planStore=createServicePlanStore({schema})}={}){
 if(!pool?.connect||!['public','master_wok_rehearsal'].includes(schema)||typeof assertWriteAllowed!=='function'||typeof assessMutation!=='function'||typeof quoteDelivery!=='function')throw Error('INVALID_AMENDMENT_CONFIGURATION');
 const q='"'+schema+'".';
 return async input=>{
  const fail=(reason,statusCode=409)=>({success:false,committed:false,reason,statusCode});
  if(!input||!['amend_read','amend_preview','amend_save','amend_confirm_time'].includes(input.action)||!UUID.test(input.orderId||''))return fail('INVALID_AMENDMENT_REQUEST',400);
  if(typeof input.staffActor!=='string'||!/^\S+@\S+\.\S+$/.test(input.staffActor)||input.staffActor.length>254)return fail('AMENDMENT_STAFF_REQUIRED',403);
  const actor=input.staffActor.toLowerCase();let c;
  try{
   c=await pool.connect();await beginBookingTransaction(c,{key:'order:'+input.orderId});await assertWriteAllowed(c);
   let requestFingerprint;
   if(['amend_save','amend_confirm_time'].includes(input.action)){
    if(!UUID.test(input.idempotencyKey||'')||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500)throw Error('AMENDMENT_REASON_AND_KEY_REQUIRED');
    requestFingerprint=await digest(input.action==='amend_confirm_time'?[input.action,input.orderId,actor,input.expectedVersion,input.reason.trim()]:[input.orderId,actor,input.expectedVersion,input.expectedPreview,input.changes,input.reason.trim()]);
    const prior=(await c.query(`SELECT request_fingerprint,response FROM ${q}order_amendments WHERE idempotency_key=$1`,[input.idempotencyKey])).rows[0];
    if(prior){await c.query('ROLLBACK');return prior.request_fingerprint===requestFingerprint?{...prior.response,replayed:true,committed:false}:fail('AMENDMENT_IDEMPOTENCY_CONFLICT');}
   }
   const order=(await c.query(`SELECT * FROM ${q}orders WHERE id=$1 FOR UPDATE`,[input.orderId])).rows[0];
   if(!order){await c.query('ROLLBACK');return fail('ORDER_NOT_FOUND',404);}
   const payment=(await c.query(`SELECT * FROM ${q}order_payments WHERE order_id=$1`,[input.orderId])).rows[0];
   const timeResolution=['proposed','customer_declined_time'].includes(order.status)&&!!order.proposed_time;
   if(!timeResolution||!['amend_read','amend_confirm_time'].includes(input.action))checkEditable(order,payment);const completed=order.status==='completed',before=snapshot(order),paymentBefore=paymentSummary(order,payment),version=await digest([before,paymentBefore]);
   if(input.action==='amend_read'){
    const history=(await c.query(`SELECT actor,reason,occurred_at,before_details,after_details FROM ${q}order_amendments WHERE order_id=$1 ORDER BY occurred_at DESC LIMIT 20`,[order.id])).rows;
    await c.query('ROLLBACK');return {success:true,committed:false,notification_managed:true,order:before,version,history,completedAmendment:completed,payment:paymentBefore,staffTimeConfirmationAvailable:timeResolution};
   }
   if(input.expectedVersion!==version)throw Error('AMENDMENT_ORDER_CHANGED_REFRESH');
   if(input.changes?.deliveryAreaOverride===true&&(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500))throw Error('AMENDMENT_AREA_OVERRIDE_REASON_REQUIRED');
   const now=(await c.query('SELECT clock_timestamp() AS now')).rows[0]?.now;
   if(!now||!Number.isFinite(new Date(now).getTime()))throw Error('AMENDMENT_SERVER_CLOCK_REQUIRED');
   if(input.action==='amend_confirm_time'){
    if(!timeResolution)throw Error('AMENDMENT_NO_PROPOSED_TIME_TO_CONFIRM');
    const agreed=new Date(order.proposed_time);if(!Number.isFinite(agreed.getTime()))throw Error('AMENDMENT_NO_PROPOSED_TIME_TO_CONFIRM');
    const after={...order,status:'confirmed',confirmed_time:agreed.toISOString(),confirm_token:null};
    const dates=[...new Set([...commitmentTimes(order),...commitmentTimes(after)].map(localDate))].sort();
    await lockServiceDates(c,dates);
    await c.query(`UPDATE ${q}orders SET "status"=$2,"confirmed_time"=$3,"confirm_token"=$4 WHERE id=$1`,[order.id,after.status,after.confirmed_time,null]);
    const assessment=await assessMutation({connection:c,before:order,after,dates,now,action:'staff_confirm_time'});
    if(assessment?.status!=='GREEN'||assessment.bookingApprovalAllowed!==true||dates.some(d=>!assessment.plansByDate?.[d]))throw Error('AMENDMENT_SCHEDULE_NOT_AVAILABLE');
    for(const date of dates)await planStore.save(c,date,assessment.plansByDate[date]);
    const confirmation={source:'STAFF_RECORDED_CUSTOMER_AGREEMENT',actor,reason:input.reason.trim(),agreedTime:after.confirmed_time};
    const response={success:true,notification_managed:true,customerNotificationSent:false,orderId:order.id,before,after:snapshot(after),timeConfirmation:confirmation};
    await c.query(`INSERT INTO ${q}order_amendments(order_id,idempotency_key,request_fingerprint,actor,reason,before_details,after_details,response) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)`,
     [order.id,input.idempotencyKey,requestFingerprint,actor,input.reason.trim(),JSON.stringify(before),JSON.stringify({...response.after,time_confirmation:confirmation}),JSON.stringify(response)]);
    await c.query('COMMIT');return {...response,committed:true};
   }
   const code=String(input.changes?.discountCode||'').trim().toUpperCase(),oldCode=String(order.discount_code||'').trim().toUpperCase();
   // Lock both counters in stable order; an unchanged code is not used twice.
   const discounts=(await c.query(`SELECT * FROM ${q}discount_codes WHERE code=ANY($1::text[]) ORDER BY code FOR UPDATE`,[[...new Set([code,oldCode].filter(Boolean))]])).rows;
   const discount=discounts.find(d=>d.code===code);
   let quote=null;
   if(input.changes?.orderType==='delivery'&&!completed){
    const retained=order.order_type==='delivery'&&typeof input.changes.deliveryAddress==='string'&&input.changes.deliveryAddress.trim()===order.delivery_address&&order.delivery_straight_line_miles!=null&&order.customer_lat!=null&&order.customer_lng!=null;
    quote=retained?{straightLineMiles:Number(order.delivery_straight_line_miles),routeMiles:order.delivery_route_miles==null?null:Number(order.delivery_route_miles),customerLatitude:Number(order.customer_lat),customerLongitude:Number(order.customer_lng)}:await quoteDelivery({address:input.changes.deliveryAddress,subtotalCents:money(order.subtotal),allowOutsideArea:input.changes.deliveryAreaOverride===true});
   }
   const patch=calculateAmendment(order,input.changes,{now,discount,quote,completed}),after={...order,...patch};
   const paymentAfter=paymentSummary(after,payment);
   if(completed&&payment){after.paid=paymentAfter.balance.paid;after.payment_status=paymentAfter.balance.paymentStatus;}
   const loyaltyAdjustment=completed?await completedLoyalty(c,order,after,{schema}):null;
   const deliveryAreaOverride=input.changes?.deliveryAreaOverride===true?{
    approved:true,applied:!completed&&Number(quote?.straightLineMiles)>3,actor,
    reason:input.reason.trim(),normalLimitMiles:3,straightLineMiles:quote?.straightLineMiles??null}:null;
   const preview=await digest([version,snapshot(after),paymentAfter,loyaltyAdjustment,deliveryAreaOverride]);
   if(input.action==='amend_save'&&input.expectedPreview!==preview)throw Error('AMENDMENT_PRICE_CHANGED_REVIEW');
   if(FIELDS.every(k=>JSON.stringify(before[k])===JSON.stringify(snapshot(after)[k])))throw Error('AMENDMENT_NO_CHANGES');
   // Prices alone never move work. A mode/address change must validate and save
   // the revised protected kitchen and driver plans within this transaction.
   const coordinateChanged=k=>{
    if(order[k]==null||after[k]==null)return order[k]!=after[k];
    const a=Number(order[k]),b=Number(after[k]);
    return !Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>8*Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b));
   };
   const operational=!completed&&(order.order_type!==after.order_type||(order.delivery_address??null)!==(after.delivery_address??null)||
    coordinateChanged('customer_lat')||coordinateChanged('customer_lng'));
   let assessment,dates=[];
   if(operational){
    dates=[...new Set([...commitmentTimes(order),...commitmentTimes(after)].map(localDate))].sort();
    if(!dates.length)throw Error('AMENDMENT_NO_BOOKED_TIME');await lockServiceDates(c,dates);
    for(const date of dates){
     const oldPlan=await planStore.read(c,date),clock=relativePlacement(now,date),minute=clock.getHours()*60+clock.getMinutes();
     if(oldPlan?.delivery?.trips.some(t=>t.start<=minute&&t.stops.some(s=>s.sourceId===String(order.id))))throw Error('AMENDMENT_DELIVERY_ALREADY_STARTED');
    }
   }
   if(completed&&payment){patch.paid=after.paid;patch.payment_status=after.payment_status;}
   const keys=Object.keys(patch);
   await c.query(`UPDATE ${q}orders SET ${keys.map((k,i)=>'"'+k+'"=$'+(i+2)).join(',')} WHERE id=$1`,[order.id,...keys.map(k=>patch[k])]);
   if(operational){
    assessment=await assessMutation({connection:c,before:order,after,dates,now,action:'amend_order'});
    if(assessment?.status!=='GREEN'||assessment.bookingApprovalAllowed!==true||dates.some(d=>!assessment.plansByDate?.[d]))throw Error('AMENDMENT_SCHEDULE_NOT_AVAILABLE');
   }
   const response={success:true,notification_managed:true,orderId:order.id,before,after:snapshot(after),version,preview,
    completedAmendment:completed,paymentBefore,paymentAfter,loyaltyAdjustment,deliveryAreaOverride,
    customerTimeMeaning:patch.order_type==='delivery'?'Arrival at the customer’s door':'Ready for collection',customerNotificationSent:false};
   if(input.action==='amend_preview'){await c.query('ROLLBACK');return {...response,committed:false};}
   if(loyaltyAdjustment)await c.query(`UPDATE ${q}loyalty_accounts SET points_balance=$2,lifetime_points=$3,updated_at=clock_timestamp() WHERE id=$1`,[loyaltyAdjustment.accountId,loyaltyAdjustment.after.pointsBalance,loyaltyAdjustment.after.lifetimePoints]);
   if(code!==oldCode){
    if(oldCode)await c.query(`UPDATE ${q}discount_codes SET used_count=greatest(0,coalesce(used_count,0)-1) WHERE code=$1`,[oldCode]);
    if(code)await c.query(`UPDATE ${q}discount_codes SET used_count=coalesce(used_count,0)+1 WHERE code=$1`,[code]);
   }
   for(const date of dates)await planStore.save(c,date,assessment.plansByDate[date]);
   await c.query(`INSERT INTO ${q}order_amendments(order_id,idempotency_key,request_fingerprint,actor,reason,before_details,after_details,response) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)`,
    [order.id,input.idempotencyKey,requestFingerprint,actor,input.reason.trim(),JSON.stringify(before),JSON.stringify({...response.after,...(deliveryAreaOverride?{delivery_area_override:deliveryAreaOverride}:{})}),JSON.stringify(response)]);
   await c.query('COMMIT');return {...response,committed:true};
  }catch(error){if(c)try{await c.query('ROLLBACK');}catch(_){}const known=/^(AMENDMENT_|INVALID_AMENDMENT_|DISCOUNT_|INVALID_DISCOUNT_|DELIVERY_|COLLECTION_|INVALID_ROUTE_)/.test(error.message||'');return fail(known?error.message:'AMENDMENT_UNAVAILABLE',known?409:503);}
  finally{c?.release();}
 };
}
module.exports={createAmendmentWriter,calculateAmendment,snapshot,money};
