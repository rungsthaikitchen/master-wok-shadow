// Offline/default-off mapping only. No persistence, network, quotes or pricing authority.
const SHAPES=require('../fixtures/checkout-source-shapes-25-oct.json');
const COLUMNS=require('../fixtures/checkout-column-contract-25-oct.json').tables;
const PROJECT='hvrqgufqjslvgiohgkvu';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
function fail(){throw Error('CHECKOUT_FIELD_MAPPING_REFUSED');}
function wireClone(value){
 try{
  const s=JSON.stringify(value,(_key,v)=>{
   if(v===undefined||typeof v==='function'||typeof v==='symbol'||typeof v==='bigint'||(typeof v==='number'&&!Number.isFinite(v)))fail();
   return v;
  });
  if(!s||Buffer.byteLength(s)>250000)fail();return JSON.parse(s);
 }catch{fail();}
}
function fields(value,required,optional=[]){
 if(!value||typeof value!=='object'||Array.isArray(value))fail();
 if(required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))fail();
}
function columnTypes(value,table){
 for(const [key,v]of Object.entries(value)){
  const col=COLUMNS[table][key];if(!col)fail();if(v===null){if(!col.nullable)fail();continue;}
  const okay=col.type==='text'?typeof v==='string':col.type==='uuid'?uuid(v):col.type==='boolean'?typeof v==='boolean':col.type==='integer'?Number.isInteger(v):['numeric','double precision'].includes(col.type)?typeof v==='number'&&Number.isFinite(v):col.type==='timestamp with time zone'?typeof v==='string'&&Number.isFinite(Date.parse(v)):col.type==='jsonb'?Array.isArray(v):false;
  if(!okay)fail();
 }
}
function pence(value){
 if(typeof value!=='number'||!Number.isFinite(value)||!/^[-]?\d+(\.\d{1,2})?$/.test(String(value)))return null;
 const negative=value<0;const [whole,fraction='']=String(Math.abs(value)).split('.');return (negative?-1n:1n)*(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
}
function moneyDiagnostics(order,items){
 const out=[];const names=['subtotal','discount','delivery_fee','total'];const values=names.map(k=>pence(order[k]));
 const amounts=[...values,...['discount_amount','loyalty_discount'].filter(k=>Object.hasOwn(order,k)).map(k=>pence(order[k])),...items.flatMap(i=>[pence(i.unit_price),...i.modifiers.map(m=>pence(m.delta))])];
 if(amounts.some(v=>v===null))return ['MONETARY_PRECISION_UNVERIFIED'];
 const [subtotal,discount,fee,total]=values;
 const lineTotal=items.reduce((sum,i)=>sum+pence(i.unit_price)*BigInt(i.qty),0n);
 if(lineTotal!==subtotal)out.push('STORED_SUBTOTAL_DIFFERS_FROM_LINES');
 if(total!==subtotal-discount+fee)out.push('STORED_TOTAL_DIFFERS_FROM_SUBTOTAL_MINUS_DISCOUNT_PLUS_FEE');
 if(order.discount>0&&!order.discount_label)out.push('DISCOUNT_LABEL_ABSENT');
 return out;
}
function validTarget(target){
 if(typeof target!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(target)||!Number.isFinite(Date.parse(target)))return false;
 const clock=target.slice(0,19),date=new Date(clock+'Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,19)===clock;
}
function prepareCheckout(options={}){
 if(options.enabled!==true)return {status:'DISABLED',sourceRequests:0,verified:false};
 const {project,sourcePage,orderId,orderAlias,order,items}=options;
 if(project!==PROJECT||!Object.hasOwn(SHAPES.pages,sourcePage)||!uuid(orderId)||typeof orderAlias!=='string'||!/^synthetic-[a-z0-9_-]{1,80}$/.test(orderAlias))fail();
 const shape=SHAPES.pages[sourcePage];const privateOrder=wireClone(order),privateItems=wireClone(items);
 fields(privateOrder,[...new Set(shape.order.keys)]);
 columnTypes(privateOrder,'orders');
 if(!uuid(privateOrder.customer_id)||!uuid(privateOrder.idempotency_key)||!['collection','delivery'].includes(privateOrder.order_type)||typeof privateOrder.asap_requested!=='boolean')fail();
 if(!Array.isArray(privateItems)||privateItems.length<1||privateItems.length>100)fail();
 for(const item of privateItems){
  fields(item,shape.items.keys,['item_note']);
  columnTypes(item,'order_items');
  if(item.order_id!==orderId||typeof item.item_id!=='string'||!/^[a-z0-9-]{1,80}$/.test(item.item_id)||!Number.isInteger(item.qty)||item.qty<1||item.qty>100||typeof item.unit_price!=='number'||!Array.isArray(item.modifiers)||item.modifiers.length>20)fail();
  for(const modifier of item.modifiers){
   fields(modifier,['id','name','delta']);
   if(typeof modifier.id!=='string'||!/^[a-z0-9-]{1,80}$/.test(modifier.id)||typeof modifier.name!=='string'||typeof modifier.delta!=='number')fail();
  }
 }
 const diagnostics=moneyDiagnostics(privateOrder,privateItems);let engineProjection=null;
 const target=privateOrder.preferred_time;
 if(privateOrder.asap_requested||!validTarget(target))diagnostics.push('REQUEST_TARGET_UNVERIFIED');
 else engineProjection={orderId:orderAlias,orderType:privateOrder.order_type,targetAt:target,deliveryReadyEstimate:null,lines:privateItems.map(i=>({itemId:i.item_id,qty:i.qty,mods:i.modifiers.map(m=>({id:m.id}))}))};
 if(privateOrder.order_type==='delivery')diagnostics.push('DELIVERY_READY_ESTIMATE_MISSING');
 return {status:'PREPARED',sourceRequests:0,verified:false,prediction:'UNVERIFIED',evidenceBasis:'CHECKOUT_MAPPING_NOT_PERSISTENCE_OR_DECISION_HISTORY',source:{websiteCommit:SHAPES.websiteCommit,page:sourcePage},binding:{orderId,requestId:privateOrder.idempotency_key},privateWrite:{order:privateOrder,items:privateItems},engineProjection,diagnostics};
}
module.exports={prepareCheckout,PROJECT};
