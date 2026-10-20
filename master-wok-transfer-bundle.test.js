const test=require('node:test'),assert=require('node:assert/strict');
const {compareTransferBundle:compare}=require('./master-wok-transfer-bundle');
const fixture=()=>structuredClone(require('./fixtures/cross-date-bundle-staging-export.json'));
 test('bundle default off; both histories compare only after all receipt/event pairs match',()=>{
  assert.equal(compare(null).status,'DISABLED');const b=fixture(),before=structuredClone(b),r=compare(b,{enabled:true});assert.equal(r.status,'COMPARED');assert.equal(r.transferCount,2);assert.equal(r.results.length,2);assert.ok(r.results.every(x=>x.result.remainingCommitments===0));assert.deepEqual(b,before);assert.equal(r.verified,false);
 });
 test('missing counterpart, receipt, third stream or inconsistent receipt yields no partial results',()=>{
  const changes=[b=>b.transfers.pop(),b=>b.streams.pop(),b=>b.transfers[0].eventAt='2026-10-20T00:00:00Z',b=>b.transfers[0].destinationStream='11111111-1111-1111-1111-111111111111',b=>b.transfers[0].targetAt=b.transfers[0].targetAt.replace('00Z','00.000001Z'),b=>b.transfers.push(structuredClone(b.transfers[0])),b=>b.streams[1].batch.events.pop()];
  for(const change of changes){const b=fixture();change(b);const r=compare(b,{enabled:true});assert.equal(r.status,'UNVERIFIED');assert.deepEqual(r.results,[]);}
 });
 test('validation-only mode does not produce assessments',()=>{
  const r=compare(fixture(),{enabled:true,validateOnly:true});assert.equal(r.status,'VALIDATED');assert.equal(r.results,undefined);
 });

