'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeReview,createBasketReviewStore}=require('./master-wok-basket-review');
const examples=require('./staging-tests/large-basket-examples');
const input=()=>({requestKey:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',orderType:'collection',
 customer:{name:' Test Customer ',phone:'+44 7825 000000'},preferredTime:'2026-11-12T20:15:00Z',items:structuredClone(examples.mixed)});
test('four customer £150 baskets retain quantities, modifiers and server prices',()=>{
 for(const items of Object.values(examples)){
  const result=normalizeReview({...input(),items});
  assert.equal(result.basket.reduce((n,i)=>n+i.qty*i.unit_price,0),150);
  assert.equal(result.customerName,'Test Customer');
  assert.deepEqual(result.basket.map(i=>[i.qty,i.modifiers.map(m=>m.id)]),items.map(i=>[i.qty,i.modifiers.map(m=>m.id)]));
 }
});
test('invalid contacts, baskets, delivery addresses and times never reach the database',async()=>{
 let writes=0;const save=createBasketReviewStore({pool:{query:async()=>{writes++;}}});
 for(const change of [{items:[]},{items:[null]},{items:[{item_id:'unknown',qty:1,modifiers:[]}]},
  {customer:{name:'',phone:'12345678'}},{customer:{name:'Test',phone:'abcdefgh'}},
  {preferredTime:'2026-11-12T20:15:00'},{requestKey:'bad'},
  {orderType:'delivery'},{orderType:'delivery',deliveryAddress:42}])
  await assert.rejects(save({...input(),...change}),/INVALID_REVIEW_REQUEST/);
 assert.equal(writes,0);
});
test('notes and delivery addresses survive while client prices and diagnostics are ignored',()=>{
 const request=input();request.items[0].item_note='Sauce separately';request.items[0].unit_price=0;
 const result=normalizeReview({...request,orderType:'delivery',deliveryAddress:'  1 Test Street, Leeds LS1 1AA ',assessment:{approved:true}});
 assert.equal(result.deliveryAddress,'1 Test Street, Leeds LS1 1AA');
 assert.equal(result.basket[0].item_note,'Sauce separately');
 assert.equal(result.basket[0].unit_price,6.5);
 assert.equal(result.assessment,undefined);
});
test('atomic upsert compares complete identity and never returns booking approval',async()=>{
 const calls=[];const save=createBasketReviewStore({pool:{query:async(sql,values)=>{
  calls.push({sql,values});return {rows:[{id:'review-id',status:'pending'}]};}}});
 assert.deepEqual(await save(input()),{success:true,reviewId:'review-id',status:'pending',bookingApprovalAllowed:false});
 assert.equal(calls.length,1);
 assert.match(calls[0].sql,/ON CONFLICT\(request_key\)/);
 assert.match(calls[0].sql,/saved.basket=excluded.basket/);
 assert.match(calls[0].sql,/delivery_address IS NOT DISTINCT FROM/);
 assert.equal(calls[0].values[6],null);
});
test('changed request with reused key reports conflict',async()=>{
 const save=createBasketReviewStore({pool:{query:async()=>({rows:[]})}});
 assert.deepEqual(await save(input()),{success:false,statusCode:409,reason:'REVIEW_REQUEST_KEY_CONFLICT'});
});

test('Admin review statuses use expected state and never invoke a booking writer',async()=>{
 const {createBasketReviewAdmin}=require('./master-wok-basket-review');
 const queries=[];const run=createBasketReviewAdmin({pool:{query:async(sql,values)=>{queries.push({sql,values});return {rows:[]};}}});
 assert.equal((await run({action:'accept_order'})).statusCode,400);
 assert.equal(queries.length,0);
 assert.equal((await run({action:'set_status',reviewId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',status:'resolved',expectedStatus:'pending'})).statusCode,409);
 assert.match(queries[0].sql,/AND status=\$3/);
 assert.deepEqual(queries[0].values,['resolved','aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','pending']);
 const listed=await run({action:'list'});assert.equal(listed.bookingApprovalAllowed,false);
 assert.match(queries[1].sql,/LIMIT 100/);
});

test('diagnostics distinguish model restrictions from unverified search and cannot approve a review',()=>{
 const {describeReviewAssessment}=require('./master-wok-basket-review');
 assert.equal(describeReviewAssessment({success:true,hints:[{available:false,reason:'BLACKOUT'}]}).status,'MODEL_RESTRICTION');
 for(const reason of ['SEARCH_LIMIT','AUXILIARY_SEARCH_SIZE_LIMIT','unknown'])
  assert.equal(describeReviewAssessment({success:true,hints:[{available:false,reason}]}).status,'UNVERIFIED');
 assert.equal(describeReviewAssessment({success:true,hints:[{available:true}]}).status,'MODEL_FIT');
});
test('diagnostic failure does not lose the customer review and browser assessment is never stored',async()=>{
 let values;const save=createBasketReviewStore({assessReview:async()=>{throw Error('Unavailable');},
  pool:{query:async(_sql,args)=>{values=args;return {rows:[{id:'saved',status:'pending'}]};}}});
 await save({...input(),assessment:{message:'Fake capacity approval'}});
 assert.equal(JSON.parse(values[7]).status,'UNAVAILABLE');
 assert.ok(!values[7].includes('Fake capacity approval'));
});
