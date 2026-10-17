'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {compareBatch}=require('./staging-delivery/compare_batch');
const {makeCases}=require('./staging-delivery/test_cases');
test('staging batch runs all six expected scenarios and emits only comparisons',()=>{
 const r=compareBatch({cases:makeCases()});
 assert.equal(r.caseKeys.length,6);assert.equal(r.records.length,12);
 assert.ok(r.records.every(x=>x.verified===false));
});
test('batch rejects missing, duplicated, excessive and production sources',()=>{
 for(const input of [null,{cases:[]},{cases:Array(51).fill(makeCases()[0])},
   {cases:[makeCases()[0],makeCases()[0]]}])assert.throws(()=>compareBatch(input));
 const cases=makeCases();cases[0].source.projectRef='ubyjrrsvbbqomitpaidb';
 assert.throws(()=>compareBatch({cases}),/SYNTHETIC_STAGING_REQUIRED/);
});
test('expected-outcome mismatch and duplicate candidate cannot report healthy rehearsal',()=>{
 let cases=makeCases();cases[0].expectedKind='SEPARATE';
 assert.throws(()=>compareBatch({cases}),/REHEARSAL_REGRESSION/);
 cases=makeCases();cases[0].source.candidateIds=['A','A'];
 assert.throws(()=>compareBatch({cases}),/INVALID_CASE/);
});

test('a missing registered fixture cannot silently shrink the rehearsal',()=>{
 assert.throws(()=>compareBatch({cases:makeCases().slice(1)}),/INCOMPLETE_REHEARSAL/);
});
