'use strict';
const {calculateCommercialOrder,priceBasket}=require('./master-wok-commercial');
const {createDeliveryQuoter}=require('./master-wok-delivery-quote');
const phoneKey=value=>{const text=String(value||'').trim();return (text.startsWith('+')?'+':'')+text.replace(/\D/g,'');};
async function resolveCustomer(connection,contact,orderType){
 if(!contact||typeof contact.name!=='string'||!contact.name.trim()||contact.name.length>200||
  typeof contact.email!=='string'||!/^\S+@\S+\.\S+$/.test(contact.email)||contact.email.length>320||
  !/^\+?\d{8,15}$/.test(phoneKey(contact.phone))||
  (orderType==='delivery'&&(!contact.address||typeof contact.address!=='string'))||
  (contact.address&&contact.address.length>1000))throw Error('INVALID_CUSTOMER_DETAILS');
 const email=contact.email.trim().toLowerCase(),phone=String(contact.phone).trim();
 let result=await connection.query('SELECT id,phone,email FROM public.customers WHERE email=$1 FOR UPDATE',[email]);
 if(!result.rows.length)result=await connection.query('SELECT id,phone,email FROM public.customers WHERE phone=$1 FOR UPDATE',[phone]);
 if(result.rows.length>1)throw Error('AMBIGUOUS_CUSTOMER');
 if(result.rows.length){
  const current=result.rows[0];
  const updated=await connection.query(`UPDATE public.customers SET full_name=$2,address=$3,
   email=coalesce(email,$4),phone=coalesce(phone,$5) WHERE id=$1 RETURNING id,phone,email`,
   [current.id,contact.name.trim(),contact.address||null,email,phone]);
  return updated.rows[0];
 }
 return (await connection.query(`INSERT INTO public.customers(full_name,email,phone,address)
  VALUES($1,$2,$3,$4) RETURNING id,phone,email`,[contact.name.trim(),email,phone,contact.address||null])).rows[0];
}
function createCommercialValidator({quoteDelivery,deliveryService,customerResolver=resolveCustomer}={}){
 quoteDelivery=quoteDelivery||(deliveryService?createDeliveryQuoter(deliveryService):undefined);
 return async function validateCommercialOrder(connection,input,state){
  if(input.asapRequested===true||input.is_test===true||input.isTest===true)
   throw Error('CUSTOMER_CANNOT_SET_TEST_OR_ASAP');
  if(input.notes!=null&&(typeof input.notes!=='string'||input.notes.length>2000))throw Error('INVALID_ORDER_NOTES');
  const customer=await customerResolver(connection,input.customer,input.orderType);
  if(!customer?.id||!phoneKey(customer.phone))throw Error('CUSTOMER_RESOLUTION_FAILED');
  const code=String(input.discountCode||'').trim().toUpperCase();
  if(code.length>100)throw Error('INVALID_DISCOUNT_CODE');
  const discount=code?(await connection.query('SELECT * FROM public.discount_codes WHERE code=$1 FOR UPDATE',[code])).rows[0]:null;
  const account=(await connection.query('SELECT * FROM public.loyalty_accounts WHERE customer_phone=$1 FOR UPDATE',[phoneKey(customer.phone)])).rows[0];
  // Reserve outstanding rewards without deducting a settled account balance at
  // checkout. Settlement remains attached to completion of the actual order.
  const reserved=await connection.query(`SELECT coalesce(sum(o.loyalty_points_redeem_pending),0)::integer AS points
   FROM public.orders o JOIN public.customers c ON c.id=o.customer_id
   WHERE o.loyalty_settled=false AND o.is_test=false
    AND lower(o.status) NOT IN ('cancelled','declined','rejected')
    AND regexp_replace(c.phone,'[^+0-9]','','g')=$1`,[phoneKey(customer.phone)]);
  let quote=null;
  if(input.orderType==='delivery'){
   if(typeof quoteDelivery!=='function')throw Error('TRUSTED_DELIVERY_QUOTE_REQUIRED');
   quote=await quoteDelivery({address:input.customer.address,now:state.now,subtotalCents:priceBasket(input.items).subtotalCents});
  }
  const priced=calculateCommercialOrder(input,{now:state.now,discount,
   settledPoints:Number(account?.points_balance||0),reservedPoints:Number(reserved.rows[0]?.points||0),deliveryQuote:quote});
  // Preserve the visible price: changed menu/discount/loyalty state requires the
  // browser to refresh the quote rather than accepting a different charge.
  if(!input.expectedTotals||['subtotal','total','delivery_fee','discount','loyalty_discount'].some(k=>
   !Number.isFinite(input.expectedTotals[k])||Math.round(input.expectedTotals[k]*100)!==Math.round(priced.header[k]*100)))
   throw Error('CHECKOUT_PRICE_CHANGED');
  const reference=(await connection.query('SELECT public.get_next_order_number() AS value')).rows[0]?.value;
  const assigned=Number(reference?.assigned);
  if(!Number.isInteger(assigned)||assigned<1)throw Error('ORDER_REFERENCE_UNAVAILABLE');
  if(code)await connection.query('UPDATE public.discount_codes SET used_count=coalesce(used_count,0)+1 WHERE id=$1',[discount.id]);
  return {...priced,header:{...priced.header,customer_id:customer.id,order_ref:'RTK-'+String(assigned).padStart(3,'0'),
   ...(input.orderType==='delivery'&&Number.isFinite(quote?.customerLatitude)&&Number.isFinite(quote?.customerLongitude)?
    {customer_lat:quote.customerLatitude,customer_lng:quote.customerLongitude}:{}),
   ...(input.orderType==='delivery'?{delivery_address:input.customer.address}: {})}};
 };
}
module.exports={createCommercialValidator,resolveCustomer,phoneKey};
