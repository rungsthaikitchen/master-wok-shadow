'use strict';
// Necessary physical bounds only. An optimistic per-vessel packing ignores
// competition from other new jobs. If even that cannot fit, search cannot help.
function fixedResourceConflict(jobs,{fits,ringOccupancy}={}){
 const groups=new Map();
 for(const job of jobs){
  const key=JSON.stringify([job.vessels,job.earliest,job.latest,job.duration]);
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(job);
 }
 const mandatory=[];
 for(const [key,group] of groups){
  const job=group[0],choices=new Map();let capacity=0;
  const pack=starts=>{let end=-1,count=0;for(const start of starts)if(start>end){count++;end=start+job.duration;}return count;};
  for(const vessel of job.vessels){
   const starts=[];
   for(let start=job.earliest;start<=job.latest;start++)if(fits(vessel,start,start+job.duration))starts.push(start);
   const max=pack(starts);choices.set(vessel,{starts,max});capacity+=max;
  }
  if(capacity<group.length)return 'FIXED_VESSEL_CAPACITY_EXCEEDED';
  if(capacity!==group.length)continue;
  // Every vessel must attain its optimistic maximum. A minute is mandatory
  // only if forbidding it makes that maximum impossible on this vessel.
  for(const [vessel,{starts,max}] of choices){
   if(!max)continue;
   const minutes=new Set();
   for(let t=job.earliest;t<job.latest+job.duration;t++)
    if(pack(starts.filter(start=>!(start<=t&&t<start+job.duration)))<max)minutes.add(t);
   mandatory.push({key,vessel,minutes});
  }
 }
 for(const [key,group] of groups){
  const job=group[0],other=mandatory.filter(m=>m.key!==key);
  let possible=false;
  for(let start=job.earliest;start<=job.latest&&!possible;start++)for(const vessel of job.vessels){
   const finish=start+job.duration;if(!fits(vessel,start,finish))continue;
   if(other.some(m=>m.vessel===vessel&&[...m.minutes].some(t=>t>=start-1&&t<=finish)))continue;
   if(vessel!=='cold-prep-1'){
    let blocked=false;
    for(let t=start;t<finish;t++)if(ringOccupancy[t]+other.filter(m=>m.vessel!=='cold-prep-1'&&m.minutes.has(t)).length>=4){blocked=true;break;}
    if(blocked)continue;
   }
   possible=true;break;
  }
  if(!possible)return 'FIXED_RESOURCE_WINDOW_EXCEEDED';
 }
 return null;
}
module.exports={fixedResourceConflict};
