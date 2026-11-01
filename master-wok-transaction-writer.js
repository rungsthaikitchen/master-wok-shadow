'use strict';
// Transactional orchestration seam. Caller supplies a DEDICATED PostgreSQL
// connection (never a pool.query facade) and trusted classification inputs.
// No database credentials, browser access, or production wiring here.
async function reserveWithMasterWok({ connection, serviceDate, key, candidate, readCommitted, persist, assess, prepareCandidate }) {
  if (!connection || typeof connection.query !== 'function' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate || '') ||
      !key || !candidate || !readCommitted || !persist || !assess) {
    return { status: 'UNVERIFIED', committed: false, reason: 'INVALID_REQUEST' };
  }
  let fingerprint;
  try { fingerprint=JSON.stringify(candidate); } catch (_) {
    return {status:'UNVERIFIED',committed:false,reason:'INVALID_REQUEST'};
  }
  try {
    await connection.query('BEGIN');
    // READ COMMITTED is required: after waiting for the date lock, reads must
    // see the previous writer's commit rather than an earlier snapshot.
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.query("SET LOCAL lock_timeout = '10s'");
    await connection.query("SET LOCAL statement_timeout = '15s'");
    // A key lock also serializes retries that change service date. Always take
    // key before date locks; lifecycle writers must use this same order.
    await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 47823))", [key]);
    // A single date lock covers every slot and time-move for that date.
    await connection.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 47822))",
      [serviceDate]
    );
    // Both idempotency lookup and capacity assessment MUST be inside the lock.
    const state = await readCommitted(connection, { serviceDate, key });
    if (!state || !Array.isArray(state.acceptedOrders)) throw Error('INCOMPLETE_STATE');
    if (state.existingKey) {
      const same = state.existingKey.fingerprint === fingerprint;
      await connection.query('ROLLBACK');
      return same
        ? { status: 'GREEN', committed: false, reason: 'REPLAY', ...(state.existingKey.response?{response:state.existingKey.response}:{}) }
        : { status: 'UNVERIFIED', committed: false, reason: 'IDEMPOTENCY_CONFLICT' };
    }
    // Canonicalization and trusted server validation happen inside the lock.
    const canonical=prepareCandidate?await prepareCandidate(candidate,connection,state):candidate;
    if(!canonical)throw Error('INVALID_CANONICAL_CANDIDATE');
    const assessment = await assess({ acceptedOrders: state.acceptedOrders, proposedOrder: canonical, rawRows: state.rawRows, state });
    if (assessment?.status !== 'GREEN' || assessment.bookingApprovalAllowed === false) {
      await connection.query('ROLLBACK');
      return { status: assessment?.status === 'AMBER' ? 'AMBER' : 'UNVERIFIED', committed: false, reason: 'REVIEW_REQUIRED' };
    }
    // persist MUST atomically insert the complete order, its items, and
    // reservation/idempotency record on this same connection.
    const response=await persist(connection, { serviceDate, key, candidate:canonical, fingerprint });
    await connection.query('COMMIT');
    return { status: 'GREEN', committed: true, reason: 'RESERVED', ...(response?{response}:{}) };
  } catch (_) {
    try { await connection.query('ROLLBACK'); } catch (_) {}
    return { status: 'UNVERIFIED', committed: false, reason: 'TRANSACTION_FAILED' };
  }
}
module.exports = { reserveWithMasterWok };

