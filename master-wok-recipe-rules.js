'use strict';
// Kitchen facts supplied by David on 1 November 2026. One "batch" below is
// the kitchen's menu batch/serving, never an individual fish cake or prawn.
const FRYER={
 batteredChicken:{minutes:5,large:3,small:2},crispyChicken:{minutes:5,large:3,small:2},
 tofu:{minutes:5,large:3,small:2},chips:{minutes:5,large:3,small:2},
 springRollBatch:{minutes:7,large:3,small:2},
 fishCakeBatch:{minutes:3,large:6,small:3},friedPrawnBatch:{minutes:2,large:6,small:3},
 thaiSausageBatch:{minutes:3,large:10,small:5}
};
const PREPARED_SIDES=new Set(['prawn-crackers']);
const AUXILIARY={
 // Always budget reheating: 2m30 rounded up on this minute-grid scheduler.
 // One serving per run is conservative when rice happens to be freshly cooked.
 'jasmine-rice':{resource:'microwave',appliance:'microwave',minutes:3,capacity:1},
 'sticky-rice':{resource:'microwave',appliance:'microwave',minutes:3,capacity:1},
 'pork-dumplings':{resource:'microwave',appliance:'microwave',minutes:4,capacity:3,batchMinutes:{1:4,2:6,3:8}},
 'spare-ribs':{resource:'microwave',appliance:'microwave',minutes:5,capacity:1},
 // Conservative single-serving finishing on the existing chef/wok timeline.
 'chicken-satay':{resource:'wok',appliance:'small-wok',minutes:1,capacity:1},
 'moo-ping':{resource:'wok',appliance:'small-wok',minutes:1,capacity:1},
 'egg-rice':{resource:'microwave',appliance:'microwave',minutes:1,capacity:1,beforeMain:true},
 'coconut-rice':{resource:'microwave',appliance:'microwave',minutes:1,capacity:1,beforeMain:true},
 'fried-egg':{resource:'wok',appliance:'small-wok',minutes:2,capacity:2}
};
function fryerRecipe(type){return FRYER[type]||null;}
function fryerCapacity(type,basket){const r=fryerRecipe(type);return r?(basket==='large'?r.large:['small-1','small-2'].includes(basket)?r.small:0):0;}
module.exports={FRYER,AUXILIARY,PREPARED_SIDES,fryerRecipe,fryerCapacity};
