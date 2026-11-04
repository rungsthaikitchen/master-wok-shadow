'use strict';
// In-memory staging harness only. NOT an authoritative distributed booking writer.
// It demonstrates the exact serialization and idempotency contract needed by a
// future transactional database implementation. No production/network writes.
class SerialBookingHarness {
  constructor(assess) {
    if (typeof assess !== 'function') throw new TypeError('assess function required');
    this.assess = assess;
    this.byDate = new Map();
    this.byKey = new Map();
    this.tails = new Map();
  }
  async submit({ serviceDate, idempotencyKey, candidate }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate || '') ||
        typeof idempotencyKey !== 'string' || !idempotencyKey.trim() ||
        !candidate) return { status: 'UNVERIFIED', committed: false, reason: 'INVALID_REQUEST' };
    // Serialize before checking the idempotency key, so duplicate concurrent
    // submissions cannot race each other.
    const previous = this.tails.get(serviceDate) || Promise.resolve();
    let release;
    const next = new Promise(resolve => { release = resolve; });
    this.tails.set(serviceDate, next);
    await previous;
    try {
      const prior = this.byKey.get(idempotencyKey);
      if (prior) {
        if (prior.serviceDate !== serviceDate ||
            JSON.stringify(prior.candidate) !== JSON.stringify(candidate)) {
          return { status: 'UNVERIFIED', committed: false, reason: 'IDEMPOTENCY_CONFLICT' };
        }
        return prior.result;
      }
      const existing = this.byDate.get(serviceDate) || [];
      let assessment;
      try {
        assessment = await this.assess({ serviceDate, acceptedOrders: [...existing], proposedOrder: candidate });
      } catch (_) {
        return { status: 'UNVERIFIED', committed: false, reason: 'ASSESSMENT_FAILED' };
      }
      const status = assessment?.status;
      const result = status === 'GREEN'
        ? { status: 'GREEN', committed: true, reason: 'RESERVED' }
        : { status: status === 'AMBER' ? 'AMBER' : 'UNVERIFIED', committed: false, reason: 'REVIEW_REQUIRED' };
      if (result.committed) {
        this.byDate.set(serviceDate, [...existing, candidate]);
        this.byKey.set(idempotencyKey, { serviceDate, candidate, result });
      }
      return result;
    } finally {
      release();
      if (this.tails.get(serviceDate) === next) this.tails.delete(serviceDate);
    }
  }
  count(serviceDate) { return (this.byDate.get(serviceDate) || []).length; }
}
module.exports = { SerialBookingHarness };
