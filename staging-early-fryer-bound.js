'use strict';
const {fryerRecipe}=require('./master-wok-recipe-rules');
// Optimistic early-service capacity proof. Ignore existing reservations,
// different prerequisite recipes and holding limits: this can only overstate
// capacity. Never approve a plan from this bound.
function earlyFryerConflict(orders,inventory,jobs,options={}){
 const deps=inventory.dependencies,standalone=deps.filter(d=>d.standalone),prerequisites=deps.filter(d=>!d.standalone);
 if(standalone.length!==1||!prerequisites.length||new Set(deps.map(d=>d.orderId)).size!==1)return null;
 const starter=standalone[0],entries=Object.entries(starter.counts);
 if(entries.length!==1)return null;
 const [type,count]=entries[0],recipe=fryerRecipe(type);
 if(!recipe||count<1||count>3)return null;
 let demand=0;
 for(const d of prerequisites)for(const [type,n] of Object.entries(d.counts)){
  if(type===entries[0][0])return null;
  const r=fryerRecipe(type);if(!r||r.minutes!==5||r.large!==3||r.small!==2)return null;demand+=n;
 }
 const order=orders.find(o=>String(o.orderId)===starter.orderId);
 if(!(order?.placedAt instanceof Date))return null;
 const release=Math.max(990+(options.fryerWarmupMinutes||0),order.placedAt.getHours()*60+order.placedAt.getMinutes(),options.notBeforeByOrder?.[starter.orderId]??0);
 const mains=jobs.filter(j=>prerequisites.some(d=>d.itemId===j.itemId&&j.orderIds.includes(d.orderId)));
 if(!mains.length)return null;
 const deadline=Math.max(...mains.map(j=>j.latest));
 if(deadline-release<0)return 'FRYER_WINDOW_CAPACITY_EXCEEDED';
 if(deadline-release>30)return null;
 const latest=starter.readyMinute-recipe.minutes;
 if(latest-release>40)return null;
 const capacities=[];
 for(const [mainCapacity,starterCapacity] of [[3,recipe.large],[2,recipe.small],[2,recipe.small]]){
  const best=Array(count+1).fill(-Infinity);
  for(let portions=0;portions<=count;portions++){
   const batches=Math.ceil(portions/starterCapacity),blocks=[];
   function search(from,left){
    if(!left){
     let cursor=release,capacity=0;
     for(const b of blocks){capacity+=Math.floor(Math.max(0,Math.min(b.start,deadline)-cursor)/5)*mainCapacity;cursor=Math.max(cursor,b.finish);}
     capacity+=Math.floor(Math.max(0,deadline-cursor)/5)*mainCapacity;
     best[portions]=Math.max(best[portions],capacity);return;
    }
    for(let start=from;start<=latest-(left-1)*recipe.minutes;start++){
     blocks.push({start,finish:start+recipe.minutes});search(start+recipe.minutes,left-1);blocks.pop();
    }
   }
   search(release,batches);
  }
  capacities.push(best);
 }
 let total=Array(count+1).fill(-Infinity);total[0]=0;
 for(const best of capacities){
  const next=Array(count+1).fill(-Infinity);
  for(let i=0;i<=count;i++)for(let k=0;k+i<=count;k++)next[i+k]=Math.max(next[i+k],total[i]+best[k]);
  total=next;
 }
 return total[count]<demand?'FRYER_WINDOW_CAPACITY_EXCEEDED':null;
}
module.exports={earlyFryerConflict};
