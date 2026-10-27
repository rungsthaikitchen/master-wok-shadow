import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('deployment/preview-fixture-plan/',import.meta.url);
test('review package is default off and both bundled routes ignore even throwing env getters',async()=>{
 const m=JSON.parse(fs.readFileSync(new URL('manifest.json',root),'utf8'));assert.deepEqual(m.config,{enabled:false});assert.equal(Object.keys(m.files).length,8);
 for(const [name,hash] of Object.entries(m.files))assert.equal(createHash('sha256').update(fs.readFileSync(new URL(name,root))).digest('hex'),hash);
 const client=fs.readFileSync(new URL('admin-staging/staff-browser.js',root),'utf8');for(const s of ['MASTER_WOK_PREVIEW_HOP_KEY','MASTER_WOK_PREVIEW_ACTOR_KEY','supabase.co','jwtVerify'])assert.equal(client.includes(s),false);
 for(const path of ['functions/admin-api/staff-state-v1.js','functions/admin-api/staff-command-v1.js']){
  const {onRequest}=await import(new URL(path,root));
  for(const method of ['GET','POST','DELETE']){const r=await onRequest({request:new Request('https://preview.invalid/admin-api/test',{method}),get env(){throw Error('SECRETS_READ');}});assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'STAFF_BROWSER_STAGING_DISABLED'});}
 }
});
