// Synthetic-only workerd smoke; optional installed Miniflare 5 tooling. No external fetch.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {Miniflare,convertV4MiniflareOptions,Response}=require(process.env.MINIFLARE_MODULE || 'miniflare');
(async()=>{
const dir=__dirname;
const {generateKeyPair,exportJWK,SignJWT}=await import(dir+'/node_modules/jose/dist/webapi/index.js');
const config=JSON.parse(fs.readFileSync(dir+'/deployment/access-check.js','utf8').match(/var probeConfig = (\{[^;]+\});/)[1]);
const {publicKey,privateKey}=await generateKeyPair('RS256');
const key={...await exportJWK(publicKey),kid:'synthetic',alg:'RS256',use:'sig'};
const now=Math.floor(Date.now()/1000);
const token=await new SignJWT({iss:config.teamDomain,aud:[config.audience],sub:'synthetic-user',type:'app',iat:now-1,nbf:now-1,exp:now+600}).setProtectedHeader({alg:'RS256',kid:'synthetic'}).sign(privateKey);
let calls=0;
const opts=await convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-10-27',script:fs.readFileSync(dir+'/deployment/access-check.js','utf8')+'\nexport default { fetch(request){return onRequest({request});} };',outboundService:async request=>{calls++;assert.equal(request.url,config.teamDomain+'/cdn-cgi/access/certs');assert.equal(request.method,'GET');assert.equal(request.headers.get('Cookie'),null);assert.equal(request.headers.get('Authorization'),null);return new Response(JSON.stringify({keys:[key]}),{status:200});}});
const mf=new Miniflare(opts);
try{const response=await mf.dispatchFetch(config.requestOrigin+'/admin-api/access-check',{headers:{'Cf-Access-Jwt-Assertion':token}});const body=await response.json();assert.equal(body.status,'VERIFIED');assert.equal(calls,1);console.log(JSON.stringify({runtime:'workerd',status:body.status,keyRequests:calls,bookingRequests:0,databaseRequests:0,notifications:0}));}finally{await mf.dispose();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
