'use strict';
// Staging-only inventory of fryer dependencies; does not schedule or approve.
const {OUT_OF_SCOPE}=require('./staging-out-of-scope-items');
const FIXED = {
  'stir-crispy': {crispyChicken:1},
  'salt-chicken': {crispyChicken:1},
  'salt-chickenchips': {crispyChicken:1,chips:1},
  'salt-chips': {chips:1}
};
const MODS = {
  tofu:'tofu','extra-tofu':'tofu',
  'batter-chicken':'batteredChicken','extra-bchicken':'batteredChicken'
};
function diagnoseFryer(orders,rows) {
  const known=new Map(orders.map(o=>[String(o.orderId),o]));
  const dependencies=[],unmodelled=[];
  for(const row of rows) {
    const order=known.get(String(row.id));
    if(!order) continue;
    if(!Array.isArray(row.items)) {
      unmodelled.push({orderId:String(row.id),reason:'MISSING_ITEMS'});
      continue;
    }
    for(const line of row.items) {
      if(!line || !Number.isInteger(line.qty) || line.qty<=0 ||
          !Array.isArray(line.modifiers)) {
        unmodelled.push({orderId:String(row.id),reason:'INVALID_LINE'});
        continue;
      }
      if(OUT_OF_SCOPE.has(line.item_id))continue;
      const counts={};
      for(const [type,count] of Object.entries(FIXED[line.item_id]||{}))
        counts[type]=count*line.qty;
      for(const mod of line.modifiers) {
        if(!mod || typeof mod.id!=='string') {
          unmodelled.push({orderId:String(row.id),reason:'INVALID_MODIFIER'});
          continue;
        }
        const type=MODS[mod.id];
        if(type) counts[type]=(counts[type]||0)+line.qty;
      }
      if(Object.keys(counts).length)
        dependencies.push({orderId:String(row.id),itemId:line.item_id,
          readyMinute:order.readyMinute,counts});
    }
  }
  return {status:dependencies.length||unmodelled.length?'UNVERIFIED':'NO_RECOGNISED_FRY_DEPENDENCIES',
    reason:unmodelled.length?'INVALID_FRY_INPUT':
      dependencies.length?'FRY_TIMELINE_NOT_SCHEDULED':'NO_FRY_WORK_IDENTIFIED',
    dependencies,unmodelled,bookingApprovalAllowed:false};
}
module.exports={diagnoseFryer};
