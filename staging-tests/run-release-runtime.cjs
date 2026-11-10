'use strict';
// Explicit private-project integration runner, never a production client.
const fs=require('node:fs');
const {calculateCommercialOrder,priceBasket,catalog}=require('../master-wok-commercial');
const {createDeliveryQuoter}=require('../master-wok-delivery-quote');
const config=JSON.parse(fs.readFileSync(process.env.MASTER_WOK_PRIVATE_CONFIG_FILE,'utf8'));
if(!/^[a-f0-9]{64}$/.test(config.MASTER_WOK_BOOKING_SECRET||''))throw Error('PRIVATE_SECRET_REQUIRED');
const prefix=process.env.MASTER_WOK_RUN_PREFIX||'release-nov3-candidate-',proofPath=process.env.MASTER_WOK_RUNTIME_PROOF_FILE||'/tmp/mw-release-runtime-proof.json',date=process.env.MASTER_WOK_SERVICE_DATE||'2026-11-06',proof={status:'RUNNING',checks:[],orderIds:[],productionMutations:0,realNotificationsSent:0};
const fixtureEmail=process.env.MASTER_WOK_WORKER_FIXTURE_EMAIL||'release-nov3-candidate@example.invalid';
if(!['release-nov3-candidate@example.invalid','release-nov6-delivery@example.invalid'].includes(fixtureEmail))throw Error('INVALID_FIXTURE_EMAIL');
if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T17:20:00Z'))||new Date(date+'T17:20:00Z').toISOString().slice(0,10)!==date)throw Error('INVALID_SERVICE_DATE');
const openingDate=process.env.MASTER_WOK_OPENING_DATE||'2026-11-07';
if(!/^\d{4}-\d{2}-\d{2}$/.test(openingDate)||!Number.isFinite(Date.parse(openingDate+'T17:00:00Z'))||new Date(openingDate+'T17:00:00Z').toISOString().slice(0,10)!==openingDate||openingDate===date)throw Error('INVALID_OPENING_DATE');
const check=(ok,name)=>{if(!ok)throw Error(name);proof.checks.push(name);};
const bridge=process.env.MASTER_WOK_RUNTIME_BRIDGE_DIR;
let sequence=0;
async function transport(url,options){
 if(!bridge)return fetch(url,options);
 const target=new URL(url);
 const booking=target.href==='https://hvrqgufqjslvgiohgkvu.supabase.co/functions/v1/master-wok-booking';
 const quote=target.origin==='https://'+config.MASTER_WOK_DELIVERY_PROJECT_REF+'.supabase.co'&&
  ['/functions/v1/geocode-address','/functions/v1/get-delivery-route-quote'].includes(target.pathname)&&
  !target.search&&!target.hash;
 if((!booking&&!quote)||options.method!=='POST')throw Error('INVALID_RELAY_TARGET');
 const file=bridge+'/'+(++sequence);
 fs.writeFileSync(file+'.tmp',JSON.stringify({operation:booking?'booking':target.pathname.split('/').pop(),body:JSON.parse(options.body)}),{mode:0o600});
 fs.renameSync(file+'.tmp',file+'.request.json');
 const deadline=Date.now()+30000;
 while(!fs.existsSync(file+'.response.json')){
  if(Date.now()>=deadline)throw Error('STAGING_RELAY_TIMEOUT');
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 const {status,body}=JSON.parse(fs.readFileSync(file+'.response.json','utf8'));
 return new Response(JSON.stringify(body),{status});
}
async function call(operation,payload){
 const response=await transport('https://hvrqgufqjslvgiohgkvu.supabase.co/functions/v1/master-wok-booking',{
  method:'POST',headers:{'content-type':'application/json','x-master-wok-secret':config.MASTER_WOK_BOOKING_SECRET},
  body:JSON.stringify({operation,payload}),signal:AbortSignal.timeout(30000)});
 return {http:response.status,body:await response.json()};
}
const line=id=>{const i=catalog.items.find(i=>i.id===id);return {item_id:id,qty:1,
 modifiers:i.modifierRequired?[{id:i.allowedModifiers.includes('chicken')?'chicken':i.allowedModifiers[0]}]:[],
 spice:i.spiceEnabled?(i.spiceDefault||i.spiceMin||0):0};};
(async()=>{
 if(process.argv[2]==='--race-only'){
  const input={orderType:'collection',preferredTime:'2026-11-11T17:00:00Z',communicationPreference:'email',
   customer:{name:'Private concurrent fixture',phone:'07700900123',email:fixtureEmail},
   items:[{item_id:'green-curry',qty:4,modifiers:[{id:'tofu'}],spice:1}]};
  input.expectedTotals=calculateCommercialOrder(input,{now:new Date()}).header;
  const result=await Promise.all(['a','b'].map(suffix=>call('checkout',{...input,key:prefix+'race-'+suffix})));
  check(result.filter(r=>r.http===200&&r.body.success).length===1&&result.filter(r=>r.http===409).length===1,'distinct-key-conflict-serialized');
  const proof={status:'PASS',scope:'DISTINCT_CONCURRENT_BASKETS_AT_COLD_START_CAPACITY',statuses:result.map(r=>r.http),committed:result.filter(r=>r.body.committed).length,productionMutations:0};
  fs.writeFileSync('/tmp/mw-release-race-proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));return;
 }
 const sets=[['green-curry','jasmine-rice','fish-cakes'],['pad-thai','fried-prawns','sticky-rice'],
  ['stir-crispy','egg-rice','veg-spring-rolls'],['panang-curry','coconut-rice','thai-sausage'],
  ['pad-see-ew','pork-dumplings','jasmine-rice'],['stir-basil','fried-egg','spare-ribs'],
  ['massaman-curry','jasmine-rice','chicken-satay'],['stir-cashew','sticky-rice','moo-ping'],
  ['pad-kee-mao','fried-tofu','jasmine-rice'],['red-curry','coconut-rice','fish-cakes'],
  ['stir-sweetsour','egg-rice','fried-prawns'],['panang-curry','jasmine-rice','veg-spring-rolls']];
 const quoteDelivery=createDeliveryQuoter({
  supabaseUrl:'https://'+config.MASTER_WOK_DELIVERY_PROJECT_REF+'.supabase.co',
  publicKey:config.MASTER_WOK_DELIVERY_PUBLIC_KEY,fetch:transport
 });
 for(let n=0;n<sets.length;n++){
  const ready=new Date(date+'T17:20:00Z');ready.setUTCMinutes(ready.getUTCMinutes()+n*20);
  const input={key:prefix+n,orderType:n===0?'delivery':'collection',preferredTime:ready.toISOString(),
   customer:{name:'Private release fixture',phone:'07700900123',email:fixtureEmail,
    address:n===0?'Morley Town Hall, Queen Street, Morley, Leeds LS27 9DY, UK':''},
   communicationPreference:'email',items:sets[n].map(line)};
  const deliveryQuote=n===0?await quoteDelivery({
   address:input.customer.address,
   subtotalCents:priceBasket(input.items).subtotalCents
  }):null;
  input.expectedTotals=calculateCommercialOrder(input,{now:new Date(),deliveryQuote}).header;
  const responses=n===0?await Promise.all([call('checkout',input),call('checkout',input)]):[await call('checkout',input)];
  check(responses.every(r=>r.http===200&&r.body.success),'joined-basket-'+n);
  if(n===0){check(responses.filter(r=>r.body.committed).length===1&&responses[0].body.orderId===responses[1].body.orderId,'concurrent-same-key-one-commit');proof.firstInput=input;}
  proof.orderIds.push(responses[0].body.orderId);
  fs.writeFileSync(proofPath,JSON.stringify(proof,null,2));
  console.log('Committed basket',n+1);
 }
 const hintInput={orderType:'collection',items:[line('green-curry')],times:[date+'T17:20:00Z']};
 check((await call('service_control',{action:'set_service_state',mode:'paused'})).http===200,'pause-set');
 try {
  const paused=await call('availability',hintInput);
  check(paused.http===200&&paused.body.hints[0].available===false,'pause-blocks-hints');
 } finally {
  check((await call('service_control',{action:'set_service_state',mode:'normal'})).http===200,'normal-restored');
 }
 const blackout=await call('service_control',{action:'create_blackout',kind:'fully_booked',start_at:date+'T17:15:00Z',end_at:date+'T17:25:00Z',message:'Private release restriction'});
 check(blackout.http===200,'blackout-created');proof.blackoutId=blackout.body.blackout[0].id;
 try {
  const blocked=await call('availability',hintInput);
  check(blocked.http===200&&blocked.body.hints[0].available===false,'blackout-blocks-hints');
 } finally {
  check((await call('service_control',{action:'deactivate_blackout',blackout_id:proof.blackoutId})).http===200,'blackout-deactivated');
 }
 const excessive={...proof.firstInput,key:prefix+'overflow',orderType:'collection',items:[{...line('green-curry'),qty:100}]};
 excessive.expectedTotals=calculateCommercialOrder(excessive,{now:new Date()}).header;
 check((await call('checkout',excessive)).http===409,'physical-overflow-refused');
 check((await call('admin_action',{action:'suggest_time',orderId:proof.orderIds[0],proposedTime:date+'T17:25:00Z'})).http===200,'time-proposal-committed');
 check((await call('admin_action',{action:'complete',orderId:proof.orderIds[1]})).http===200,'completion-committed');
 check((await call('admin_action',{action:'complete',orderId:proof.orderIds[1]})).http===200,'completion-replay-stable');
 check((await call('admin_action',{action:'decline',orderId:proof.orderIds[2]})).http===200,'cancellation-committed');
 const cold={...proof.firstInput,key:prefix+'cold-first',orderType:'collection',preferredTime:openingDate+'T17:00:00Z',items:[{item_id:'green-curry',qty:4,modifiers:[{id:'tofu'}],spice:1}]};
 cold.expectedTotals=calculateCommercialOrder(cold,{now:new Date()}).header;
 const firstCold=await call('checkout',cold);check(firstCold.http===200&&firstCold.body.success,'cold-first-order-committed');proof.coldOrderId=firstCold.body.orderId;
 check((await call('checkout',{...cold,key:prefix+'cold-conflict'})).http===409,'cold-warmup-overflow-refused');
 const coldHints=await call('availability',{orderType:'collection',items:cold.items,times:[openingDate+'T17:00:00Z',openingDate+'T17:05:00Z']});
 check(coldHints.http===200&&coldHints.body.hints[0].available===false&&coldHints.body.hints[1].available===true,'cold-warmup-next-slot-offered');
 proof.status='PASS_CHECKOUT_AND_CONTROLS';fs.writeFileSync(proofPath,JSON.stringify(proof,null,2));
 console.log(JSON.stringify({status:proof.status,orders:proof.orderIds.length,checks:proof.checks.length}));
})().catch(e=>{proof.status='FAIL';proof.reason=e.message;fs.writeFileSync(proofPath,JSON.stringify(proof,null,2));console.error(e.message);process.exitCode=1;});
