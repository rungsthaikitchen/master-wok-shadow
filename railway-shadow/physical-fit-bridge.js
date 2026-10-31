'use strict';
// Isolated read-only adapter for the production shadow collector's pseudonymised
// replay_rows shape. Does not modify collector, checkout, or booking decisions.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {scheduleCrossOrderPanang}=require('../staging-cross-order-scheduler');
const {plan}=require('../staging-combined-friday-replay');
const {londonPlacement}=require('../staging-booking-integration');
function run(input){
 const fail=reason=>({status:'UNVERIFIED',reason,bookingApprovalAllowed:false});
 if(!input||!/^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate||'')||
    !Array.isArray(input.rows)||input.rows.length>500)return fail('INVALID_INPUT');
 const ctx=vm.createContext({window:{},Date});
 for(const file of ['master-wok-model-bundle.js','master-wok.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{timeout:2000});
 const orders=[],rows=[];
 for(const row of input.rows){
  if(!row||typeof row.orderId!=='string'||!row.orderId||
     !Number.isInteger(row.readyMinute)||row.readyMinute<0||row.readyMinute>=1440||
     !Array.isArray(row.lines)||!row.lines.length||row.lines.length>100)return fail('INVALID_ORDER');
  const date=new Date(row.placedAt);
  if(!Number.isFinite(date.getTime()))return fail('INVALID_PLACEMENT');
  const london=londonPlacement(date);
  const items=[];
  for(const line of row.lines){
   if(!line||!ctx.window.MasterWokModelV1.hasItem(line.itemId)||
      !Number.isInteger(line.qty)||line.qty<1||line.qty>100||
      !Array.isArray(line.mods)||line.mods.some(m=>!m||typeof m.id!=='string'))
    return fail('INVALID_LINE');
   items.push({item_id:line.itemId,qty:line.qty,modifiers:line.mods});
  }
  orders.push({orderId:row.orderId,placedAt:london,readyMinute:row.readyMinute,
   classification:ctx.window.MasterWokModelV1.classifyBasket(row.lines)});
  rows.push({id:row.orderId,items});
 }
 const wok=scheduleCrossOrderPanang(orders,rows,{sharedRings:true,allowFryerDependent:true});
 const fryer=plan(orders,rows,wok);
 return {status:wok.status==='PHYSICAL_FIT_PROTOTYPE'&&fryer.status==='FRY_PLACED_PROTOTYPE'
  ?'PHYSICAL_FIT_PROTOTYPE':'UNVERIFIED',
  reason:fryer.reason,wokStatus:wok.status,fryerStatus:fryer.status,
  productionBatches:wok.productionBatches??null,fryerCycles:fryer.cycles??null,
  failures:fryer.failures??[],chefAttentionVerified:false,
  chronologyBasis:'POLLED_FINAL_STATE_APPROXIMATION_NOT_DECISION_HISTORY',
  bookingApprovalAllowed:false};
}
if(require.main===module){
 try{
  const raw=fs.readFileSync(0,'utf8');
  if(Buffer.byteLength(raw)>5_000_000)throw Error();
  process.stdout.write(JSON.stringify(run(JSON.parse(raw))));
 }catch(_){process.stdout.write(JSON.stringify({status:'UNVERIFIED',reason:'BRIDGE_FAILED',bookingApprovalAllowed:false}));}
}
module.exports={run};
