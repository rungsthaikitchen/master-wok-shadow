'use strict';
// The current website's declarative menu, with prices calculated on the server.
// This module does not issue bookings, redeem points or send notifications.
const catalog=require('./checkout-catalog.json');
const {localDate}=require('./master-wok-clock');
const itemsById=new Map(catalog.items.map(i=>[i.id,i]));
const modifiers=new Map(catalog.modifiers.map(m=>[m.id,m]));
const extras=new Map(catalog.extras.map(m=>[m.id,m]));
const cents=n=>{if(!Number.isFinite(Number(n))||Number(n)<0)throw Error('INVALID_MONEY');return Math.round(Number(n)*100);};
function priceBasket(lines){
 if(!Array.isArray(lines)||!lines.length||lines.length>100)throw Error('INVALID_BASKET');
 let subtotal=0,portions=0;
 const items=lines.map(line=>{
  const item=itemsById.get(line.item_id);
  if(!item||!Number.isInteger(line.qty)||line.qty<1||line.qty>100||
   !Array.isArray(line.modifiers))throw Error('INVALID_BASKET_LINE');
  portions+=line.qty;if(portions>200)throw Error('BASKET_SIZE_LIMIT');
  const ids=line.modifiers.map(m=>typeof m==='string'?m:m?.id);
  if(new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))throw Error('INVALID_MODIFIER');
  const selected=ids.filter(id=>modifiers.has(id)),added=ids.filter(id=>extras.has(id));
  if(selected.length+added.length!==ids.length||
   selected.some(id=>!(item.allowedModifiers||[]).includes(id))||
   selected.length>(item.modifierMax||1)||
   (item.modifierRequired&&selected.length!==1)||
   added.length>1||added.some(id=>!item.categoryAllowExtras||!(item.allowedExtras||[]).includes(id)))
   throw Error('MODIFIER_NOT_ALLOWED');
  let spice=null;
  if(item.spiceEnabled){
   spice=line.spice??item.spiceDefault??0;
   if(!Number.isInteger(spice)||spice<(item.spiceMin||0)||spice>3)throw Error('SPICE_NOT_ALLOWED');
  }else if(line.spice!=null&&line.spice!==0)throw Error('SPICE_NOT_ALLOWED');
  const mods=ids.map(id=>({...modifiers.get(id)||extras.get(id)}));
  const unit=cents(item.price)+mods.reduce((n,m)=>n+cents(m.delta),0);
  subtotal+=unit*line.qty;
  if(line.item_note!=null&&(typeof line.item_note!=='string'||line.item_note.length>1000))throw Error('INVALID_ITEM_NOTE');
  return {item_id:item.id,name:item.name,unit_price:unit/100,qty:line.qty,modifiers:mods,
   spice,img:item.img||null,item_note:line.item_note||null,kitchen_load:item.kitchenLoad};
 });
 return {items,subtotalCents:subtotal};
}
function discountCents(row,code,subtotal,{now,preferredTime}){
 if(!code)return 0;
 if(!row||row.active!==true||row.code!==code||
   (row.starts_at&&new Date(row.starts_at)>new Date(now))||
   (row.expires_at&&new Date(row.expires_at)<new Date(now))||
   (row.max_uses!=null&&Number(row.used_count||0)>=Number(row.max_uses))||
   subtotal<cents(row.min_food_subtotal||0))throw Error('DISCOUNT_NOT_AVAILABLE');
 if([row.starts_at,row.expires_at].some(t=>t&&!Number.isFinite(new Date(t).getTime())))throw Error('INVALID_DISCOUNT_RULE');
 const day=new Date(localDate(preferredTime)+'T12:00:00Z').getUTCDay();
 if(Array.isArray(row.allowed_weekdays)&&row.allowed_weekdays.length&&!row.allowed_weekdays.map(Number).includes(day))
  throw Error('DISCOUNT_WRONG_SERVICE_DAY');
 if(row.discount_type==='fixed')return Math.min(subtotal,cents(row.discount_value));
 if(row.discount_type==='percent'&&Number.isFinite(Number(row.discount_value))&&Number(row.discount_value)>=0&&Number(row.discount_value)<=100)
  return Math.round(subtotal*Number(row.discount_value)/100);
 throw Error('INVALID_DISCOUNT_RULE');
}
function calculateCommercialOrder(input,{now,discount=null,settledPoints=0,reservedPoints=0,deliveryQuote=null}={}){
 if(!input||!['collection','delivery'].includes(input.orderType)||!Number.isFinite(Date.parse(input.preferredTime))||
  !Number.isFinite(Date.parse(now)))throw Error('INVALID_ORDER');
 const priced=priceBasket(input.items),subtotal=priced.subtotalCents;
 const code=String(input.discountCode||'').trim().toUpperCase();
 const codeDiscount=discountCents(discount,code,subtotal,{now,preferredTime:input.preferredTime});
 // applyWedThuDiscount() currently returns zero. Do not resurrect an old offer.
 const afterCode=Math.max(0,subtotal-codeDiscount);
 if(!Number.isInteger(settledPoints)||settledPoints<0||!Number.isInteger(reservedPoints)||reservedPoints<0)
  throw Error('INVALID_LOYALTY_STATE');
 const reward=settledPoints-reservedPoints>=100&&afterCode>0;
 const loyalty=reward?Math.min(500,afterCode):0,redeemed=reward?100:0;
 let fee=0,delivery={};
 if(input.orderType==='delivery'){
  // Quote must come from trusted geocoding/routing, never browser coordinates,
  // distance or a client-provided 'eligible' flag. Radius is checked even at £30.
  if(!deliveryQuote||!Number.isFinite(deliveryQuote.straightLineMiles)||
    deliveryQuote.straightLineMiles<0||deliveryQuote.straightLineMiles>3)
   throw Error('DELIVERY_ADDRESS_NOT_ELIGIBLE');
  const route=deliveryQuote.routeMiles;
  if(route!=null&&(!Number.isFinite(route)||route<0))throw Error('INVALID_ROUTE_QUOTE');
  const band=route==null?null:[{max:1.5,fee:200},{max:2.5,fee:300},{max:4,fee:400}].find(b=>route<=b.max);
  fee=subtotal>=3000?0:band?.fee??300;
  delivery={delivery_straight_line_miles:deliveryQuote.straightLineMiles,
   delivery_route_miles:route??null,delivery_distance_source:band?'route':'fallback'};
 }
 const food=Math.max(0,afterCode-loyalty),earned=Math.floor(food/100);
 return {items:priced.items,header:{subtotal:subtotal/100,total:(food+fee)/100,
  discount:(codeDiscount+loyalty)/100,discount_code:code||null,discount_amount:codeDiscount/100,
  discount_label:code?'Discount code '+code:loyalty?'Loyalty reward':null,
  delivery_fee:fee/100,...delivery,loyalty_discount:loyalty/100,
  loyalty_points_redeem_pending:redeemed,loyalty_points_earned_pending:earned,
  loyalty_reward_applied:reward,loyalty_expected_balance:settledPoints-redeemed+earned,
  order_type:input.orderType,preferred_time:input.preferredTime,asap_requested:false,
  payment_preference:input.paymentPreference==='in_advance'?'in_advance':'on_arrival',
  communication_preference:input.communicationPreference==='email'?'email':'sms',notes:input.notes||null}};
}
module.exports={priceBasket,calculateCommercialOrder,discountCents,catalog};
