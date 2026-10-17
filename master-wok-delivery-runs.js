'use strict';
// Offline, single-driver, at most two deliveries. No IO or live scheduling hooks.
const KITCHEN='KITCHEN';
const BASIS='HYPOTHETICAL_DELIVERY_PLANS_NOT_DRIVER_OR_COOKING_ACTIVITY';
const unknown=reasonCode=>({status:'UNVERIFIED',reasonCode,verified:false,evidenceBasis:BASIS});
const bounded=(v,low,high)=>typeof v==='number'&&Number.isFinite(v)&&v>=low&&v<=high;
const stamp=s=>typeof s==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
const overlap=(a,b)=>a.startMinute<b.endMinute&&b.startMinute<a.endMinute;

function recommendDeliveryRuns(input,{assessKitchen}={}) {
 try {return search(input,assessKitchen);} catch (_) {return unknown('INVALID_INPUT_OR_ASSESSMENT');}
}
function search(input,assessKitchen) {
 if(!input||input.timeBasis!=='CUSTOMER_ARRIVAL')return unknown('DELIVERY_TIME_MEANING_UNVERIFIED');
 if(!Array.isArray(input.orders)||input.orders.length<1||input.orders.length>2)return unknown('ONE_OR_TWO_DELIVERIES_REQUIRED');
 const orders=structuredClone(input.orders), ids=new Set();
 for(const o of orders) {
  if(!o||typeof o.orderId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(o.orderId)||o.orderId===KITCHEN||ids.has(o.orderId)||
     !Number.isInteger(o.targetMinute)||!bounded(o.targetMinute,10,1430)||!bounded(o.handoverMinutes,0,30))return unknown('INVALID_DELIVERY_ORDER');
  ids.add(o.orderId);
 }
 if(!bounded(input.loadingMinutes,0,30)||!bounded(input.earliestFoodReadyMinute,990,1320)||
    !bounded(input.minCombinedSavingMinutes,0,120))return unknown('EXPLICIT_PLANNING_ALLOWANCES_REQUIRED');
 if(input.driverPlanCoverage!=='COMPLETE_FOR_PLANNING_WINDOW'||!Array.isArray(input.existingDriverPlans)||input.existingDriverPlans.length>500)
  return unknown('DRIVER_PLAN_COVERAGE_UNVERIFIED');
 const existing=structuredClone(input.existingDriverPlans);
 for(const p of existing)if(!p||!bounded(p.startMinute,0,1440)||!bounded(p.endMinute,0,1440)||p.endMinute<=p.startMinute)
  return unknown('INVALID_DRIVER_PLAN');
 if(!stamp(input.assessedAt)||!bounded(input.maxEstimateAgeMinutes,0.01,1440)||!Array.isArray(input.legs))return unknown('ROUTE_FRESHNESS_UNVERIFIED');
 const nodes=[KITCHEN,...orders.map(o=>o.orderId)],legs=new Map();
 for(const leg of input.legs) {
  if(!leg||!nodes.includes(leg.from)||!nodes.includes(leg.to)||leg.from===leg.to)return unknown('INVALID_ROUTE_LEG');
  const key=leg.from+'/'+leg.to;
  if(legs.has(key)||leg.basis!=='ROUTE_DURATION_ESTIMATE'||!bounded(leg.durationSeconds,0,14400)||!stamp(leg.estimatedAt))
   return unknown('INVALID_ROUTE_LEG');
  const age=(Date.parse(input.assessedAt)-Date.parse(leg.estimatedAt))/60000;
  if(age<0||age>input.maxEstimateAgeMinutes)return unknown('STALE_OR_FUTURE_ROUTE_ESTIMATE');
  legs.set(key,Math.ceil(leg.durationSeconds/60));
 }
 for(const from of nodes)for(const to of nodes)if(from!==to&&!legs.has(from+'/'+to))return unknown('DIRECTIONAL_ROUTE_LEGS_REQUIRED');
 const travel=(a,b)=>legs.get(a+'/'+b);
 const tripsFor=o=>{
  const result=[];
  for(let arrival=o.targetMinute-10;arrival<=o.targetMinute+10;arrival++) {
   const departure=arrival-travel(KITCHEN,o.orderId),start=departure-input.loadingMinutes;
   result.push({stopOrder:[o.orderId],startMinute:start,departureMinute:departure,
    endMinute:arrival+o.handoverMinutes+travel(o.orderId,KITCHEN),
    arrivals:[{orderId:o.orderId,arrivalMinute:arrival}],waitingMinutes:0,
    drivingMinutes:travel(KITCHEN,o.orderId)+travel(o.orderId,KITCHEN)});
  }
  return result;
 };
 let kitchenUnknown=false,kitchenCalls=0,considered=0;
 const evaluate=(kind,trips)=>{
  considered++;
  for(let i=0;i<trips.length;i++) {
   const t=trips[i];
   if(t.startMinute<input.earliestFoodReadyMinute||t.startMinute>1320||t.endMinute>1440||
      existing.some(p=>overlap(t,p))||trips.some((p,j)=>j!==i&&overlap(t,p)))return null;
   if(t.arrivals.some(a=>a.arrivalMinute-t.startMinute>20))return null;
  }
  if(typeof assessKitchen!=='function'){kitchenUnknown=true;return null;}
  const proposed=trips.flatMap(t=>t.arrivals.map(a=>({orderId:a.orderId,foodReadyMinute:t.startMinute})));
  let assessed;
  try {kitchenCalls++;assessed=assessKitchen(structuredClone({kind,proposedFoodReady:proposed}));}
  catch(_){kitchenUnknown=true;return null;}
  if(assessed && typeof assessed.then==='function') {
   // Async adapters are unsupported here; suppress a rejected callback promise.
   Promise.resolve(assessed).catch(()=>{});kitchenUnknown=true;return null;
  }
  if(!assessed||!['FIT','NO_FIT','UNVERIFIED'].includes(assessed.status)){kitchenUnknown=true;return null;}
  if(assessed.status==='NO_FIT')return null;
  if(assessed.status!=='FIT'||!Array.isArray(assessed.foodReadyByOrder)||assessed.foodReadyByOrder.length!==orders.length){kitchenUnknown=true;return null;}
  const ready=new Map();
  for(const row of assessed.foodReadyByOrder) {
   if(!row||!ids.has(row.orderId)||ready.has(row.orderId)||!bounded(row.foodReadyMinute,input.earliestFoodReadyMinute,1320)) {
    kitchenUnknown=true;return null;
   }
   ready.set(row.orderId,row.foodReadyMinute);
  }
  const deliveries=[];
  for(const t of trips)for(const a of t.arrivals) {
   const foodReady=ready.get(a.orderId),target=orders.find(o=>o.orderId===a.orderId).targetMinute;
   // Earlier cooking is allowed only if its entire holding/loading/transit age fits.
   if(foodReady>t.startMinute||a.arrivalMinute-foodReady>20)return null;
   const age=a.arrivalMinute-foodReady;
   deliveries.push({...a,foodReadyMinute:foodReady,foodToDoorMinutes:age,
    deviationMinutes:a.arrivalMinute-target,quality:age<15?'PREFERRED':'ACCEPTABLE_FLAGGED'});
  }
  return {kind,trips:structuredClone(trips),deliveries,
   allUnder15:deliveries.every(d=>d.foodToDoorMinutes<15),
   maxFoodToDoorMinutes:Math.max(...deliveries.map(d=>d.foodToDoorMinutes)),
   totalDeviationMinutes:deliveries.reduce((s,d)=>s+Math.abs(d.deviationMinutes),0),
   totalDriverMinutes:trips.reduce((s,t)=>s+t.endMinute-t.startMinute,0),
   totalDrivingMinutes:trips.reduce((s,t)=>s+t.drivingMinutes,0)};
 };
 // Deterministic ranking: quality band, target accuracy, food age, driver minutes.
 const score=p=>[p.allUnder15?0:1,p.totalDeviationMinutes,p.maxFoodToDoorMinutes,p.totalDriverMinutes,
  JSON.stringify(p.trips.map(t=>[t.stopOrder,t.startMinute]))];
 const better=(a,b)=>{if(!b)return a;const x=score(a),y=score(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]<y[i]?a:b;return b;};
 let separate=null,combined=null;
 const singles=orders.map(tripsFor);
 if(orders.length===1)for(const t of singles[0]){const p=evaluate('SEPARATE',[t]);if(p)separate=better(p,separate);}
 else {
  // One joint kitchen assessment per proposal, not two independent kitchen fits.
  for(const a of singles[0])for(const b of singles[1]){const p=evaluate('SEPARATE',[a,b]);if(p)separate=better(p,separate);}
  for(const sequence of [orders,[orders[1],orders[0]]]) {
   const [a,b]=sequence;
   for(let first=a.targetMinute-10;first<=a.targetMinute+10;first++)
    for(let second=b.targetMinute-10;second<=b.targetMinute+10;second++) {
     const earliestSecond=first+a.handoverMinutes+travel(a.orderId,b.orderId);
     if(second<earliestSecond)continue;
     const departure=first-travel(KITCHEN,a.orderId);
     const trip={stopOrder:[a.orderId,b.orderId],startMinute:departure-input.loadingMinutes,
      departureMinute:departure,endMinute:second+b.handoverMinutes+travel(b.orderId,KITCHEN),
      arrivals:[{orderId:a.orderId,arrivalMinute:first},{orderId:b.orderId,arrivalMinute:second}],
      waitingMinutes:second-earliestSecond,
      drivingMinutes:travel(KITCHEN,a.orderId)+travel(a.orderId,b.orderId)+travel(b.orderId,KITCHEN)};
     const p=evaluate('COMBINED',[trip]);if(p)combined=better(p,combined);
    }
  }
 }
 if(!separate&&!combined)return {...unknown(kitchenUnknown?'KITCHEN_ASSESSMENT_UNVERIFIED':'NO_FEASIBLE_PLAN_IN_ARRIVAL_WINDOWS'),
  searchComplete:!kitchenUnknown,considered,kitchenAssessments:kitchenCalls};
 let recommendation=separate||combined,reasonCode=separate?'SEPARATE_TRIPS_PREFERRED':'COMBINED_ONLY_FEASIBLE_PLAN_FOUND';
 const savings=separate&&combined?separate.totalDriverMinutes-combined.totalDriverMinutes:null;
 if(separate&&combined) {
  if((combined.allUnder15&&!separate.allUnder15)||
     (combined.allUnder15===separate.allUnder15&&savings>0&&savings>=input.minCombinedSavingMinutes)) {
   recommendation=combined;reasonCode=combined.allUnder15&&!separate.allUnder15?'COMBINED_IMPROVES_FOOD_QUALITY':'COMBINED_SAVES_DRIVER_TIME';
  }
 }
 return {status:'SHADOW_RECOMMENDATION',reasonCode,verified:false,evidenceBasis:BASIS,
  arrivalToleranceMinutes:10,maxFoodToDoorMinutes:20,preferredFoodToDoorMinutesExclusive:15,
  recommendation,separateAlternative:separate,combinedAlternative:combined,
  combinedDriverMinutesSaved:savings,alternativesFullyAssessed:!kitchenUnknown,
  considered,kitchenAssessments:kitchenCalls};
}
module.exports={recommendDeliveryRuns,KITCHEN};
