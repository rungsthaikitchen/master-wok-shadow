'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {priceBasket,calculateCommercialOrder,catalog}=require('./master-wok-commercial');
const line=(id='panang-curry',qty=1,mods=['chicken'])=>({item_id:id,qty,modifiers:mods.map(id=>({id})),spice:1});
const input=()=>({orderType:'collection',preferredTime:'2026-11-04T18:00:00Z',items:[line()]});
const state=()=>({now:'2026-11-01T12:00:00Z'});
test('server catalogue contains all 44 current menu items and ignores client prices/names',()=>{
 assert.equal(catalog.items.length,44);
 const p=priceBasket([{...line(),name:'forged',unit_price:0.01}]);
 assert.equal(p.subtotalCents,900);assert.notEqual(p.items[0].name,'forged');
});
test('required proteins, allowed extras, duplicates and minimum spice are enforced',()=>{
 assert.throws(()=>priceBasket([line('panang-curry',1,[])]));
 assert.throws(()=>priceBasket([line('panang-curry',1,['chicken','chicken'])]));
 assert.throws(()=>priceBasket([line('panang-curry',1,['chicken','extra-egg'])]));
 assert.throws(()=>priceBasket([{...line('stir-crispy',1,[]),spice:0}]));
 assert.equal(priceBasket([line('stir-basil',1,['chicken','extra-egg'])]).subtotalCents,1050);
});
test('disabled automatic midweek discount stays disabled',()=>{
 assert.equal(calculateCommercialOrder(input(),state()).header.total,9);
});
test('code weekday follows selected London service day and cannot apply at weekends',()=>{
 const code={code:'MIDWEEK10',active:true,discount_type:'percent',discount_value:10,allowed_weekdays:[3,4]};
 assert.equal(calculateCommercialOrder({...input(),discountCode:'midweek10'},{...state(),discount:code}).header.total,8.1);
 assert.throws(()=>calculateCommercialOrder({...input(),discountCode:'MIDWEEK10',preferredTime:'2026-11-07T18:00:00Z'},{...state(),discount:code}));
});
test('discount is capped and loyalty points exclude delivery and all discounts',()=>{
 const c={code:'SAVE2',active:true,discount_type:'fixed',discount_value:2};
 const r=calculateCommercialOrder({...input(),discountCode:'SAVE2',orderType:'delivery'},
  {...state(),discount:c,settledPoints:100,deliveryQuote:{straightLineMiles:1,routeMiles:1}});
 assert.equal(r.header.loyalty_discount,5);assert.equal(r.header.total,4);
 assert.equal(r.header.loyalty_points_earned_pending,2);assert.equal(r.header.loyalty_points_redeem_pending,100);
});
test('reserved pending reward cannot be spent by a second order',()=>{
 const r=calculateCommercialOrder(input(),{...state(),settledPoints:100,reservedPoints:100});
 assert.equal(r.header.loyalty_discount,0);
});
test('free delivery uses pre-discount £30 and never bypasses hard radius',()=>{
 const order={...input(),orderType:'delivery',items:[line('panang-curry',4)]};
 assert.equal(calculateCommercialOrder(order,{...state(),settledPoints:100,
  deliveryQuote:{straightLineMiles:2.9,routeMiles:5}}).header.delivery_fee,0);
 assert.throws(()=>calculateCommercialOrder(order,{...state(),deliveryQuote:{straightLineMiles:3.01,routeMiles:1}}));
});
test('route bands and unavailable-route £3 fallback match existing checkout',()=>{
 for(const [distance,fee] of [[1.5,2],[2.5,3],[4,4],[4.1,3],[null,3]]){
  const r=calculateCommercialOrder({...input(),orderType:'delivery'},
   {...state(),deliveryQuote:{straightLineMiles:1,routeMiles:distance}});
  assert.equal(r.header.delivery_fee,fee);
 }
});
test('existing in-advance payment preference and SMS default are preserved',()=>{
 const priced=calculateCommercialOrder({...input(),paymentPreference:'in_advance'},state());
 assert.equal(priced.header.payment_preference,'in_advance');
 assert.equal(priced.header.communication_preference,'sms');
});
