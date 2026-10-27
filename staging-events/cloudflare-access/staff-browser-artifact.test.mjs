import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('browser-preview/',import.meta.url);
test('preview manifest matches exact files; bundled browser contains no server authorization code',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('manifest.json',root),'utf8'));assert.equal(m.enabled,false);assert.equal(Object.keys(m.files).length,8);
 for(const [file,hash] of Object.entries(m.files))assert.equal(createHash('sha256').update(fs.readFileSync(new URL(file,root))).digest('hex'),hash);
 const client=fs.readFileSync(new URL('admin-staging/staff-browser.js',root),'utf8');for(const s of ['hopKey','jwtVerify','Cf-Access-Jwt-Assertion','cloudflareaccess.com','supabase.co'])assert.equal(client.includes(s),false,s);
});
test('both deployed preview API bundles refuse before any transport, for every method',async()=>{
 for(const path of ['functions/admin-api/staff-command-v1.js','functions/admin-api/staff-state-v1.js']){
  const source=fs.readFileSync(new URL(path,root),'utf8');for(const text of ['order-backend-production','ubyjrrsvbbqomitpaidb','RTK_PROXY_SECRET','process.env','context.env'])assert.equal(source.includes(text),false,text);
  const {onRequest}=await import(new URL(path,root));
  for(const method of ['GET','POST','DELETE']){const r=await onRequest({request:new Request('https://preview.invalid/admin-api/test',{method})});assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'STAFF_BROWSER_STAGING_DISABLED'});}
 }
});
