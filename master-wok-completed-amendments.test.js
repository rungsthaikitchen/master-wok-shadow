'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {completedLoyalty,paymentSummary}=require('./master-wok-completed-amendments');
const before={customer_id:'c',total:25.5,paid:true,loyalty_settled:true,loyalty_points_earned_pending:22,loyalty_points_redeem_pending:0};
function connection(balance=72){return {query:async sql=>({rows:sql.includes('.customers')?[{phone:'07700900995'}]:[{id:'a',points_balance:balance,lifetime_points:572}]})};}
test('settled loyalty adjusts only the earned difference and restores released redemptions',async()=>{
 const a=await completedLoyalty(connection(),before,{...before,loyalty_points_earned_pending:20},{schema:'public'});assert.equal(a.after.pointsBalance,70);assert.equal(a.after.lifetimePoints,570);
 const b=await completedLoyalty(connection(),{...before,loyalty_points_redeem_pending:100},{...before,loyalty_points_earned_pending:0},{schema:'public'});assert.equal(b.after.pointsBalance,150);assert.equal(b.redeemedPointsRestored,100);
});
test('spent points or missing account refuse instead of clamping away an adjustment',async()=>{
 await assert.rejects(completedLoyalty(connection(0),before,{...before,loyalty_points_earned_pending:20},{schema:'public'}),/BALANCE_NEEDS_REVIEW/);
 await assert.rejects(completedLoyalty({query:async()=>({rows:[]})},before,{...before,loyalty_points_earned_pending:20},{schema:'public'}),/ACCOUNT_REQUIRED/);
});
test('no loyalty change needs no account write and unknown historic payment is not invented',async()=>{
 assert.equal(await completedLoyalty({query:()=>{throw Error('no query');}},before,before,{schema:'public'}),null);
 assert.deepEqual(paymentSummary(before,null),{recorded:false,methodUnknown:true,balance:null});
 assert.equal(paymentSummary({...before,total:30},{bill_amount:25.5,bill_method:'card',tip_amount:4,tip_method:'cash'}).balance.underpayment,'4.50');
});
test('settled historical loyalty with missing original award data requires review',async()=>{
 await assert.rejects(completedLoyalty(connection(),{...before,loyalty_points_earned_pending:null},{...before,loyalty_points_earned_pending:20},{schema:'public'}),/INVALID_LOYALTY_STATE/);
});
