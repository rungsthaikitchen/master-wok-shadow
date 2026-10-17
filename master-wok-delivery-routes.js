'use strict';
// Injected offline boundary only: no HTTP client, API keys, source writes or pricing.
const unknown=reasonCode=>({status:'UNVERIFIED',reasonCode,verified:false});
const alias=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(s)&&s!=='KITCHEN';
const stamp=s=>typeof s==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
function seconds(value) {
 // Strict provider duration form; never coerce null, blanks, units or distance.
 if(typeof value!=='string'||!/^\d+(?:\.\d{1,9})?s$/.test(value))return null;
 const n=Number(value.slice(0,-1));
 return Number.isFinite(n)&&n>=0&&n<=14400?n:null;
}
async function collectDeliveryRoutes(input,{enabled=false,quoteLeg,timeoutMs=1000}={}) {
 if(enabled!==true)return {status:'DISABLED',verified:false};
 try {
  input=structuredClone(input);
  if(!input||!Array.isArray(input.orders)||input.orders.length<1||input.orders.length>2||
     !stamp(input.assessedAt)||typeof quoteLeg!=='function'||
     !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)
   return unknown('ROUTE_CAPTURE_INPUT_UNVERIFIED');
  const orders=structuredClone(input.orders),ids=new Set();
  for(const o of orders) {
   if(!o||!alias(o.orderId)||ids.has(o.orderId)||o.orderType!=='delivery')
    return unknown('INVALID_DELIVERY_ORDER');
   ids.add(o.orderId);
  }
  const nodes=['KITCHEN',...ids],legs=[];
  // At most six bounded calls. Sequential calls avoid a burst against the provider.
  // Caller must enforce quota/budget and cancellation in a future network adapter.
  for(const from of nodes)for(const to of nodes)if(from!==to) {
   let timer;
   const controller=new AbortController();
   try {
    const response=await Promise.race([
     Promise.resolve().then(()=>quoteLeg({from,to,assessedAt:input.assessedAt},{signal:controller.signal})),
     new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},timeoutMs);})
    ]);
    // Direction and capture identity come from the adapter, not positional guesswork.
    if(!response||response.from!==from||response.to!==to||response.ok!==true||
       response.routingPreference!=='TRAFFIC_UNAWARE'||!stamp(response.estimatedAt)||
       Date.parse(response.estimatedAt)>Date.parse(input.assessedAt))
     return unknown('ROUTE_RESPONSE_UNVERIFIED');
    const durationSeconds=seconds(response.duration);
    if(durationSeconds===null)return unknown('ROUTE_DURATION_REQUIRED');
    legs.push({from,to,durationSeconds,basis:'ROUTE_DURATION_ESTIMATE',
     estimatedAt:response.estimatedAt});
   } catch(_){return unknown('ROUTE_CAPTURE_FAILED');}
   finally {clearTimeout(timer);}
  }
  // Atomic evidence: a partial matrix is never returned as complete.
  return {status:'ROUTE_ESTIMATES_CAPTURED',verified:false,assessedAt:input.assessedAt,
   routingPreference:'TRAFFIC_UNAWARE',legs};
 } catch(_){return unknown('ROUTE_CAPTURE_INPUT_UNVERIFIED');}
}
module.exports={collectDeliveryRoutes};
