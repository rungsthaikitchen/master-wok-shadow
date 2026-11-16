// Private, expiring CPU rehearsal. No database client, writes, provider calls,
// booking authorization or production launch-control changes.
require('./master-wok-model-bundle');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {expandCommitments}=require('./master-wok-commitment-reader');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {priceBasket}=require('./master-wok-commercial');
const {relativePlacement}=require('./master-wok-clock');
const {createDeliveryCapacity}=require('./master-wok-delivery-capacity');
const {RESTAURANT}=require('./master-wok-delivery-quote');
const fixture=require('./staging-tests/availability-service-fixture.json');
const TOKEN_HASH='__CERTIFICATION_TOKEN__',EXPIRES='__BROWSER_EXPIRES__';
const date='2026-11-14',now=new Date(date+'T16:20:00Z');
const line=(item_id,qty,protein=null,spice=0)=>({item_id,qty,modifiers:protein?[{id:protein}]:[],spice});
const baskets={
 small:[line('pad-thai',1,'chicken'),line('chef-pad-thai',1,'chicken',1),line('green-curry',1,'chicken',1),line('jasmine-rice',1)],
 heavy:[line('tom-yum',2,'prawn',2),line('veg-spring-rolls',3),line('beef-salad',2,null,2),line('salt-chickenchips',2,null,1),line('salt-chickenchips',4,null,1)]
};
async function assess(kind,start,count){
 const model=globalThis.MasterWokModelV1,snapshot=structuredClone(fixture);
 const rows=expandCommitments(snapshot.rows,date);
 const orders=normalizeStagingOrders({rows,model,serviceDate:date}).map(o=>({...o,placedAt:relativePlacement(o.placedAt,date)}));
 const key=p=>JSON.stringify([Number(p.lat),Number(p.lng)]),legs=new Map();
 for(const trip of snapshot.plan.delivery.trips){
  let origin=RESTAURANT;
  trip.stops.forEach((stop,i)=>{legs.set(key(origin)+'>'+key(stop.destination),trip.legs[i]);origin=stop.destination;});
  legs.set(key(origin)+'>'+key(RESTAURANT),trip.legs.at(-1));
 }
 const capacity=createDeliveryCapacity({stagingSharedRings:true,quoteLeg:async({origin,destination})=>{
  const duration=legs.get(key(origin)+'>'+key(destination));
  if(!duration)throw Error('FIXTURE_ROUTE_MISSING');
  return {durationSeconds:duration*60};
 }});
 const hints=[],started=performance.now();
 for(let index=start;index<Math.min(61,start+count);index++){
  const ready=1020+index*5,time=date+'T'+String(Math.floor(ready/60)).padStart(2,'0')+':'+String(ready%60).padStart(2,'0')+':00Z';
  const prepared=prepareStagingBasket({id:'availability-candidate',createdAt:now,serviceDate:date,readyMinute:ready,items:priceBasket(baskets[kind]).items,model});
  if(prepared.status!=='PREPARED')throw Error('FIXTURE_NOT_PREPARED');
  const result=await capacity.verify({serviceDate:date,acceptedOrders:orders,rawRows:rows,
   state:{now,availability:{blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}},previousPlan:snapshot.plan},
   proposedOrder:{...prepared.candidate,placedAt:relativePlacement(now,date),rawRow:prepared.rawRow,
    validatedHeader:{order_type:'collection',preferred_time:time}}},
   {maxSearchNodes:1000,maxCompleteChecks:8,preserveOnly:true});
  hints.push({ready,status:result.status,reason:result.reason});
 }
 return {kind,start,hints,elapsedMs:Math.round(performance.now()-started),databaseRequests:0,notifications:0,bookings:0};
}
Deno.serve(async request=>{
 const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')return reply({error:'POST_REQUIRED'},405);
 if(Deno.env.get('SUPABASE_URL')!=='https://hvrqgufqjslvgiohgkvu.supabase.co'||Date.now()>Date.parse(EXPIRES))
  return reply({error:'REHEARSAL_DISABLED'},403);
 const token=request.headers.get('x-rehearsal-token')||'';
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 if(!/^[a-f0-9]{64}$/.test(token)||digest!==TOKEN_HASH)return reply({error:'UNAUTHORIZED'},401);
 try{
  const input=await request.json();
  if(!Object.hasOwn(baskets,input.kind)||!Number.isInteger(input.start)||input.start<0||input.start>60||
   !Number.isInteger(input.count)||input.count<1||input.count>6)return reply({error:'INVALID_FIXED_CASE'},400);
  return reply(await assess(input.kind,input.start,input.count));
 }catch(_){return reply({error:'REHEARSAL_FAILED'},500);}
});
