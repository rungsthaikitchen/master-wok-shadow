'use strict';
// Launch gate: display the actual mixed-service result, not merely a passing test.
const {planCoordinatedKitchen}=require('../staging-coordinated-kitchen');
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
const result=planCoordinatedKitchen(orders,rows);
console.log(JSON.stringify({
 status:result.status,reason:result.reason,
 wokStatus:result.wok&&result.wok.status,
 wokReason:result.wok&&result.wok.reason,
 fryerStatus:result.fryer&&result.fryer.status,
 fryerReason:result.fryer&&result.fryer.reason,
 wokJobs:result.wok&&result.wok.jobs&&result.wok.jobs.length,
 fryerJobs:result.fryer&&result.fryer.jobs&&result.fryer.jobs.length,
 bookingApprovalAllowed:result.bookingApprovalAllowed
},null,2));
