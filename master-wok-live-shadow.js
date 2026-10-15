/*
 * Master Wok live shadow observation boundary (experimental, server-side).
 * This module does NOT fetch data, alter checkout, or write to a database.
 * The backend must provide a consistent decision-time snapshot, an assessment
 * function, and an idempotent persistence callback before enabling it.
 */
'use strict';

const ALLOWED_PREDICTIONS = new Set(['GREEN', 'AMBER', 'UNVERIFIED']);
const ALLOWED_OUTCOMES = new Set(['ACCEPTED', 'DECLINED', 'SUGGESTED_TIME', 'UNKNOWN']);

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Master Wok shadow: ${field} required`);
  }
  return value.trim();
}

function validServiceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}

function cleanReason(reason) {
  // Only internal fixed reason codes should be stored. No exception messages,
  // customer details, free text, or full basket payloads in observation logs.
  return typeof reason === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(reason)
    ? reason : 'UNSPECIFIED';
}

function createLiveShadowObserver({ assess, persist, enabled = false, logger = () => {}, timeoutMs = 1000 } = {}) {
  if (typeof assess !== 'function') throw new TypeError('Master Wok shadow: assess function required');
  if (typeof persist !== 'function') throw new TypeError('Master Wok shadow: persist function required');
  if (typeof logger !== 'function') throw new TypeError('Master Wok shadow: logger must be a function');

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw new TypeError('Invalid observer timeout');
  }
  async function bounded(fn) {
    let timer;
    const controller = new AbortController();
    try {
      return await Promise.race([
        Promise.resolve().then(() => fn(controller.signal)),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error('SHADOW_TIMEOUT'));
        }, timeoutMs); })
      ]);
    } finally { clearTimeout(timer); }
  }

  /**
   * Call only AFTER the authoritative booking decision. This never changes it.
   * Inputs are deliberately minimal: eventKey should be an opaque stable ID
   * unique per authoritative decision/revision; it must NOT contain PII.
   * The injected `assess` must use a trustworthy pre-decision snapshot and
   * must return UNVERIFIED when commitments cannot be established.
   */
  function safeLog(code) { try { Promise.resolve(logger(code)).catch(() => {}); } catch (_) {} }

  async function observe(event) {
    if (enabled !== true) return { observed: false, reason: 'DISABLED' };

    // Never reject an actual booking because the shadow is misconfigured.
    try {
      const { eventKey, serviceDate, outcome, snapshot, requestedMinute = null, decidedMinute = null, decisionAt = null } = event || {};
      const key = requireString(eventKey, 'eventKey');
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
        throw new TypeError('Master Wok shadow: eventKey must be opaque');
      }
      if (!validServiceDate(serviceDate)) throw new TypeError('Invalid service date');
      if (!ALLOWED_OUTCOMES.has(outcome)) throw new TypeError('Invalid outcome');

      for (const minute of [requestedMinute, decidedMinute]) {
        if (minute !== null && (!Number.isFinite(minute) || minute < 0 || minute >= 1440)) throw Error('INVALID_MINUTE');
      }
      if (decisionAt !== null && (typeof decisionAt !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(decisionAt) ||
          !Number.isFinite(Date.parse(decisionAt)))) throw Error('INVALID_DECISION_TIME');
      let prediction = 'UNVERIFIED';
      let reasonCode = 'ASSESSMENT_UNAVAILABLE';
      try {
        const privateSnapshot = structuredClone(snapshot);
        const result = await bounded(signal => assess({ serviceDate, snapshot: privateSnapshot, signal }));
        if (result && ALLOWED_PREDICTIONS.has(result.status)) {
          prediction = result.status;
          reasonCode = cleanReason(result.reasonCode);
        } else {
          reasonCode = 'INVALID_ASSESSMENT';
        }
      } catch (_) {
        reasonCode = 'ASSESSMENT_ERROR';
      }

      // No customer name, email, phone, address, order lines or raw error text.
      const record = Object.freeze({
        schemaVersion: 2,
        requestedMinute, decidedMinute, decisionAt,
        evidenceBasis: 'HYPOTHETICAL_PLAN',
        eventKey: key,
        serviceDate,
        authoritativeOutcome: outcome,
        prediction,
        reasonCode,
        modelVersion: 'master-wok-shadow-v1',
        authoritative: false
      });

      // The backend MUST enforce UNIQUE(eventKey) and upsert/do-nothing
      // semantics; retries and duplicate delivery are normal.
      try {
        await bounded(signal => persist(record, { signal }));
        return { observed: true, prediction };
      } catch (_) {
        safeLog('MASTER_WOK_SHADOW_PERSIST_FAILED');
        return { observed: false, reason: 'PERSIST_FAILED' };
      }
    } catch (_) {
      safeLog('MASTER_WOK_SHADOW_INVALID_EVENT');
      return { observed: false, reason: 'INVALID_EVENT' };
    }
  }

  return Object.freeze({ observe });
}

module.exports = { createLiveShadowObserver, validServiceDate };
