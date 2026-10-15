'use strict';
// Dedicated durable-volume store for shadow records only. No network or DB access.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { validServiceDate } = require('./master-wok-live-shadow');
const fields = ['requestedMinute','decidedMinute','decisionAt','evidenceBasis','schemaVersion','eventKey','serviceDate','authoritativeOutcome','prediction','reasonCode','modelVersion','authoritative'];
function validate(record) {
  if (!record || Object.keys(record).sort().join() !== [...fields].sort().join() ||
      record.schemaVersion !== 2 || record.evidenceBasis !== 'HYPOTHETICAL_PLAN' ||
      [record.requestedMinute,record.decidedMinute].some(v => v !== null && (!Number.isFinite(v) || v < 0 || v >= 1440)) ||
      (record.decisionAt !== null && (typeof record.decisionAt !== 'string' || !Number.isFinite(Date.parse(record.decisionAt)))) || record.authoritative !== false ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(record.eventKey) || !validServiceDate(record.serviceDate) ||
      !['ACCEPTED','DECLINED','SUGGESTED_TIME','UNKNOWN'].includes(record.authoritativeOutcome) ||
      !['GREEN','AMBER','UNVERIFIED'].includes(record.prediction) ||
      !/^[A-Z][A-Z0-9_]{0,63}$/.test(record.reasonCode) ||
      record.modelVersion !== 'master-wok-shadow-v1') throw Error('INVALID_SHADOW_RECORD');
  return Object.fromEntries(fields.map(key => [key, record[key]]));
}
async function createRecordStore(directory) {
  if (!path.isAbsolute(directory)) throw Error('ABSOLUTE_DEDICATED_DIRECTORY_REQUIRED');
  await fs.mkdir(directory, { recursive:true, mode:0o700 });
  async function syncDirectory() {
    const handle = await fs.open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }
  async function persist(input) {
    const record = validate(input);
    const bytes = JSON.stringify(record) + '\n';
    const name = crypto.createHash('sha256').update(record.eventKey).digest('hex') + '.json';
    const destination = path.join(directory, name);
    const temporary = path.join(directory, '.' + crypto.randomUUID() + '.tmp');
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try {
      try { await fs.link(temporary, destination); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (await fs.readFile(destination,'utf8') !== bytes) throw Error('EVENT_KEY_CONFLICT');
      }
      await syncDirectory();
    } finally { await fs.unlink(temporary).catch(() => {}); }
  }
  async function readAll() {
    const records = [];
    for (const name of (await fs.readdir(directory)).sort()) {
      if (/^[a-f0-9]{64}\.json$/.test(name)) records.push(validate(JSON.parse(await fs.readFile(path.join(directory,name),'utf8'))));
    }
    return records;
  }
  return Object.freeze({persist,readAll});
}
function summarize(records) {
  const matrix = {};
  for (const input of records) {
    const r = validate(input);
    const key = `${r.serviceDate}/${r.prediction}/${r.authoritativeOutcome}`;
    matrix[key] = (matrix[key] || 0) + 1;
  }
  return { total:records.length, matrix, evidenceBasis:'HYPOTHETICAL_RECOMMENDATIONS_VS_BOOKING_DECISIONS_NOT_COOKING_ACTIVITY' };
}
module.exports = {createRecordStore,summarize};
