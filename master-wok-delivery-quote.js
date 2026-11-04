'use strict';
// Reuses RTK's existing geocode-address/get-delivery-route-quote contracts.
// The browser supplies an address only; server-derived coordinates and the fixed
// restaurant origin determine eligibility before the free-delivery threshold.
const RESTAURANT={lat:53.744437,lng:-1.576570};
function haversineMiles(a,b){
 const rad=n=>n*Math.PI/180,dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng);
 const value=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
 return 3958.8*2*Math.atan2(Math.sqrt(value),Math.sqrt(Math.max(0,1-value)));
}
function createDeliveryQuoter({supabaseUrl,publicKey,fetch:transport=globalThis.fetch}={}){
 let url;try{url=new URL(supabaseUrl);}catch(_){throw Error('INVALID_DELIVERY_CONFIGURATION');}
 let publicAccess=typeof publicKey==='string'&&/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey);
 if(!publicAccess&&typeof publicKey==='string')try{
  const token=publicKey.split('.');publicAccess=token.length===3&&JSON.parse(atob(token[1].replaceAll('-','+').replaceAll('_','/'))).role==='anon';
 }catch(_){}
 if(url.protocol!=='https:'||!/^\w{20}\.supabase\.co$/.test(url.hostname)||url.username||url.password||url.port||
  url.pathname!=='/'||url.search||url.hash||!publicAccess||typeof transport!=='function')throw Error('INVALID_DELIVERY_CONFIGURATION');
 async function call(name,body,timeout){
  const response=await transport(new URL('/functions/v1/'+name,url),{method:'POST',
   headers:{'Content-Type':'application/json',apikey:publicKey},body:JSON.stringify(body),
   redirect:'error',signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw Error('DELIVERY_PROVIDER_UNAVAILABLE');
  return response.json();
 }
 return async function quote({address,subtotalCents}){
  if(typeof address!=='string'||!address.trim()||address.length>1000||!Number.isInteger(subtotalCents)||subtotalCents<0)
   throw Error('INVALID_DELIVERY_ADDRESS');
  let geo;try{geo=await call('geocode-address',{customer_address:address.trim()},5000);}
  catch(_){throw Error('DELIVERY_GEOCODING_UNAVAILABLE');}
  if(geo?.ok!==true)throw Error('DELIVERY_ADDRESS_NOT_ELIGIBLE');
  const customer={lat:geo.customer_lat,lng:geo.customer_lng};
  if(!Number.isFinite(customer.lat)||Math.abs(customer.lat)>90||!Number.isFinite(customer.lng)||Math.abs(customer.lng)>180)
   throw Error('DELIVERY_GEOCODING_UNAVAILABLE');
  const straightLineMiles=haversineMiles(RESTAURANT,customer);
  if(straightLineMiles>3)throw Error('DELIVERY_ADDRESS_NOT_ELIGIBLE');
  let routeMiles=null;
  if(subtotalCents<3000)try{
   const route=await call('get-delivery-route-quote',{origin:RESTAURANT,destination:customer},2500);
   if(route?.ok===true&&Number.isFinite(route.routeMiles)&&route.routeMiles>=0)routeMiles=route.routeMiles;
  }catch(_){} // Existing £3 fallback is allowed only after proving the radius.
  return {straightLineMiles,routeMiles,customerLatitude:customer.lat,customerLongitude:customer.lng};
 };
}
module.exports={createDeliveryQuoter,haversineMiles,RESTAURANT};
