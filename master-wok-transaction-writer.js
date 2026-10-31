'use strict';
// Transactional orchestration seam. Caller supplies a DEDICATED PostgreSQL
// connection (never a pool.query facade) and trusted classification inputs.
// No database credentials, browser access, or production wiring here.
async function reserveWithMasterWok({ connection, serviceDate, key, candidate, readCommitted, persist, assess }) {
  if (!connection || typeof connection.query !== 'function' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate || '') ||
      !key || !candidate || !readCommitted || !persist || !assess) {
    return { status: 'UNVERIFIED', committed: false, reason: 'INVALID_REQUEST' };
  }
  await connection.query('BEGIN');
  try {
    // A single date lock covers every slot and time-move for that date.
    await connection.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 47822))",
      [serviceDate]
    );
    // Both idempotency lookup and capacity assessment MUST be inside the lock.
    const state = await readCommitted(connection, { serviceDate, key });
    if (!state || !Array.isArray(state.acceptedOrders)) throw Error('INCOMPLETE_STATE');
    if (state.existingKey) {
      const same = state.existingKey.fingerprint === JSON.stringify(candidate);
      await connection.query('ROLLBACK');
      return same
        ? { status: 'GREEN', committed: false, reason: 'REPLAY' }
        : { status: 'UNVERIFIED', committed: false, reason: 'IDEMPOTENCY_CONFLICT' };
    }
    const assessment = await assess({ acceptedOrders: state.acceptedOrders, proposedOrder: candidate });
    if (assessment?.status !== 'GREEN') {
      await connection.query('ROLLBACK');
      return { status: assessment?.status === 'AMBER' ? 'AMBER' : 'UNVERIFIED', committed: false, reason: 'REVIEW_REQUIRED' };
    }
    // persist MUST atomically insert the complete order, its items, and
    // reservation/idempotency record on this same connection.
    await persist(connection, { serviceDate, key, candidate, fingerprint: JSON.stringify(candidate) });
    await connection.query('COMMIT');
    return { status: 'GREEN', committed: true, reason: 'RESERVED' };
  } catch (_) {
    try { await connection.query('ROLLBACK'); } catch (_) {}
    return { status: 'UNVERIFIED', committed: false, reason: 'TRANSACTION_FAILED' };
  }
}
module.exports = { reserveWithMasterWok };
