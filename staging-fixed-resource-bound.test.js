'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixedResourceConflict}=require('./staging-fixed-resource-bound');
function context(fixed,placed=[]){
 const ringOccupancy=Array(1321).fill(0);for(const j of fixed)if(j.vessel!=='cold-prep-1')for(let t=j.start;t<j.finish;t++)ringOccupancy[t]++;
 return {ringOccupancy,fits(v,start,finish){
  const all=[...fixed,...placed];
  if(all.some(j=>j.vessel===v&&start<=j.finish&&finish>=j.start))return false;
  if(v!=='cold-prep-1')for(let t=start;t<finish;t++)if(all.filter(j=>j.vessel!=='cold-prep-1'&&j.start<=t&&t<j.finish).length>=4)return false;
  return true;
 }};
}
function feasible(jobs,fixed){
 const placed=[],c=context(fixed,placed);
 function visit(i){if(i===jobs.length)return true;const j=jobs[i];
  for(let start=j.earliest;start<=j.latest;start++)for(const vessel of j.vessels){
   const finish=start+j.duration;if(!c.fits(vessel,start,finish))continue;
   placed.push({vessel,start,finish});if(visit(i+1))return true;placed.pop();
  }return false;
 }return visit(0);
}
test('necessary bounds never reject a feasible small scheduling problem (200 deterministic exhaustive comparisons)',()=>{
 let seed=91;const rand=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
 for(let n=0;n<200;n++){
  const fixed=rand(2)?[{vessel:'small-1',start:993,finish:995}]:[];
  const jobs=Array.from({length:2+rand(3)},()=>({vessels:rand(2)?['small-1','small-2']:['pan-1','pan-2'],duration:1+rand(3),earliest:990+rand(3),latest:994+rand(2)}));
  const conflict=fixedResourceConflict(jobs,context(fixed));
  if(conflict)assert.equal(feasible(jobs,fixed),false,JSON.stringify({jobs,fixed,conflict}));
 }
});
test('capacity lower bounds identify genuine exhausted vessel windows but leave spare capacity unproven',()=>{
 const fixed=[{vessel:'small-1',start:990,finish:996}];
 const job={vessels:['small-1'],duration:2,earliest:991,latest:994};
 assert.equal(fixedResourceConflict([job],context(fixed)),'FIXED_VESSEL_CAPACITY_EXCEEDED');
 assert.equal(fixedResourceConflict([{...job,vessels:['small-1','small-2']}],context(fixed)),null);
});
