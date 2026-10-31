'use strict';
// Staging snapshot normalizer. Input must be read INSIDE the locked transaction.
// Fails closed on missing items, timestamps or unsupported catalog items.
function normalizeStagingOrders({ rows, model, serviceDate }) {
  if (!Array.isArray(rows) || !model || typeof model.classifyBasket !== 'function' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate || '')) throw Error('INVALID_SNAPSHOT');
  const orders=[];
  for(const row of rows) {
    if (!row || !row.id || !row.created_at || !row.status ||
        !Array.isArray(row.items) || row.items.length===0) throw Error('INCOMPLETE_ORDER');
    if (['cancelled','declined','rejected'].includes(row.status.toLowerCase())) continue;
    const readyAt=row.confirmed_time || row.proposed_time || row.preferred_time;
    const created=new Date(row.created_at),ready=new Date(readyAt);
    if (!Number.isFinite(created.getTime()) || !Number.isFinite(ready.getTime())) throw Error('INVALID_TIMESTAMP');
    // Caller must supply times already converted to the service-date-local
    // clock; UTC getHours() would be wrong during British Summer Time.
    const readyMinute=row.local_ready_minute;
    if (!Number.isInteger(readyMinute) || readyMinute<0 || readyMinute>=1440 ||
        row.local_service_date!==serviceDate) throw Error('INVALID_LOCAL_TIME');
    const lines=row.items.map(item=>{
      if (!item || typeof item.item_id!=='string' || !Number.isInteger(item.qty) || item.qty<=0 ||
          (typeof model.hasItem==='function' && !model.hasItem(item.item_id))) throw Error('INVALID_ITEM');
      return {itemId:item.item_id,qty:item.qty,mods:item.modifiers || []};
    });
    orders.push({orderId:row.id,placedAt:created,readyMinute,classification:model.classifyBasket(lines)});
  }
  return orders;
}
module.exports={normalizeStagingOrders};
