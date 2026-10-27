import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewFixtureHttp,previewEndpoint} from './preview-fixture-http.mjs';
// Fictional endpoint; no actual request is made to this name.
const endpoint='https://synthetic-fixture.up.railway.app/staging/preview-fixture-v1';
test('preview HTTP defaults disabled and only permits a build-pinned Railway HTTPS path',async()=>{
 await assert.rejects(createPreviewFixtureHttp({get endpoint(){throw Error('read');}})({}),/PREVIEW_TRANSPORT_DISABLED/);
 for(const url of ['http://synthetic.up.railway.app/staging/preview-fixture-v1','https://evil.invalid/staging/preview-fixture-v1',endpoint+'?x=1',endpoint+'#x',endpoint.replace('/staging/preview-fixture-v1','/admin-order-action'),endpoint.replace('https://','https://user:secret@')])assert.throws(()=>previewEndpoint(url));
});
test('signed request makes exactly one fixed hop without cookies, credentials or redirects',async()=>{
 let calls=0;const signed={body:'synthetic',tag:'a'.repeat(64)};
 const h=createPreviewFixtureHttp({enabled:true,endpoint,fetcher:async(url,init)=>{calls++;assert.equal(url,endpoint);assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.deepEqual(Object.keys(init.headers),['Content-Type']);assert.deepEqual(JSON.parse(init.body),signed);return new Response('{"status":"RECORDED","revision":3}',{headers:{'Content-Type':'application/json'}});}});
 assert.deepEqual(await h(signed),{status:'RECORDED',revision:3});assert.equal(calls,1);
});
test('redirect, HTML, timeout, oversize and unknown conflict refuse without retries or private errors',async()=>{
 for(const fetcher of [async()=>new Response('',{status:302,headers:{Location:'https://evil.invalid'}}),async()=>new Response('PRIVATE',{headers:{'Content-Type':'text/html'}}),async()=>new Response('x'.repeat(8193),{headers:{'Content-Type':'application/json'}}),async()=>new Response('{"error":"PRIVATE"}',{status:409,headers:{'Content-Type':'application/json'}}),async()=>{throw Error('timeout');}]){
  let calls=0;const h=createPreviewFixtureHttp({enabled:true,endpoint,fetcher:async(...args)=>{calls++;return fetcher(...args);}});await assert.rejects(h({}));assert.equal(calls,1);
 }
});
test('only known exact conflict body can reach browser error mapping',async()=>{
 const h=createPreviewFixtureHttp({enabled:true,endpoint,fetcher:async()=>new Response('{"error":"STAFF_REVISION_CONFLICT"}',{status:409,headers:{'Content-Type':'application/json'}})});
 await assert.rejects(h({}),/^Error: STAFF_REVISION_CONFLICT$/);
});
