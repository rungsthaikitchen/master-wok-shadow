// Private expiring, database-free rehearsal of the slow delivery basket.
require('./master-wok-model-bundle');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {createDeliveryCapacity}=require('./master-wok-delivery-capacity');
const items=require('./staging-tests/slow-basket-2026-11-18.json');
Deno.serve(async request=>{
 const reply=(x,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store'}});
 if(Deno.env.get('SUPABASE_URL')!=='https://hvrqgufqjslvgiohgkvu.supabase.co'||Date.now()>Date.parse('__BROWSER_EXPIRES__'))return reply({error:'DISABLED'},403);
 const token=request.headers.get('x-rehearsal-token')||'';
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 if(!/^[a-f0-9]{64}$/.test(token)||hash!=='__CERTIFICATION_TOKEN__')return reply({error:'UNAUTHORIZED'},401);
 const input=await request.json();
 if(!['collection','delivery'].includes(input.type)||!Number.isInteger(input.start)||input.start<0||input.start>60||!Number.isInteger(input.count)||input.count<1||input.count>16||!Number.isInteger(input.routeMinutes??4)||(input.routeMinutes??4)<1||(input.routeMinutes??4)>18)return reply({error:'INVALID_FIXED_CASE'},400);
 const date='2026-11-18',now=date+'T06:25:00Z',results=[],started=performance.now();
 const capacity=createDeliveryCapacity({stagingSharedRings:true,quoteLeg:async()=>({durationSeconds:(input.routeMinutes??4)*60})});
 for(let slot=input.start;slot<Math.min(61,input.start+input.count);slot++){
  const time=new Date(Date.UTC(2026,10,18,17,slot*5)).toISOString();
  const p=prepareStagingBasket({id:'candidate',createdAt:now,serviceDate:date,readyMinute:1020+slot*5,items,model:globalThis.MasterWokModelV1});
  const r=await capacity.verify({assessmentPurpose:'AVAILABILITY_HINT',serviceDate:date,acceptedOrders:[],rawRows:[],state:{now,availability:{blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}},previousPlan:null},proposedOrder:{...p.candidate,rawRow:p.rawRow,validatedHeader:{order_type:input.type,preferred_time:time,customer_lat:53.752,customer_lng:-1.58}}},{maxSearchNodes:1000,maxCompleteChecks:8,preserveOnly:true});
  let maxKitchenHold=null,maxDoorAge=null;
  if(r.plan){const trips=r.plan.delivery.trips;const food=[...r.plan.wok.jobs,...r.plan.fryer.jobs.filter(j=>j.standalone),...(r.plan.auxiliary?.jobs||[]).filter(j=>!['egg-rice','coconut-rice'].includes(j.itemId))];
   const ages=trips.flatMap(t=>t.stops.flatMap(stop=>food.filter(j=>j.orderIds.includes(stop.id)).map(j=>({kitchen:t.start-j.finish,door:stop.arrival-j.finish}))));
   if(ages.length){maxKitchenHold=Math.max(...ages.map(a=>a.kitchen));maxDoorAge=Math.max(...ages.map(a=>a.door));}}
  results.push({time,status:r.status,reason:r.reason,maxKitchenHold,maxDoorAge});
 }
 return reply({results,elapsedMs:Math.round(performance.now()-started),databaseRequests:0,notifications:0,bookings:0});
});
