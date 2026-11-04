'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planCoordinatedKitchen}=require('./staging-coordinated-kitchen');
const at=(h,m)=>new Date(2026,9,17,h,m);
const orders=[
 {orderId:'A',readyMinute:1140,placedAt:at(17,30)},
 {orderId:'B',readyMinute:1140,placedAt:at(17,35)},
 {orderId:'C',readyMinute:1155,placedAt:at(17,40)},
 {orderId:'D',readyMinute:1170,placedAt:at(17,45)}
];
const line=(item_id,qty=1,modifiers=[])=>({item_id,qty,modifiers});
const rows=[
 {id:'A',items:[line('panang-curry',2),line('jasmine-rice')]},
 {id:'B',items:[line('pad-thai'),line('stir-crispy')]},
 {id:'C',items:[line('stir-basil',1,[{id:'extra-bchicken'}])]},
 {id:'D',items:[line('green-curry')]}
];
test('representative wok-and-fryer service remains fail closed unless fully coordinated',()=>{
 const r=planCoordinatedKitchen(orders,rows);
 assert.equal(r.bookingApprovalAllowed,false);
 assert.ok(['COORDINATED_PROTOTYPE','UNVERIFIED'].includes(r.status));
 if(r.status==='COORDINATED_PROTOTYPE'){
  assert.ok(r.fryer.jobs.length>0);
  for(const f of r.fryer.jobs){
   const matches=r.wok.jobs.filter(w=>f.itemIds.includes(w.itemId)&&f.orderIds.some(id=>w.orderIds.includes(id)));
   assert.ok(matches.length>0);
   assert.ok(matches.some(w=>f.finish<=w.start));
  }
 }
});
test('unmodelled fried starters explicitly block mixed service',()=>{
 const withStarter=rows.map(r=>r.id==='D'?{...r,items:[...r.items,line('veg-spring-rolls')]}:r);
 const r=planCoordinatedKitchen(orders,withStarter);
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.bookingApprovalAllowed,false);
});
test('no live approval even for simple feasible mixed service',()=>{
 const r=planCoordinatedKitchen(orders,rows);
 assert.equal(r.bookingApprovalAllowed,false);
});
