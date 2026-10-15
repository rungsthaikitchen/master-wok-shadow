'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validServiceDate } = require('./master-wok-live-shadow');
// A separate background worker should call this; never await scheduling in checkout.
function createReplayAssessment({timeoutMs=2000}={}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw Error('INVALID_TIMEOUT');
  const sources = ['master-wok-model-bundle.js','master-wok.js','master-wok-shadow.js']
    .map(file => fs.readFileSync(path.join(__dirname,file),'utf8'));
  return function assess({serviceDate,snapshot}) {
    const uncertain = reasonCode => ({status:'UNVERIFIED',reasonCode});
    if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Europe/London') return uncertain('SERVICE_TIMEZONE_REQUIRED');
    if (!validServiceDate(serviceDate) || !snapshot || snapshot.complete !== true ||
        snapshot.basis !== 'PRE_DECISION_HISTORY' || !Array.isArray(snapshot.reservations) ||
        !snapshot.proposed || !Number.isFinite(Date.parse(snapshot.decisionAt))) return uncertain('SNAPSHOT_UNVERIFIED');
    const input = structuredClone(snapshot);
    const decision = new Date(input.decisionAt);
    const reservations = [...input.reservations, {...input.proposed, placedAt:input.decisionAt}];
    if (reservations.length > 500) return uncertain('SNAPSHOT_TOO_LARGE');
    const context = vm.createContext({window:{},Date});
    try {
      for (const source of sources) vm.runInContext(source,context,{timeout:timeoutMs});
      context.reservations = reservations.map((order,index) => {
        const placedAt = new Date(order.placedAt);
        if (!Number.isFinite(placedAt.getTime()) || placedAt > decision ||
            (index < input.reservations.length && placedAt.getTime() === decision.getTime())) throw Error('AMBIGUOUS_CHRONOLOGY');
        if (!Array.isArray(order.lines) || !order.lines.length || order.lines.length > 100 || order.lines.some(line =>
          !line || !context.window.MasterWokModelV1.hasItem(line.itemId) ||
          !Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 100 ||
          (line.mods != null && (!Array.isArray(line.mods) || line.mods.length > 30)))) throw Error('INVALID_LINES');
        return {orderId:order.orderId,placedAt,readyMinute:order.readyMinute,
          classification:context.window.MasterWokModelV1.classifyBasket(order.lines)};
      });
      context.serviceDate = serviceDate;
      const replay = vm.runInContext('window.MasterWokShadowV1.replayReservationsV1(serviceDate,reservations)',context,{timeout:timeoutMs});
      const last = replay.observations.at(-1);
      if (!last || last.orderId !== String(input.proposed.orderId)) return uncertain('REPLAY_UNVERIFIED');
      return {status:last.status,reasonCode:last.status === 'UNVERIFIED' ? 'REPLAY_UNVERIFIED' : 'HYPOTHETICAL_REPLAY'};
    } catch (_) { return uncertain('ASSESSMENT_INPUT_OR_SEARCH_ERROR'); }
  };
}
module.exports = {createReplayAssessment};
