'use strict';
// Private input stays in memory. Default off; never reads a source database.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {prepareScenario,assessRetrospectiveSingle}=require('./master-wok-retrospective-single');
const {collectGoogleStagingRoutes}=require('./master-wok-google-routes');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const validHash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function buildHash(){
 const h=crypto.createHash('sha256');
 for(const name of fs.readdirSync(__dirname).filter(n=>/^master-wok.*\.(js|json)$/.test(n)&&!n.endsWith('.test.js')).sort()){
  h.update(name+'\0');h.update(fs.readFileSync(path.join(__dirname,name)));
 }
 for(const name of ['delivery_minimal_candidate.py','delivery_private_bridge.py','delivery_comparison_controller.py','delivery_comparison_journal.py']){
  h.update('railway-shadow/'+name+'\0');h.update(fs.readFileSync(path.join(__dirname,'railway-shadow',name)));
 }
 return h.digest('hex');
}
function prepare(input,clock=()=>new Date().toISOString()){
 if(!input||typeof input.privateJson!=='string'||Buffer.byteLength(input.privateJson)>500000||
    !validHash(input.bindingHash)||hash(input.privateJson)!==input.bindingHash||!validHash(input.sourceIdentity))throw Error();
 const payload=JSON.parse(input.privateJson);
 if(Object.keys(payload).sort().join()!=='points,source,sourceObservedAt'||payload.source?.orders?.length!==1)throw Error();
 const now=Date.parse(clock()),observed=Date.parse(payload.sourceObservedAt);
 if(typeof payload.sourceObservedAt!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(payload.sourceObservedAt)||
    !Number.isFinite(now)||!Number.isFinite(observed)||now-observed< -5000||now-observed>180000)throw Error();
 const scenario=prepareScenario(payload.source);
 if(Object.keys(payload.points||{}).sort().join()!=='CANDIDATE,KITCHEN')throw Error();
 for(const p of Object.values(payload.points))if(!p||Object.keys(p).sort().join()!=='lat,lng'||
   !Number.isFinite(p.lat)||!Number.isFinite(p.lng)||p.lat< -90||p.lat>90||p.lng< -180||p.lng>180)throw Error();
 const preflight=assessRetrospectiveSingle(payload.source,{basis:'SIMULATED_SENSITIVITY',outboundSeconds:0,returnSeconds:0},{enabled:true});
 if(preflight.status!=='SHADOW_RECOMMENDATION')throw Error();
 return {payload,scenario,candidate:{sourceIdentity:input.sourceIdentity,sourceHash:hash(JSON.stringify({source:payload.source,points:payload.points})),
   buildHash:buildHash(),observedStatus:payload.source.orders[0].status,serviceDate:scenario.serviceDate}};
}
async function run(input,{enabled=false,allowLiveRequests=false,stage,apiKey,transport,
 clock=()=>new Date().toISOString()}={}){
 if(enabled!==true)return {status:'DISABLED',verified:false,networkRequests:0};
 try{
  const p=prepare(input,clock);
  if(input.mode==='PREPARE')return {status:'PREPARED',bindingHash:input.bindingHash,candidate:p.candidate};
  if(input.mode!=='CAPTURE'||allowLiveRequests!==true||stage!=='staging'||
     !input.candidate||Object.keys(input.candidate).sort().join()!==Object.keys(p.candidate).sort().join()||
     Object.keys(p.candidate).some(k=>input.candidate[k]!==p.candidate[k]))throw Error();
  const routes=await collectGoogleStagingRoutes({orders:[{orderId:'CANDIDATE',orderType:'delivery'}],points:p.payload.points},
   {enabled:true,allowLiveRequests:true,stage:'staging',apiKey,transport,maxRequests:2,clock});
  if(routes.status!=='ROUTE_ESTIMATES_CAPTURED')return {status:'UNVERIFIED',reasonCode:'ROUTE_CAPTURE_UNVERIFIED',networkRequests:routes.networkRequests,verified:false};
  const out=routes.legs.find(l=>l.from==='KITCHEN'&&l.to==='CANDIDATE');
  const back=routes.legs.find(l=>l.from==='CANDIDATE'&&l.to==='KITCHEN');
  const result=assessRetrospectiveSingle(p.payload.source,{basis:'CURRENT_ESTIMATES_APPLIED_RETROSPECTIVELY',
   capturedAt:routes.assessedAt,outboundSeconds:out.durationSeconds,returnSeconds:back.durationSeconds},{enabled:true});
  return {status:'CAPTURED',envelope:{capturedAt:routes.assessedAt,result:{status:result.status,
   reasonCode:result.reasonCode,networkRequests:routes.networkRequests,verified:false,
   evidenceBasis:result.evidenceBasis,journeyBasis:result.journeyBasis,clockMapping:result.clockMapping,
   serviceDate:p.scenario.serviceDate,persistence:'NONE',provider:'GOOGLE_ROUTES',attribution:'Google Maps'}}};
 }catch(_){return {status:'UNVERIFIED',reasonCode:'PRIVATE_BRIDGE_REFUSED',verified:false};}
}
if(require.main===module){
 if(process.env.MASTER_WOK_PRIVATE_BRIDGE_ENABLED!=='true'){
  process.stdout.write(JSON.stringify({status:'DISABLED',verified:false,networkRequests:0}));
 }else{
  let text='',size=0,refused=false;
  process.stdin.on('data',chunk=>{size+=chunk.length;if(size>600000){refused=true;text='';}else if(!refused)text+=chunk;});
  process.stdin.on('end',async()=>{
   try{
    if(refused)throw Error();
    const r=await run(JSON.parse(text),{enabled:true,allowLiveRequests:process.env.MASTER_WOK_PRIVATE_BRIDGE_LIVE_REQUESTS==='true',
     stage:process.env.MASTER_WOK_PRIVATE_BRIDGE_STAGE,apiKey:process.env.MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY});
    process.stdout.write(JSON.stringify(r));
   }catch(_){process.stdout.write(JSON.stringify({status:'UNVERIFIED',reasonCode:'PRIVATE_BRIDGE_REFUSED',verified:false}));}
  });
 }
}
module.exports={run,prepare};
