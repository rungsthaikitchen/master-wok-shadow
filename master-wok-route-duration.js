'use strict';
const {createDeliveryQuoter}=require('./master-wok-delivery-quote');
// The existing route Edge already returns Google's duration (e.g. "374s").
// Direction matters: never assume the return leg equals the outbound leg.
function createRouteDurationQuoter({supabaseUrl,publicKey,fetch:transport=globalThis.fetch}={}){
 createDeliveryQuoter({supabaseUrl,publicKey,fetch:transport}); // Existing origin/key validation.
 const cache=new Map();
 return async function quoteLeg({origin,destination}){
  const valid=p=>p&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180;
  if(!valid(origin)||!valid(destination))throw Error('INVALID_ROUTE_COORDINATES');
  const k=JSON.stringify([origin.lat,origin.lng,destination.lat,destination.lng]),cached=cache.get(k);
  if(cached&&cached.expires>Date.now())return cached.promise;
  const promise=(async()=>{
   const response=await transport(new URL('/functions/v1/get-delivery-route-quote',supabaseUrl),{
    method:'POST',headers:{'Content-Type':'application/json',apikey:publicKey},
    body:JSON.stringify({origin,destination}),redirect:'error',signal:AbortSignal.timeout(2500)});
   if(!response.ok)throw Error('DELIVERY_TRAVEL_TIME_UNAVAILABLE');
   const r=await response.json();
   if(r?.ok!==true||typeof r.duration!=='string'||!/^\d+(?:\.\d+)?s$/.test(r.duration))throw Error('DELIVERY_TRAVEL_TIME_UNAVAILABLE');
   const durationSeconds=Number(r.duration.slice(0,-1));
   if(!Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>7200)throw Error('DELIVERY_TRAVEL_TIME_UNAVAILABLE');
   return {durationSeconds};
  })();
  // Five-minute cache avoids repeating identical calls for every dropdown hint.
  if(cache.size>=256)cache.delete(cache.keys().next().value);
  cache.set(k,{expires:Date.now()+300000,promise});
  try{return await promise;}catch(error){if(cache.get(k)?.promise===promise)cache.delete(k);throw error;}
 };
}
module.exports={createRouteDurationQuoter};
