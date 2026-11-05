'use strict';
// One driver. Trips are reservations, not evidence of a completed delivery.
// Minutes use the service day's London clock, matching the kitchen allocator.
const {RESTAURANT}=require('./master-wok-delivery-quote');
const {relativePlacement}=require('./master-wok-clock');
const POLICY=Object.freeze({arrivalTolerance:10,loading:2,handover:2,maxFoodAge:20,preferredFoodAge:15});
const overlap=(a,b)=>a.start<b.finish&&b.start<a.finish;
const coordinate=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
const key=p=>JSON.stringify([p.lat,p.lng]);
const sameSource=(a,b)=>a.stops.length===1&&b.stops.length===1&&a.stops[0].sourceId===b.stops[0].sourceId;
function validateDriverPlan(plan){
 if(!plan||plan.version!==1||!Array.isArray(plan.trips))throw Error('INVALID_DRIVER_PLAN');
 const ids=new Set();
 for(const t of plan.trips){
  if(typeof t.id!=='string'||ids.has(t.id)||!Number.isInteger(t.start)||!Number.isInteger(t.departure)||
   !Number.isInteger(t.finish)||t.start<990||t.finish<=t.departure||t.departure-t.start!==POLICY.loading||
   !Array.isArray(t.stops)||!t.stops.length||t.stops.length>2||!Array.isArray(t.legs)||t.legs.length!==t.stops.length+1)
   throw Error('INVALID_DRIVER_PLAN');
  ids.add(t.id);let time=t.departure;const stopIds=new Set();
  for(let i=0;i<t.stops.length;i++){
   const s=t.stops[i],leg=t.legs[i];
   if(!s||typeof s.id!=='string'||typeof s.sourceId!=='string'||stopIds.has(s.id)||!coordinate(s.destination)||
    !Number.isInteger(s.target)||!Number.isInteger(s.arrival)||!Number.isInteger(leg)||leg<1||
    s.arrival!==time+leg||Math.abs(s.arrival-s.target)>POLICY.arrivalTolerance||
    s.arrival-t.start>POLICY.maxFoodAge)throw Error('INVALID_DRIVER_PLAN');
   stopIds.add(s.id);time=s.arrival+POLICY.handover;
  }
  const home=t.legs.at(-1);if(!Number.isInteger(home)||home<1||t.finish!==time+home)throw Error('INVALID_DRIVER_PLAN');
 }
 for(let i=0;i<plan.trips.length;i++)for(let j=i+1;j<plan.trips.length;j++)
  if(overlap(plan.trips[i],plan.trips[j])&&!sameSource(plan.trips[i],plan.trips[j]))throw Error('DRIVER_RESERVATION_CONFLICT');
 return true;
}
function minute(instant,date){const d=relativePlacement(instant,date);return d.getHours()*60+d.getMinutes()+d.getSeconds()/60;}
function rowDemand(row){
 if(row.order_type!=='delivery')return null;
 // PostgreSQL numeric columns arrive as strings through pg; these are
 // server-stored coordinates, never browser routing claims.
 const number=value=>typeof value==='number'?value:typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)?Number(value):NaN;
 const destination={lat:number(row.customer_lat),lng:number(row.customer_lng)};
 if(!coordinate(destination)||!Number.isInteger(row.local_ready_minute))throw Error('DELIVERY_COORDINATES_REQUIRED');
 return {id:String(row.id),sourceId:String(row.source_order_id||row.id),target:row.local_ready_minute,destination};
}
function createDriverPlanner({quoteLeg}={}){
 if(typeof quoteLeg!=='function')throw Error('TRUSTED_ROUTE_DURATION_REQUIRED');
 return async function planDriver({rows,previousPlan,serviceDate,now,combine,splitTripId}={}){
  if(!Array.isArray(rows))throw Error('INVALID_DRIVER_DEMAND');
  const asOf=minute(now,serviceDate),demands=rows.map(rowDemand).filter(Boolean),byId=new Map(demands.map(d=>[d.id,d]));
  if(byId.size!==demands.length)throw Error('DUPLICATE_DRIVER_DEMAND');
  const previous=previousPlan?.delivery||{version:1,trips:[]};validateDriverPlan(previous);
  const legs=new Map();
  async function duration(a,b){
   const k=key(a)+'>'+key(b);if(!legs.has(k))legs.set(k,Promise.resolve(quoteLeg({origin:a,destination:b})).then(result=>{
    if(!Number.isFinite(result?.durationSeconds)||result.durationSeconds<=0||result.durationSeconds>7200)
     throw Error('DELIVERY_TRAVEL_TIME_UNAVAILABLE');
    return Math.ceil(result.durationSeconds/60);
   }));return legs.get(k);
  }
  const trips=[],assigned=new Set();let group=null;
  if(combine){
   if(!Array.isArray(combine)||combine.length!==2||new Set(combine).size!==2||combine.some(id=>!byId.has(id)))throw Error('TWO_CURRENT_DELIVERIES_REQUIRED');
   group=combine.map(id=>byId.get(id));
   if(group[0].sourceId===group[1].sourceId||group.some(d=>demands.filter(x=>x.sourceId===d.sourceId).length!==1))throw Error('RESOLVE_PROPOSED_TIMES_FIRST');
  }
  if(splitTripId&&!previous.trips.some(t=>t.id===splitTripId&&t.stops.length===2))throw Error('COMBINED_TRIP_NOT_FOUND');
  for(const t of previous.trips){
   const current=t.stops.filter(s=>byId.has(s.id));
   const touched=t.id===splitTripId||group?.some(d=>t.stops.some(s=>s.id===d.id));
   if(touched&&t.start<=asOf)throw Error('DELIVERY_TRIP_ALREADY_STARTED');
   if(touched){
    if(group&&current.some(s=>!combine.includes(s.id)))throw Error('SPLIT_EXISTING_TRIP_FIRST');
    continue;
   }
   // Preserve started journeys even when their orders are cancelled/tested.
   // For a partially cancelled combined trip retain the full route conservatively.
   if(current.length||t.start<=asOf&&t.finish>asOf){
    for(const s of current){const d=byId.get(s.id);
     if(d.target!==s.target||key(d.destination)!==key(s.destination))throw Error('DELIVERY_COMMITMENT_CHANGED');
     assigned.add(s.id);
    }
    trips.push(structuredClone(t));
   }
  }
  async function fit(stops){
   const travel=[];let from=RESTAURANT;
   for(const s of stops){travel.push(await duration(from,s.destination));from=s.destination;}
   travel.push(await duration(from,RESTAURANT));
   let offset=0;const offsets=stops.map((s,i)=>{offset+=travel[i];const v=offset;offset+=POLICY.handover;return v;});
   const low=Math.max(992,Math.ceil(asOf)+POLICY.loading,...stops.map((s,i)=>s.target-POLICY.arrivalTolerance-offsets[i]));
   const high=Math.min(...stops.map((s,i)=>s.target+POLICY.arrivalTolerance-offsets[i]));
   if(Math.max(...offsets)+POLICY.loading>POLICY.maxFoodAge)return null;
   const possibilities=[];
   for(let departure=low;departure<=high;departure++){
    const t={id:'trip:'+stops.map(s=>s.id).join('|'),start:departure-POLICY.loading,departure,
     finish:departure+offset+travel.at(-1),stops:stops.map((s,i)=>({...s,arrival:departure+offsets[i]})),legs:travel};
    if(trips.some(other=>overlap(t,other)&&!sameSource(t,other)))continue;
    const lateness=t.stops.reduce((n,s)=>n+Math.abs(s.arrival-s.target),0);
    possibilities.push({t,score:lateness});
   }
   possibilities.sort((a,b)=>a.score-b.score||a.t.departure-b.t.departure);return possibilities[0]?.t||null;
  }
  if(group){const t=await fit(group);if(!t)throw Error('COMBINED_DELIVERY_NOT_FEASIBLE');trips.push(t);for(const s of group)assigned.add(s.id);}
  for(const d of demands.filter(d=>!assigned.has(d.id)).sort((a,b)=>a.target-b.target||a.id.localeCompare(b.id))){
   const t=await fit([d]);if(!t)throw Error('DRIVER_UNAVAILABLE');trips.push(t);assigned.add(d.id);
  }
  const delivery={version:1,...(previous.decisions?{decisions:structuredClone(previous.decisions)}:{}),trips:trips.sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id))};validateDriverPlan(delivery);
  const deadlines=new Map(delivery.trips.flatMap(t=>t.stops.filter(s=>byId.has(s.id)).map(s=>[s.id,t.start])));
  return {delivery,deadlines};
 };
}
function validateFoodAge(plan){
 if(!plan.delivery)return true;validateDriverPlan(plan.delivery);
 const jobs=[...plan.wok.jobs,...plan.fryer.jobs,...(plan.auxiliary?.jobs||[])];
 for(const t of plan.delivery.trips)for(const s of t.stops){
  const food=jobs.filter(j=>j.orderIds.includes(s.id));if(!food.length)continue;
  const ready=Math.max(...food.map(j=>j.finish));
  if(ready>t.start||s.arrival-ready>POLICY.maxFoodAge)throw Error('DELIVERY_FOOD_HOLDING_LIMIT');
 }
 return true;
}
module.exports={createDriverPlanner,validateDriverPlan,validateFoodAge,POLICY};
