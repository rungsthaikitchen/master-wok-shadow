'use strict';
require('./master-wok-model-bundle');
const {expandCommitments}=require('./master-wok-commitment-reader');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {relativePlacement}=require('./master-wok-clock');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {createDeliveryCapacity}=require('./master-wok-delivery-capacity');
const {assessChefAttention}=require('./master-wok-chef-attention');
const {warnings}=require('./master-wok-holding-advisory');
const fixture=require('./staging-tests/current-overlap-replay-20261118.json');
const clock=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
async function replay(){
 const model=globalThis.MasterWokModelV1,date='2026-11-18',now=date+'T12:15:00Z';
 const rows=expandCommitments(fixture.orders,date);
 const orders=normalizeStagingOrders({rows,model,serviceDate:date}).map(o=>({...o,placedAt:relativePlacement(o.placedAt,date)}));
 const capacity=createDeliveryCapacity({stagingSharedRings:true,advisoryHolding:true,quoteLeg:async()=>({durationSeconds:480})});
 const rebuilt=await capacity.replan({orders,rows,previousPlan:null,serviceDate:date,now,availability:{blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}}});
 if(!rebuilt.plan)return {scope:'OFFLINE_DIAGNOSTIC_ONLY',bookingApprovalAllowed:false,baselineRebuild:{status:rebuilt.status,reason:rebuilt.reason}};
 const results=[];
 for(const ready of [1190,1200,1210,1220]){
  const p=prepareStagingBasket({id:'attention-candidate',createdAt:now,serviceDate:date,readyMinute:ready,items:fixture.orders[0].items,model});
  const r=await capacity.verify({serviceDate:date,acceptedOrders:orders,rawRows:rows,state:{now,availability:{blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}},previousPlan:structuredClone(rebuilt.plan)},proposedOrder:{...p.candidate,rawRow:p.rawRow,validatedHeader:{order_type:'delivery',preferred_time:new Date(Date.UTC(2026,10,18,0,ready)).toISOString(),customer_lat:53.752,customer_lng:-1.58}}});
  if(!r.plan){results.push({arrival:clock(ready),status:r.status,reason:r.reason});continue;}
  const assessment=assessChefAttention(r.plan);
  const jobs=r.plan.wok.jobs,bounds=[...new Set(jobs.flatMap(j=>[j.start,j.finish]))].sort((a,b)=>a-b);
  const peak=bounds.slice(0,-1).map((start,i)=>{
   const active=jobs.filter(j=>j.start<=start&&j.finish>start);
   return {start:clock(start),finish:clock(bounds[i+1]),hotJobs:active.filter(j=>j.vessel!=='cold-prep-1').length,coldJobs:active.filter(j=>j.vessel==='cold-prep-1').length,items:active.map(j=>({itemId:j.itemId,vessel:j.vessel}))};
  }).sort((a,b)=>(b.hotJobs+b.coldJobs)-(a.hotJobs+a.coldJobs))[0];
  results.push({arrival:clock(ready),status:r.status,peakEquipmentOverlap:peak,holdingWarnings:warnings(r.plan).map(w=>({estimatedMinutes:w.estimatedMinutes,dishes:w.dishes})),attentionStatus:assessment.status,unprofiledRecipes:[...new Set(assessment.unprofiled.map(j=>`${j.resource}:${j.itemId}`))].sort()});
 }
 return {scope:'OFFLINE_DIAGNOSTIC_ONLY',fixture:'Saved 18 November collection basket rebuilt under corrected vessel rules; second identical basket delivered with fixed eight-minute legs',liveRouteReplay:false,bookingApprovalAllowed:false,results};
}
if(require.main===module)replay().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={replay};
