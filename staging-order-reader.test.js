'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readStagingOrders}=require('./staging-order-reader');
test('reads via supplied transaction connection with date parameter',async()=>{
 let captured;
 const rows=[{id:'a',items:[]}];
 const result=await readStagingOrders({query:async(sql,params)=>{captured={sql,params};return {rows};}},'2026-11-01');
 assert.equal(result,rows);
 assert.deepEqual(captured.params,['2026-11-01',false]);
 assert.match(captured.sql,/\$2::boolean/);
 assert.match(captured.sql,/Europe\/London/);
 assert.match(captured.sql,/order_items/);
 assert.match(captured.sql,/coalesce\(o.confirmed_time, o.proposed_time, o.preferred_time\)/);
});
test('rejects invalid date without query',async()=>{
 await assert.rejects(readStagingOrders({query:async()=>{throw Error('should not run');}},'tomorrow'),/INVALID_READ_REQUEST/);
});
test('rejects missing rows result',async()=>{
 await assert.rejects(readStagingOrders({query:async()=>({})},'2026-11-01'),/INVALID_QUERY_RESULT/);
});
