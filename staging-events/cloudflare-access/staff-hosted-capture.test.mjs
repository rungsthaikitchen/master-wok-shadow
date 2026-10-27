import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{replay}=require('../../master-wok-chronological-replay.js');
const data=JSON.parse(fs.readFileSync(new URL('../../fixtures/staff-command-hosted-capture-27-oct.json',import.meta.url),'utf8'));
test('actual hosted staff exports replay eleven suggestions with five remaining hypothetical commitments',()=>{
 let events=0,decisions=0,holds=0,audits=0;
 for(const c of data.verification.cases){
  const r=replay(c.batch,{enabled:true});assert.equal(r.status,'REPLAYED');assert.equal(r.verified,false);assert.equal(r.networkRequests,0);assert.equal(r.remainingCommitments,c.holds);
  for(const o of r.observations){assert.equal(o.actualDecision,'SUGGESTED');assert.equal(o.verified,false);}
  events+=c.eventCount;decisions+=r.decisionCount;holds+=r.remainingCommitments;audits+=c.auditRows;
 }
 assert.deepEqual({events,decisions,holds,audits},{events:18,decisions:11,holds:5,audits:6});
});
test('audit denial produced no decision/event; cancelled HTTP booking retains no capacity',()=>{
 const audit=data.verification.cases.find(c=>c.name==='audit'),http=data.verification.cases.find(c=>c.name==='http');
 assert.equal(audit.eventCount,2);assert.equal(audit.auditRows,0);assert.equal(audit.currentProposal,'staff-seed-offer');
 assert.equal(http.status,'cancelled');assert.equal(http.holds,0);assert.equal(http.batch.events.at(-1).kind,'RESERVATION_RELEASED');
});
