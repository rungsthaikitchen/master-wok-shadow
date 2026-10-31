// RTK staging-only manual console capture. Paste into browser DevTools on STAGING
// after opening checkout, selecting a service date and waiting for times to load.
// Does not write, transmit, alter DOM, or change booking availability.
(() => {
  'use strict';
  const date = document.getElementById('cust-preferred-date')?.value;
  const select = document.getElementById('cust-preferred-time-select');
  const rawBasket = window.basket;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') ||
      !select || !Array.isArray(rawBasket) ||
      select.disabled || !select.options.length) {
    console.error('[MW staging capture] Open checkout, choose a date and wait for times to load.');
    return;
  }
  const validId = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x);
  const lines = rawBasket.map(line => ({
    itemId: line.itemId,
    qty: line.qty,
    mods: (line.mods || []).map(mod => ({id:mod.id})),
    spice: Number.isInteger(line.spice) ? line.spice : null
  }));
  if (!lines.length || lines.some(l => !validId(l.itemId) ||
      !Number.isInteger(l.qty) || l.qty < 1 ||
      !Array.isArray(l.mods) || l.mods.some(m => !validId(m.id)))) {
    console.error('[MW staging capture] Invalid or empty basket; no capture produced.');
    return;
  }
  const slots = Array.from(select.options).filter(o => /^([01]\d|2[0-3]):[0-5]\d$/.test(o.value))
    .map(o => {
      const [h,m] = o.value.split(':').map(Number);
      return {time:o.value,legacyAllowed:!o.disabled,
        window:h>21 || (h===21 && m>0)?'OVERRUN':'NORMAL'};
    });
  if (!slots.length || slots.length>300) {
    console.error('[MW staging capture] No valid slot decisions available.');
    return;
  }
  const capture = {schemaVersion:1,serviceDate:date,lines,decisions:slots,
    source:'STAGING_DROPDOWN_DISPLAY',masterWokStatus:'NOT_ASSESSED',
    comparisonVerified:false,bookingApprovalAllowed:false};
  console.log('[MW staging capture] Locally generated, not sent or saved:',capture);
  console.log('[MW staging capture] JSON (copy only if you wish to share it):');
  console.log(JSON.stringify(capture,null,2));
})();
