'use strict';
// Kitchen facts supplied by David on 1 November 2026. One "batch" below is
// the kitchen's menu batch/serving, never an individual fish cake or prawn.
const FRYER={
 batteredChicken:{minutes:5,large:3,small:2},crispyChicken:{minutes:5,large:3,small:2},
 tofu:{minutes:5,large:3,small:2},chips:{minutes:5,large:3,small:2},
 springRollBatch:{minutes:7,large:3,small:2},
 fishCakeBatch:{minutes:3,large:6,small:3},friedPrawnBatch:{minutes:2,large:6,small:3}
};
const AUXILIARY={
 'pork-dumplings':{resource:'microwave',appliance:'microwave',minutes:5,capacity:1},
 'spare-ribs':{resource:'microwave',appliance:'microwave',minutes:5,capacity:1},
 'fried-egg':{resource:'wok',appliance:'small-wok',minutes:2,capacity:2}
};
// Capacities/time are recorded, but the omitted cooking method must be confirmed
// before this entry can produce jobs. Do not guess a replacement method.
const UNCONFIRMED={'thai-sausage':{minutes:3,small:5,large:10,method:null}};
function fryerRecipe(type){return FRYER[type]||null;}
function fryerCapacity(type,basket){const r=fryerRecipe(type);return r?(basket==='large'?r.large:['small-1','small-2'].includes(basket)?r.small:0):0;}
module.exports={FRYER,AUXILIARY,UNCONFIRMED,fryerRecipe,fryerCapacity};
