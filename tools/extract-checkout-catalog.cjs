'use strict';
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync(process.argv[2],'utf8');
const start=source.indexOf('const EXTRAS = ['),end=source.indexOf('// ---------- State ----------',start);
if(start<0||end<0)throw Error('MENU_BOUNDARY_NOT_FOUND');
const data=vm.runInNewContext(source.slice(start,end)+';({EXTRAS,MODIFIERS,MENU_CATEGORIES})',{}, {timeout:1000});
const loads={'Starter':0,'Soup':1,'Salad':1,'Curry':1,'Stir Fry':1,'Noodles & Rice':1,'Side Dishes':0,'Soft Drinks':0};
const fields=['id','name','price','img','allowedModifiers','modifierRequired','modifierMax','spiceEnabled','spiceDefault','spiceMin','allowedExtras'];
const items=data.MENU_CATEGORIES.flatMap(cat=>cat.items.map(item=>Object.fromEntries([
 ...fields.filter(k=>Object.hasOwn(item,k)).map(k=>[k,item[k]]),
 ['categoryAllowExtras',!!cat.allowExtras],['kitchenLoad',item.kitchenLoad??loads[cat.title]??0]])));
process.stdout.write(JSON.stringify({sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),
 sourceRepository:'rungsthaikitchen/Rungs-Thai-Kitchen',sourcePath:'index.html',
 automaticMidweekDiscountEnabled:false,items,modifiers:data.MODIFIERS,extras:data.EXTRAS},null,2)+'\n');
