const {test}=require('node:test');
const assert=require('node:assert/strict');
const {SubmissionAttempt,QUERY,PROJECT}=require('./checkout-submission-client.cjs');
const options=()=>({enabled:true,project:PROJECT,routeId:'7629f38e-9e24-5478-8413-e0848ef04cd3',orderId:'8269cd25-5959-5263-bba7-1dd2c25df88c',quoteId:'24e52bf5-67a6-55fd-a243-d3099eb05577',requestId:'synthetic-stable-request',checkout:{order_alias:'synthetic-checkout',lines:[{item_id:'green-curry',qty:2}]}});
test('disabled adapter returns before payload and transport use',async()=>{
 const input={get checkout(){throw Error('read');}};assert.equal((await new SubmissionAttempt(input).submit(()=>{throw Error('network');})).sourceRequests,0);
});
test('lost response retry retains the same request, order, quote and frozen basket',async()=>{
 const input=options(),attempt=new SubmissionAttempt(input),calls=[];input.checkout.lines[0].qty=99;
 await assert.rejects(attempt.submit(async p=>{calls.push(structuredClone(p));p.parameters[4].lines=[];throw Error('private diagnostic');}),/^Error: CHECKOUT_SUBMISSION_FAILED$/);
 assert.equal((await attempt.submit(async p=>{calls.push(p);return [{result:'ALREADY_RECORDED'}];})).status,'ALREADY_RECORDED');
 assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].query,QUERY);assert.equal(calls[1].parameters[4].lines[0].qty,2);
});
test('an HTTP-shaped success without a committed receipt is not checkout success',async()=>{
 for(const rows of [[],[{success:true}],[{result:'RECORDED',extra:1}],[{result:'PENDING'}]])await assert.rejects(new SubmissionAttempt(options()).submit(async()=>rows),/COMMITTED_RECEIPT_REQUIRED/);
});
test('production project, nonfinite or oversized basket is refused before transport',()=>{
 for(const change of [o=>o.project='ubyjrrsvbbqomitpaidb',o=>o.checkout.amount=NaN,o=>o.checkout.note='x'.repeat(100001),o=>o.requestId='']){
  const o=options();change(o);assert.throws(()=>new SubmissionAttempt(o));
 }
});
