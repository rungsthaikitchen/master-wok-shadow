// Read-only review snapshot of index.html helper at cb39250; not imported by any runtime.
function getEffectiveOrderTime(order) {
  // An explicitly confirmed adjusted time is always authoritative.
  if (order.confirmed_time) {
    return order.confirmed_time;
  }

  // Customer rejected the proposed time.
  // The original requested time was already unavailable,
  // so don't reserve capacity until another time is agreed/offered.
  if (
    order.status === 'pending' &&
    order.proposed_time
  ) {
    return null;
  }

  // A proposed replacement time is the best operational time we have.
  // This covers both an active proposal and an order subsequently
  // progressed/completed without confirmed_time being populated.
  if (order.proposed_time) {
    return order.proposed_time;
  }

  // Normal untouched order.
  return order.preferred_time;
}
module.exports = getEffectiveOrderTime;

