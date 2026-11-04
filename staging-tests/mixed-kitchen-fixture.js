'use strict';
// Staging-only mixed kitchen fixture. Timings are hypotheses, not approved recipes.
const orders=[
 {orderId:'A',readyMinute:1140,placedAt:new Date(2026,9,17,17,30)},
 {orderId:'B',readyMinute:1140,placedAt:new Date(2026,9,17,17,35)},
 {orderId:'C',readyMinute:1155,placedAt:new Date(2026,9,17,17,40)},
 {orderId:'D',readyMinute:1170,placedAt:new Date(2026,9,17,17,45)}
];
const line=(item_id,qty=1,modifiers=[])=>({item_id,qty,modifiers});
const rows=[
 {id:'A',items:[line('panang-curry',2),line('jasmine-rice')]},
 {id:'B',items:[line('pad-thai'),line('stir-crispy')]},
 {id:'C',items:[line('stir-basil',1,[{id:'extra-bchicken'}]),line('chips')]},
 {id:'D',items:[line('green-curry'),line('veg-spring-rolls')]}
];
module.exports={orders,rows};
