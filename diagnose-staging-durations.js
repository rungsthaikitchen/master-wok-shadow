'use strict';
// Diagnostic only: classify a dish without scheduling or changing engine rules.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx=vm.createContext({window:{},Date});
for(const file of ['master-wok-model-bundle.js','master-wok.js'])
 vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),ctx,{timeout:3000});
const model=ctx.window.MasterWokModelV1;
const ids=['panang-curry','jasmine-rice'];
for(const id of ids){
 const classification=model.classifyBasket([{itemId:id,qty:1,mods:[]}]);
 const pressure=model.calculateCombinedKitchenPressure([classification]);
 console.log(JSON.stringify({item:id,known:model.hasItem(id),groups:classification.groups,
   productionLines:classification.productionLines.length,
   rawMinutes:pressure?.productionWindow?.rawMinutes??null,
   reservedMinutes:pressure?.productionWindow?.reservedMinutes??null}));
}
