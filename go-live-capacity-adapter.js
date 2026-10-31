'use strict';
// Staging integration adapter: pure decision mapping, no database or network calls.
// A GREEN model result is advisory until an authoritative, atomic booking commit exists.
function interpretCapacityAssessment(assessment) {
  if (!assessment || typeof assessment !== 'object') {
    return { status: 'UNVERIFIED', action: 'REVIEW', reason: 'ASSESSMENT_MISSING', canAutoCommit: false };
  }
  const status = assessment.status;
  if (status === 'GREEN') {
    return { status, action: 'CANDIDATE', reason: 'CAPACITY_FITS', canAutoCommit: false };
  }
  if (status === 'AMBER') {
    return { status, action: 'REVIEW', reason: 'CAPACITY_REVIEW_REQUIRED', canAutoCommit: false };
  }
  return { status: 'UNVERIFIED', action: 'REVIEW', reason: 'CAPACITY_UNVERIFIED', canAutoCommit: false };
}
function assessCandidate(engine, { acceptedOrders, proposedOrder, asOfMinute } = {}) {
  if (!engine || typeof engine.assessCapacityV1 !== 'function' ||
      !Array.isArray(acceptedOrders) || !proposedOrder) {
    return interpretCapacityAssessment(null);
  }
  try {
    return interpretCapacityAssessment(engine.assessCapacityV1({ acceptedOrders, proposedOrder, asOfMinute }));
  } catch (_) {
    return { status: 'UNVERIFIED', action: 'REVIEW', reason: 'ASSESSMENT_FAILED', canAutoCommit: false };
  }
}
module.exports = { interpretCapacityAssessment, assessCandidate };
