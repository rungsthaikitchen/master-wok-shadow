'use strict';
// Standalone staging-only route test. No Supabase, checkout or order mutations.
const https=require('node:https');
const {collectDeliveryRoutes}=require('./master-wok-delivery-routes');
const ENDPOINT='https://routes.googleapis.com/directions/v2:computeRoutes';
const failed=(reasonCode,networkRequests=0)=>({status:'UNVERIFIED',reasonCode,verified:false,networkRequests});
const stamp=s=>typeof s==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
const alias=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(s)&&s!=='KITCHEN';

function createGoogleTransport({request=https.request}={}) {
 return ({body,apiKey,timeoutMs=5000,signal})=>new Promise((resolve,reject)=>{
  let req,timer,settled=false;
  const finish=(error,value)=>{
   if(settled)return;settled=true;clearTimeout(timer);
   signal?.removeEventListener('abort',abort);
   if(error){req?.destroy();reject(Error('ROUTE_TRANSPORT_FAILED'));}else resolve(value);
  };
  const abort=()=>finish(true);
  if(signal?.aborted){finish(true);return;}
  try {
   const bytes=Buffer.from(JSON.stringify(body));
   req=request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',
    'Content-Length':bytes.length,'X-Goog-Api-Key':apiKey,'X-Goog-FieldMask':'routes.duration'}},res=>{
    res.on('error',()=>finish(true));res.on('aborted',()=>finish(true));
    // Never follow a redirect or return error bodies containing request details.
    if(res.statusCode!==200){res.resume();finish(true);return;}
    let size=0;const chunks=[];
    res.on('data',chunk=>{
     size+=chunk.length;
     if(size>65536){res.destroy();finish(true);}else chunks.push(chunk);
    });
    res.on('end',()=>{
     if(settled)return;
     try {finish(false,{status:200,data:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}
     catch(_){finish(true);}
    });
   });
   req.on('error',()=>finish(true));
   signal?.addEventListener('abort',abort,{once:true});
   timer=setTimeout(abort,timeoutMs);
   req.end(bytes);
  } catch(_){finish(true);}
 });
}

async function collectGoogleStagingRoutes(input,{enabled=false,allowLiveRequests=false,stage,
 apiKey,transport=createGoogleTransport(),maxRequests=6,clock=()=>new Date().toISOString()}={}) {
 if(enabled!==true)return {status:'DISABLED',verified:false,networkRequests:0};
 if(allowLiveRequests!==true||stage!=='staging')return failed('STAGING_ROUTE_ACCESS_NOT_ENABLED');
 let calls=0;
 try {
  const s=structuredClone(input);
  if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>512||/[\r\n]/.test(apiKey)||
     typeof transport!=='function'||typeof clock!=='function'||!Number.isSafeInteger(maxRequests)||maxRequests<1||maxRequests>6||
     !s||!Array.isArray(s.orders)||s.orders.length<1||s.orders.length>2||!s.points)
   return failed('STAGING_ROUTE_CONFIG_UNVERIFIED');
  const ids=new Set();
  for(const o of s.orders){
   if(!o||!alias(o.orderId)||ids.has(o.orderId)||o.orderType!=='delivery')return failed('INVALID_DELIVERY_ORDER');
   ids.add(o.orderId);
  }
  const nodes=['KITCHEN',...ids],needed=nodes.length*(nodes.length-1);
  if(needed>maxRequests)return failed('STAGING_REQUEST_BUDGET_EXCEEDED');
  if(Object.keys(s.points).sort().join()!==[...nodes].sort().join())return failed('ROUTE_POINT_COVERAGE_UNVERIFIED');
  for(const node of nodes){const p=s.points[node];
   if(!p)return failed('ROUTE_COORDINATES_UNVERIFIED');
   if(Object.keys(p).join()==='address') {
    if(typeof p.address!=='string'||!p.address.trim()||p.address.length>256||/[\x00-\x1f]/.test(p.address))
     return failed('ROUTE_POINT_UNVERIFIED');
   } else if(Object.keys(p).sort().join()!=='lat,lng'||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||p.lat< -90||p.lat>90||p.lng< -180||p.lng>180)
    return failed('ROUTE_COORDINATES_UNVERIFIED');
  }
  const waypoint=node=>s.points[node].address?{address:s.points[node].address}:
   {location:{latLng:{latitude:s.points[node].lat,longitude:s.points[node].lng}}};
  const quotes=new Map();
  for(const from of nodes)for(const to of nodes)if(from!==to) {
   calls++;
   const response=await transport({apiKey,timeoutMs:5000,body:{origin:waypoint(from),destination:waypoint(to),
    travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE',computeAlternativeRoutes:false}});
   if(!response||response.status!==200||!Array.isArray(response.data?.routes)||response.data.routes.length!==1)
    return failed('GOOGLE_ROUTE_RESPONSE_UNVERIFIED',calls);
   const duration=response.data.routes[0]?.duration;
   if(typeof duration!=='string'||!/^\d+(?:\.\d{1,9})?s$/.test(duration)||Number(duration.slice(0,-1))>14400)
    return failed('GOOGLE_ROUTE_DURATION_UNVERIFIED',calls);
   const estimatedAt=clock();if(!stamp(estimatedAt))return failed('ROUTE_CLOCK_UNVERIFIED',calls);
   quotes.set(from+'/'+to,{from,to,ok:true,duration,estimatedAt,routingPreference:'TRAFFIC_UNAWARE'});
  }
  const assessedAt=clock();if(!stamp(assessedAt))return failed('ROUTE_CLOCK_UNVERIFIED',calls);
  const result=await collectDeliveryRoutes({orders:s.orders.map(o=>({orderId:o.orderId,orderType:'delivery'})),assessedAt},
   {enabled:true,quoteLeg:({from,to})=>quotes.get(from+'/'+to)});
  return {...result,networkRequests:calls,provider:'GOOGLE_ROUTES',attribution:'Google Maps',
   persistence:'MEMORY_ONLY'};
 } catch(_){return failed('GOOGLE_ROUTE_CAPTURE_FAILED',calls);}
}
module.exports={collectGoogleStagingRoutes,createGoogleTransport};
