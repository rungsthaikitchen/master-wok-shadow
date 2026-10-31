'use strict';
// Offline audit: derive legacy kitchen load from the actual website menu source.
// This does NOT recreate historical database values; results are estimates
// from the checked-out website version, never booking approval evidence.
const fs=require('node:fs');
const path=require('node:path');
const DEFAULT={Starter:0,Soup:1,Salad:1,Curry:1,'Stir Fry':1,'Noodles & Rice':1,'Side Dishes':0,'Soft Drinks':0};
function extractMenuLoads(html){
 const start=html.indexOf('const MENU_CATEGORIES = [');
 const end=html.indexOf('\n    ];',start);
 if(start<0||end<0)throw Error('MENU_BOUNDARY_NOT_FOUND');
 // Stop at the menu array closing line, before MODIFIERS and other arrays.
 const source=html.slice(start,end);
 const rows=source.replace(/\/\*[\s\S]*?\*\//g,'').split(/\r?\n/);
 let category=null;const catalog=new Map();
 for(const line of rows){
  if(/^\s*\/\//.test(line))continue;
  const cat=line.match(/\{\s*id\s*:\s*['"][\w-]+['"]\s*,\s*title\s*:\s*['"]([^'"]+)['"]\s*,[^\n]*items\s*:\s*\[/);
  if(cat){category=cat[1];continue;}
  const item=line.match(/^\s*\{\s*id\s*:\s*['"]([\w-]+)['"]/);
  if(!item||!category)continue;
  const override=line.match(/\bkitchenLoad\s*:\s*(\d+)/);
  if(override===null&&!Object.hasOwn(DEFAULT,category))throw Error('UNKNOWN_CATEGORY_'+category);
  if(catalog.has(item[1]))throw Error('DUPLICATE_MENU_ITEM_'+item[1]);
  catalog.set(item[1],{category,kitchenLoad:override?Number(override[1]):DEFAULT[category],
    source:override?'EXPLICIT_MENU_OVERRIDE':'CATEGORY_DEFAULT'});
 }
 if(catalog.size<20)throw Error('MENU_PARSE_INCOMPLETE');
 return catalog;
}
function audit(snapshot,html){
 if(!snapshot||!Array.isArray(snapshot.orders))throw Error('INVALID_SNAPSHOT');
 const catalog=extractMenuLoads(html);
 const missing=new Set(),rows=[];
 for(const order of snapshot.orders){
  let load=0;
  for(const item of order.items||[]){
   const found=catalog.get(item.item_id);
   if(!found||!Number.isInteger(item.qty)||item.qty<1){missing.add(item.item_id||'INVALID_ITEM');continue;}
   load+=found.kitchenLoad*item.qty;
  }
  rows.push({orderId:order.id,estimatedKitchenLoad:load});
 }
 return {status:missing.size?'UNVERIFIED':'MENU_DERIVED_ESTIMATE',
  reason:'CURRENT_WEBSITE_MENU_NOT_HISTORICAL_ORDER_ITEM_KITCHEN_LOAD',
  menuItems:catalog.size,unknownItems:[...missing],orders:rows,
  comparisonVerified:false,bookingApprovalAllowed:false};
}
if(require.main===module){
 const snapshotPath=process.argv[2],htmlPath=process.argv[3];
 if(!snapshotPath||!htmlPath)throw Error('Usage: node audit-legacy-menu-loads.js <snapshot.json> <website-index.html>');
 const result=audit(JSON.parse(fs.readFileSync(snapshotPath,'utf8')),fs.readFileSync(htmlPath,'utf8'));
 console.log(JSON.stringify(result,null,2));
}
module.exports={extractMenuLoads,audit};
