'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const run=args=>spawnSync(process.execPath,[path.join(__dirname,'master-wok-delivery-cli.js'),...args],{encoding:'utf8'});
test('offline runner is disabled without reading the supplied missing file',()=>{
 const r=run(['missing-input.json']);assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).status,'DISABLED');
});
test('offline runner contains file errors without exposing paths or stack traces',()=>{
 const r=run(['--enabled','private-missing-input.json']);assert.equal(r.status,1);
 assert.equal(JSON.parse(r.stdout).reasonCode,'INPUT_FILE_UNVERIFIED');
 assert.equal(r.stderr,'');assert.ok(!r.stdout.includes('private-missing'));
});
test('offline runner reproduces integrated two-delivery fixture',()=>{
 const r=run(['--enabled',path.join(__dirname,'fixtures/delivery/integrated-two-stops-input.json')]);
 assert.equal(r.status,0);const result=JSON.parse(r.stdout);
 assert.equal(result.recommendation.kind,'COMBINED');assert.equal(result.verified,false);
 assert.deepEqual(result.recommendation.deliveries.map(d=>d.foodToDoorMinutes),[20,15]);
});
