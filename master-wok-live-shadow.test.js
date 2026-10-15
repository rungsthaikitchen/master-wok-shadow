'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveShadowObserver, validServiceDate } = require('./master-wok-live-shadow');
const event = { eventKey:'decision_000001', serviceDate:'2026-09-18', outcome:'ACCEPTED', snapshot: Object.freeze({ token: 7 }) };

test('disabled observer never calls assessment or persistence', async () => {
  let calls = 0;
  const observer = createLiveShadowObserver({enabled:false, assess:()=>{calls++;}, persist:()=>{calls++;}});
  assert.deepEqual(await observer.observe(event), {observed:false,reason:'DISABLED'});
  assert.equal(calls,0);
});

test('enabled observer persists only allowlisted metadata after authoritative outcome', async () => {
  let saved;
  const observer = createLiveShadowObserver({enabled:true,
    assess: async ({serviceDate,snapshot})=>{
      assert.equal(serviceDate,'2026-09-18'); assert.equal(snapshot.token,7);
      return {status:'GREEN',reasonCode:'FITS_BOTH',customerEmail:'should-not-leak'};
    }, persist: async record => {saved = record;}
  });
  assert.deepEqual(await observer.observe(event), {observed:true,prediction:'GREEN'});
  assert.deepEqual(Object.keys(saved).sort(), ['requestedMinute','decidedMinute','decisionAt','evidenceBasis','authoritative','authoritativeOutcome','eventKey','modelVersion','prediction','reasonCode','schemaVersion','serviceDate'].sort());
  assert.equal(saved.authoritative,false);
  assert.equal(saved.reasonCode,'FITS_BOTH');
});

test('assessment exception records uncertainty, never changes booking outcome', async () => {
  let saved;
  const observer = createLiveShadowObserver({enabled:true,
    assess:()=>{throw new Error('customer sensitive information');},
    persist:record=>{saved=record;}
  });
  assert.deepEqual(await observer.observe(event),{observed:true,prediction:'UNVERIFIED'});
  assert.equal(saved.reasonCode,'ASSESSMENT_ERROR');
  assert.equal(JSON.stringify(saved).includes('sensitive'),false);
});

test('persistence failure is isolated', async () => {
  const observer = createLiveShadowObserver({enabled:true,assess:()=>({status:'AMBER',reasonCode:'MANUAL_REVIEW'}),persist:()=>{throw Error('database down');}});
  assert.deepEqual(await observer.observe(event),{observed:false,reason:'PERSIST_FAILED'});
});

test('invalid event is fail-open and does not call persistence', async () => {
  let saved=false;
  const observer=createLiveShadowObserver({enabled:true,assess:()=>({status:'GREEN'}),persist:()=>{saved=true;}});
  assert.deepEqual(await observer.observe({...event,serviceDate:'2026-02-30'}),{observed:false,reason:'INVALID_EVENT'});
  assert.equal(saved,false);
});

test('invalid assessment and unsafe reason become safe unverified record', async () => {
  let saved;
  const observer=createLiveShadowObserver({enabled:true,assess:()=>({status:'REJECT',reasonCode:'customer@address.com'}),persist:r=>{saved=r;}});
  await observer.observe(event);
  assert.equal(saved.prediction,'UNVERIFIED');
  assert.equal(saved.reasonCode,'INVALID_ASSESSMENT');
});

test('strict date parser rejects malformed and impossible dates', () => {
  assert.equal(validServiceDate('2026-09-18'),true);
  assert.equal(validServiceDate('2026-02-29'),false);
  assert.equal(validServiceDate('2024-02-29'),true);
  assert.equal(validServiceDate('2026-13-01'),false);
});
