'use strict';
const {validServiceDate}=require('./master-wok-live-shadow');
const {validateEventBatch,replay}=require('./master-wok-chronological-replay');
const {validateTransferPair}=require('./master-wok-event-transfers');
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===k.slice().sort().join();
const stamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&validServiceDate(v.slice(0,10))&&Number(v.slice(11,13))<24&&Number(v.slice(14,16))<60&&Number(v.slice(17,19))<60&&Number.isFinite(Date.parse(v));
const instant=v=>BigInt(Date.parse(v))*1000n+BigInt((v.match(/\.(\d{1,6})/)?.[1]||'').padEnd(6,'0').slice(3));
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
function compareTransferBundle(input,{enabled=false,validateOnly=false}={}){
 if(enabled!==true)return {status:'DISABLED',verified:false,networkRequests:0};
 try{
  const b=structuredClone(input);
  if(!exact(b,['basis','project','streams','transfers'])||b.basis!=='CONSISTENT_TRANSFER_SNAPSHOT'||b.project!=='hvrqgufqjslvgiohgkvu'||!Array.isArray(b.streams)||b.streams.length!==2||!Array.isArray(b.transfers)||b.transfers.length>1000||Buffer.byteLength(JSON.stringify(b))>10000000)throw Error();
  const streams=new Map(),days=new Set(),events=new Map();
  for(const s of b.streams){
   if(!exact(s,['streamId','batch'])||!uuid(s.streamId)||streams.has(s.streamId)||days.has(s.batch?.serviceDate))throw Error();
   const validated=validateEventBatch(s.batch);streams.set(s.streamId,s.batch);days.add(s.batch.serviceDate);
   for(const e of validated)if(e.transferId){const rows=events.get(e.transferId)||[];rows.push({streamId:s.streamId,event:e});events.set(e.transferId,rows);}
  }
  const seen=new Set();
  for(const t of b.transfers){
   if(!exact(t,['transferId','sourceStream','destinationStream','eventAt','orderId','targetAt'])||seen.has(t.transferId)||t.sourceStream===t.destinationStream||!streams.has(t.sourceStream)||!streams.has(t.destinationStream))throw Error();
   seen.add(t.transferId);
   const rows=events.get(t.transferId)||[],incoming=rows.find(r=>r.streamId===t.destinationStream&&r.event.kind==='RESERVATION_TRANSFERRED_IN');
   if(rows.length!==2||!incoming||t.eventAt!==incoming.event.at||t.orderId!==incoming.event.order.orderId||!stamp(t.targetAt)||instant(t.targetAt)!==instant(incoming.event.order.targetAt))throw Error();
   if(validateTransferPair(streams.get(t.sourceStream),streams.get(t.destinationStream),t.transferId,{enabled:true}).status!=='PAIRED')throw Error();
  }
  if(seen.size!==events.size)throw Error();
  if(validateOnly)return {status:'VALIDATED',streamCount:2,transferCount:seen.size,verified:false,networkRequests:0};
  const results=b.streams.map(s=>({streamId:s.streamId,result:replay(s.batch,{enabled:true,maxElapsedMs:5000})}));
  if(results.some(r=>r.result.status!=='REPLAYED'))throw Error();
  return {status:'COMPARED',streamCount:2,transferCount:seen.size,results,verified:false,networkRequests:0};
 }catch(_){return {status:'UNVERIFIED',reasonCode:'TRANSFER_BUNDLE_UNVERIFIED',results:[],verified:false,networkRequests:0};}
}
module.exports={compareTransferBundle};
if(require.main===module){
 if(process.env.MASTER_WOK_TRANSFER_BUNDLE_ENABLED!=='true')process.stdout.write(JSON.stringify(compareTransferBundle(null)));
 else{
  let input='',bytes=0,refused=false;process.stdin.on('data',v=>{bytes+=v.length;if(bytes>10000000){input='';refused=true;}else if(!refused)input+=v;});
  process.stdin.on('end',()=>{let r;try{if(refused)throw Error();r=compareTransferBundle(JSON.parse(input),{enabled:true,validateOnly:process.env.MASTER_WOK_TRANSFER_BUNDLE_VALIDATE_ONLY==='true'});}catch(_){r={status:'UNVERIFIED',reasonCode:'TRANSFER_BUNDLE_UNVERIFIED',results:[],verified:false,networkRequests:0};}process.stdout.write(JSON.stringify(r));});
 }
}
