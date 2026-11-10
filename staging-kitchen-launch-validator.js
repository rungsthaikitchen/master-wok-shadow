'use strict';
// Staging-only launch safety gate. Never grants booking approval.
// Validates reported resource intervals and order-placement boundaries.
const {OUT_OF_SCOPE}=require('./staging-out-of-scope-items');
const {eligible}=require('./staging-shared-ring-allocator');
const {validateAuxiliaryWork}=require('./master-wok-auxiliary-work');
const {diagnoseFryer}=require('./staging-fryer-diagnostic');
const {fryerRecipe,fryerCapacity}=require('./master-wok-recipe-rules');
function validateRingOccupancy(wok,auxiliary=[]){
 const issues=[];
 for(const j of wok){
  if(!eligible(j.itemId)?.includes(j.vessel))issues.push({code:'INVALID_VESSEL',itemId:j.itemId});
  if(j.vessel?.startsWith('pan-')&&j.portions!==1)issues.push({code:'PAN_PORTION_CAPACITY_EXCEEDED'});
  if(j.vessel!=='cold-prep-1'&&!j.vessel?.startsWith('pan-')&&j.portions!==1)
   issues.push({code:'WOK_PORTION_CAPACITY_EXCEEDED'});
 }
 const ringJobs=wok.filter(j=>j.vessel!=='cold-prep-1');
  for(const j of ringJobs)if(ringJobs.filter(k=>k.start<=j.start&&k.finish>j.start).length>4)
   issues.push({code:'RING_CAPACITY_EXCEEDED'});
  for(let i=0;i<wok.length;i++)for(let j=i+1;j<wok.length;j++)
   if(wok[i].vessel===wok[j].vessel&&wok[i].start<wok[j].finish+1&&wok[j].start<wok[i].finish+1)
    issues.push({code:'VESSEL_RESET_REQUIRED'});
  // Auxiliary wok work remains conservative: no overlap with any main work.
  for(const a of auxiliary)if(a.resource==='wok'&&
   wok.some(j=>a.start<j.finish+1&&a.finish+1>j.start))issues.push({code:'AUXILIARY_MAIN_OVERLAP'});
 return issues;
}
function validateKitchenTimeline(orders,plan,rows,options={}){
 const issues=[];
 const placed=new Map(orders.map(o=>[String(o.orderId),o.placedAt instanceof Date
  ?o.placedAt.getHours()*60+o.placedAt.getMinutes():NaN]));
 if(!plan||plan.status!=='COORDINATED_PROTOTYPE')
  issues.push({code:'COORDINATED_PLAN_MISSING'});
 const wok=(plan&&plan.wok&&plan.wok.jobs)||[];
 const fry=(plan&&plan.fryer&&plan.fryer.jobs)||[];
 const shared=plan?.resourceModel==='FOUR_SHARED_RINGS';
 const all=[...wok.map(j=>({...j,resource:shared?'hob:'+j.vessel:'wok'})),...fry.map(j=>({...j,resource:j.basket})),...(plan?.auxiliary?.jobs||[])];
 if(shared){
  for(const j of wok){
   if(!eligible(j.itemId)?.includes(j.vessel))issues.push({code:'INVALID_VESSEL',itemId:j.itemId});
   if(!Number.isInteger(j.start)||!Number.isInteger(j.finish)||
    j.finish-j.start!==({fast:{1:5,2:6,3:8,4:10},noodle:{1:8,2:10},salad:{1:10,2:10,3:15,4:15}})[j.group]?.[j.portions]||
    j.finish>j.readyMinute||j.readyMinute-j.finish>(plan.holdingLimitMinutes===20?20:10))
    issues.push({code:'INVALID_COOKING_JOB',itemId:j.itemId});
  }
  issues.push(...validateRingOccupancy([...wok,...(options.fixedWok||[])],
   [...(plan.auxiliary?.jobs||[]),...(options.fixedAuxiliary||[])]));
  if(!validateAuxiliaryWork(orders,options.auxiliaryRows||rows,plan.auxiliary?.jobs||[],{
   ...options,holdingLimitMinutes:plan.holdingLimitMinutes,mainJobs:[...wok,...(options.fixedWok||[])]}))issues.push({code:'AUXILIARY_COVERAGE_INVALID'});
  const inventory=diagnoseFryer(orders,rows,{confirmedStarterRecipes:true,standaloneSpringRolls:true});
  const expected=new Map(),actual=new Map(),deadlineExpected=new Map(),deadlineActual=new Map();
  const key=(id,item,type,recipe)=>JSON.stringify([String(id),item,type,recipe]);
  for(const d of inventory.dependencies){
   const order=orders.find(o=>String(o.orderId)===String(d.orderId));
   const line=rows.find(r=>String(r.id)===String(d.orderId)).items[d.lineIndex];
   const recipe=JSON.stringify([order.readyMinute,line.item_id,line.modifiers,line.spice??null,line.item_note??null]);
   for(const [type,qty] of Object.entries(d.counts)){
    const k=key(d.orderId,d.itemId,type,recipe);expected.set(k,(expected.get(k)||0)+qty);
   }
  }
  // Identical one-portion batches may start together in different woks. Verify
  // the frying quantity at each start time rather than demanding one parent.
  for(const [k,count] of expected){
   const [id,item,type,recipe]=JSON.parse(k);
   const parents=wok.filter(w=>w.itemId===item&&w.recipeKey===recipe&&w.orderIds.includes(id));
   const shares=parents.map(w=>({deadline:w.start,qty:w.portionAllocations.filter(a=>String(a.orderId)===id).reduce((n,a)=>n+a.qty,0)}));
   const total=shares.reduce((n,a)=>n+a.qty,0);
   if(!parents.length)shares.push({deadline:orders.find(o=>String(o.orderId)===id).readyMinute,qty:1});
   for(const share of shares){
    const qty=parents.length?count*share.qty/total:count;
    if(!Number.isInteger(qty))issues.push({code:'FRYER_BATCH_MAPPING_INVALID'});
    const dk=JSON.stringify([id,item,type,recipe,share.deadline]);
    deadlineExpected.set(dk,(deadlineExpected.get(dk)||0)+qty);
   }
  }
  for(const j of fry){
   if(!fryerRecipe(j.type)||j.finish-j.start!==fryerRecipe(j.type).minutes||
    !Number.isInteger(j.portions)||j.portions<1||j.portions>fryerCapacity(j.type,j.basket)||
    !Array.isArray(j.allocations)||j.allocations.length!==j.portions)
    issues.push({code:'INVALID_FRYER_JOB'});
   for(const a of j.allocations||[]){
    if(a.qty!==1||a.type!==j.type||!j.orderIds.includes(a.orderId)||
     j.finish>a.deadline||a.deadline-j.finish>(j.standalone&&plan.holdingLimitMinutes===20?20:10))
     issues.push({code:'INVALID_FRYER_ALLOCATION'});
    const k=key(a.orderId,a.itemId,a.type,a.recipeKey);actual.set(k,(actual.get(k)||0)+1);
    const dk=JSON.stringify([String(a.orderId),a.itemId,a.type,a.recipeKey,a.deadline]);
    deadlineActual.set(dk,(deadlineActual.get(dk)||0)+1);
   }
  }
  if(inventory.unmodelled.length||expected.size!==actual.size||[...expected].some(([k,v])=>actual.get(k)!==v))
   issues.push({code:'FRYER_COVERAGE_INVALID'});
  if(deadlineExpected.size!==deadlineActual.size||[...deadlineExpected].some(([k,v])=>deadlineActual.get(k)!==v))
   issues.push({code:'FRYER_DEADLINE_COVERAGE_INVALID'});
 }
 for(const job of all){
  if(!Number.isFinite(job.start)||!Number.isFinite(job.finish)||job.finish<=job.start||
    job.start<990||job.finish>1320)issues.push({code:'INVALID_INTERVAL',resource:job.resource});
  if(!Array.isArray(job.orderIds)||!job.orderIds.length)
   issues.push({code:'MISSING_ORDER_IDS',resource:job.resource});
  if((options.blackouts||[]).some(b=>job.start<b.finish&&job.finish>b.start))
   issues.push({code:'BLACKOUT_OVERLAP',resource:job.resource});
  for(const id of job.orderIds||[]){
   const minute=placed.get(String(id));
   if(!Number.isFinite(minute)||job.start<Math.max(minute,options.notBeforeByOrder?.[String(id)]??0))
    issues.push({code:'BEFORE_ORDER_PLACED',orderId:String(id),resource:job.resource});
  }
 }
 for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
  const a=all[i],b=all[j];
  if(a.resource===b.resource&&a.start<b.finish&&b.start<a.finish)
   issues.push({code:'RESOURCE_OVERLAP',resource:a.resource});
 }
 for(const a of all)for(const b of [...(options.fixedAuxiliary||[]),
  ...(options.fixedFryer||[]).map(j=>({...j,resource:j.basket}))])
  if(a.resource===b.resource&&a.start<b.finish+(a.resource==='wok'?1:0)&&
   b.start<a.finish+(a.resource==='wok'?1:0))issues.push({code:'PROTECTED_RESOURCE_OVERLAP',resource:a.resource});
 // Portion coverage is provable only for single-order batches with current
 // job metadata. Cross-order batches need per-order portion allocations.
 if(Array.isArray(rows)){
  const expected=new Map();
  for(const row of rows){
   if(!row||!Array.isArray(row.items)){
    issues.push({code:'INVALID_ORDER_LINES'});continue;
   }
   for(const line of row.items){
    if(!line||!Number.isInteger(line.qty)||line.qty<=0||typeof line.item_id!=='string'){
     issues.push({code:'INVALID_ORDER_LINE',orderId:String(row.id)});continue;
    }
    if(OUT_OF_SCOPE.has(line.item_id))continue;
    const key=JSON.stringify([String(row.id),line.item_id]);
    expected.set(key,(expected.get(key)||0)+line.qty);
   }
  }
  const actual=new Map();
  for(const job of wok){
   if(!Number.isInteger(job.portions)||job.portions<=0){
    issues.push({code:'INVALID_PORTION_COUNT',itemId:job.itemId});continue;
   }
   const allocations=job.portionAllocations;
   if(!Array.isArray(allocations)||!allocations.length){
    issues.push({code:'PORTION_ALLOCATION_MISSING',itemId:job.itemId});continue;
   }
   const seen=new Set();
   let allocated=0,valid=true;
   for(const allocation of allocations){
    const id=String(allocation?.orderId);
    if(!allocation||!Number.isInteger(allocation.qty)||allocation.qty<=0||
       seen.has(id)||!(job.orderIds||[]).some(x=>String(x)===id)){
      issues.push({code:'INVALID_PORTION_ALLOCATION',itemId:job.itemId});valid=false;continue;
    }
    seen.add(id);allocated+=allocation.qty;
   }
   if(allocated!==job.portions||seen.size!==(job.orderIds||[]).length){
    issues.push({code:'PORTION_ALLOCATION_TOTAL_MISMATCH',itemId:job.itemId});valid=false;
   }
   if(valid)for(const allocation of allocations){
    const key=JSON.stringify([String(allocation.orderId),job.itemId]);
    actual.set(key,(actual.get(key)||0)+allocation.qty);
   }
  }
  for(const [key,qty] of expected){
   if(actual.get(key)!==qty)issues.push({code:'PORTION_COVERAGE_MISMATCH',key,expected:qty,actual:actual.get(key)||0});
  }
  for(const [key,qty] of actual){
   if(!expected.has(key))issues.push({code:'UNEXPECTED_SCHEDULED_PORTIONS',key,actual:qty});
  }
 }else{
  issues.push({code:'ORDER_LINES_REQUIRED_FOR_COVERAGE'});
 }
 for(const job of fry){
  if(job.standalone){
   if(!Number.isFinite(job.readyMinute)||job.finish>job.readyMinute)
    issues.push({code:'STANDALONE_FRY_DEADLINE_UNVERIFIED'});
   continue;
  }
  if(!Array.isArray(job.allocations)||!job.allocations.length)
   issues.push({code:'FRY_WOK_DEPENDENCY_UNVERIFIED'});
  for(const allocation of job.allocations||[]){
   const candidates=wok.filter(w=>(w.orderIds||[]).includes(allocation.orderId)&&
     allocation.itemId===w.itemId&&allocation.deadline===w.start&&
     (!allocation.recipeKey||allocation.recipeKey===w.recipeKey));
   if((shared?candidates.length<1:candidates.length!==1)||job.finish>allocation.deadline)
    issues.push({code:'FRY_WOK_DEPENDENCY_UNVERIFIED',orderId:allocation.orderId});
  }
 }
 return {status:issues.length?'UNVERIFIED':'VALIDATED_STAGING_TIMELINE',
  issues,bookingApprovalAllowed:false};
}
module.exports={validateKitchenTimeline,validateRingOccupancy};

