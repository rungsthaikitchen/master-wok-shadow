// Real Chromium, actual HTTP routes, synthetic Access gateway and embedded SQL.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http');
const {pathToFileURL}=require('node:url'),{randomUUID,randomBytes}=require('node:crypto');
const {chromium}=require('playwright'),{database}=require('../command-route-test-helper.cjs');
(async()=>{
 const {generateKeyPair,exportJWK,SignJWT}=await import(pathToFileURL(__dirname+'/node_modules/jose/dist/webapi/index.js').href);
 const {createStagingBrowserApi}=await import(pathToFileURL(__dirname+'/staff-browser-api.mjs').href);
 const {createSyntheticStaffReceiver}=await import(pathToFileURL(__dirname+'/versioned-staff-command.mjs').href);
 const {createPreviewFixtureApi}=await import(pathToFileURL(__dirname+'/preview-fixture-api.mjs').href);
 const {createPreviewFixtureReceiver}=await import(pathToFileURL(__dirname+'/preview-fixture-protocol.mjs').href);
 const {PREVIEW_ACCESS}=await import(pathToFileURL(__dirname+'/preview-access-profile.mjs').href);
 const preview=process.env.PREVIEW_FIXTURE_ADAPTER==='true',boundOrigin=preview?PREVIEW_ACCESS.requestOrigin:'https://synthetic-admin.invalid';
 const d=await database();let server,browser;
 try{
  await d.db.exec(fs.readFileSync(__dirname+'/../staff-command-candidate.sql','utf8'));let f=await d.fixture();
  const {publicKey,privateKey}=await generateKeyPair('RS256'),key={...await exportJWK(publicKey),kid:'synthetic',alg:'RS256',use:'sig'},aud=preview?PREVIEW_ACCESS.audience:'a'.repeat(64),issuer=preview?PREVIEW_ACCESS.teamDomain:'https://synthetic-team.cloudflareaccess.com';
  const token=await new SignJWT({iss:issuer,aud:[aud],sub:'synthetic-staff',type:'app',iat:900,nbf:900,exp:2000}).setProtectedHeader({alg:'RS256',kid:'synthetic'}).sign(privateKey);
  const hopKey=preview?randomBytes(32).toString('hex'):'synthetic-browser-hop-key-12345',actorKey=preview?randomBytes(32).toString('hex'):'synthetic-browser-actor-key-12345';
  let enabled=false,authenticated=true,loseNext=false,commandRequests=0,applies=0,externalRequests=0;
  const commands=[];
  const state=async orderId=>{
   assert.equal(orderId,f.booking);
   const b=(await d.q("SELECT status,coalesce(proposed_time,confirmed_time,preferred_time) AS target FROM master_wok_event_test.booking_rows WHERE stream_id=$1 AND id=$2",[f.src,f.booking]))[0];
   const revision=await d.scalar("SELECT max(sequence) FROM master_wok_event_test.events WHERE stream_id=$1 AND (payload->>'orderId'='synthetic-route' OR payload->'order'->>'orderId'='synthetic-route')",[f.src]);
   return {orderId,revision,status:b.status,target:new Date(b.target).toISOString().replace('.000Z','Z'),proposalTargets:[f.day+'T19:30:00Z',f.day+'T20:00:00Z']};
  };
  let budget=0;
  function createApi(){
   const scope={fixture:{orderId:f.booking,targets:['19:00','19:30','20:00'].map(t=>f.day+'T'+t+':00Z')},endEpoch:1600};
   const options={enabled:true,audience:aud,hopKey,actorKey,nowSeconds:()=>1000,...(preview?scope:{})};
   const applyCommand=async({actorId,command:c})=>{applies++;return d.call('apply_staff_command',[f.route,c.commandId,actorId,c.orderId,c.expectedRevision,c.action,c.target??null]);};
   const receiver=preview?createPreviewFixtureReceiver({...options,readState:state,applyCommand,takeBudget:async()=>{if(++budget>100)throw Error('LOCAL_BUDGET_LIMIT');}}):createSyntheticStaffReceiver({...options,applyCommand});
   return (preview?createPreviewFixtureApi:createStagingBrowserApi)({...options,fetcher:async url=>{assert.equal(String(url),issuer+'/cdn-cgi/access/certs');return new Response(JSON.stringify({keys:[key]}));},readState:state,sendEnvelope:receiver});
  }
  let api=createApi();
  const disabled=createStagingBrowserApi();let origin;
  server=http.createServer(async(req,res)=>{
   try{
    assert.equal(req.headers.host,new URL(origin).host);
    if(req.url.startsWith('/admin-api/')){
     let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('SIZE');}
     const validOrigin=req.headers.origin===origin;
     const headers={'Content-Type':req.headers['content-type']||'',Origin:validOrigin?boundOrigin:'https://other.invalid'};
     if(authenticated)headers['Cf-Access-Jwt-Assertion']=token;
     if(req.url==='/admin-api/staff-command-v1'){commandRequests++;commands.push(JSON.parse(body));}
     const r=await(enabled?api:disabled)(new Request(boundOrigin+req.url,{method:req.method,headers,body}));
     if(loseNext&&req.url==='/admin-api/staff-command-v1'&&r.status===200){loseNext=false;res.writeHead(502,{'Content-Type':'application/json'});return res.end('{"error":"SYNTHETIC_LOST_APPLICATION_SUCCESS"}');}
     res.writeHead(r.status,Object.fromEntries(r.headers));return res.end(await r.text());
    }
    const files={'/admin-staging/master-wok.html':['admin-staging/master-wok.html','text/html'],'/admin-staging/staff-browser.js':['admin-staging/staff-browser.js','text/javascript'],'/admin-staging/staff-browser.css':['admin-staging/staff-browser.css','text/css']};
    if(!files[req.url]){res.writeHead(404);return res.end();}
    const [file,type]=files[req.url];let body=fs.readFileSync(__dirname+'/browser-preview/'+file,'utf8');if(type==='text/html')body=body.replace(/data-order-id="[^"]+"/,'data-order-id="'+f.booking+'"');
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);
   }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"LOCAL_FIXTURE_FAILED"}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const packaged=process.env.CHROMIUM_MODULE?(await import(pathToFileURL(process.env.CHROMIUM_MODULE).href)).default:null;
  browser=await chromium.launch({headless:true,executablePath:packaged?await packaged.executablePath():chromium.executablePath(),args:packaged?packaged.args.filter(x=>x!=='--disable-web-security'&&x!=='--single-process'&&x!=='--allow-running-insecure-content'&&x!=='--disable-site-isolation-trials'&&!x.startsWith('--disable-features=')):[]});const context=await browser.newContext({timezoneId:'Europe/London'});
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();externalRequests++;return route.abort();});
  const page=await context.newPage();const message=page.locator('#message'),offer=page.getByRole('button',{name:'Offer time',exact:true});
  let lastResponse=null;page.on('response',async r=>{if(r.url().includes('/admin-api/'))try{lastResponse={status:r.status(),body:await r.json()};}catch{}});
  const wait=async text=>{try{await page.waitForFunction(t=>document.getElementById('message').textContent.includes(t),text,{timeout:8000});}catch(e){console.error(JSON.stringify({step:text,message:await message.textContent(),lastResponse}));throw e;}};
  await page.goto(origin+'/admin-staging/master-wok.html');await wait('Staging route is disabled');assert.equal(applies,0);assert.equal(await offer.isDisabled(),true);
  enabled=true;authenticated=false;await page.getByRole('button',{name:'Refresh details'}).click();await wait('Sign in before');assert.equal(applies,0);
  authenticated=true;await page.getByRole('button',{name:'Refresh details'}).click();await wait('Latest order details loaded');
  loseNext=true;await offer.click();await wait('Retry the same saved action');assert.equal(applies,1);const original=commands[0];assert.equal(await d.scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.src]),3);
  await page.reload();await wait('Unfinished test action');assert.equal(applies,1);await page.getByRole('button',{name:'Retry saved action'}).click();await wait('Action saved.');assert.equal(applies,2);assert.deepEqual(commands[1],original);
  await d.call('apply_staff_command',[f.route,randomUUID(),'b'.repeat(64),f.booking,3,'offer',f.day+'T20:00:00Z']);
  await offer.click();await wait('Order changed');assert.equal(await d.scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.src]),4);
  await page.getByRole('button',{name:'Review latest details'}).click();await wait('Choose a new action');await offer.click();await wait('Action saved.');assert.equal(commands.at(-1).expectedRevision,4);assert.notEqual(commands.at(-1).commandId,original.commandId);
  authenticated=false;await page.getByRole('button',{name:'Confirm order',exact:true}).click();await wait('Sign in again');const before=applies;authenticated=true;await page.getByRole('button',{name:'Retry saved action'}).click();await wait('Action saved.');assert.equal(applies,before+1);assert.equal(await page.locator('#status').textContent(),'Confirmed');
  await page.getByRole('button',{name:'Cancel order',exact:true}).click();await wait('Action saved.');assert.equal(await page.locator('#status').textContent(),'Cancelled');assert.equal(await offer.isDisabled(),true);assert.equal(await d.scalar('SELECT count(*)::int FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.src]),0);
  await page.screenshot({path:'/tmp/master-wok-staff-browser.png',fullPage:true});
  f=await d.fixture();api=createApi();const quotaContext=await browser.newContext({timezoneId:'Europe/London'});await quotaContext.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Quota','QuotaExceededError');};});const quota=await quotaContext.newPage();await quota.goto(origin+'/admin-staging/master-wok.html');await quota.waitForFunction(()=>document.getElementById('message').textContent.includes('Ready for a test action'));const requestsBefore=commandRequests;await quota.getByRole('button',{name:'Offer time',exact:true}).click();await quota.waitForFunction(()=>document.getElementById('message').textContent.includes('Stop here'));assert.equal(commandRequests,requestsBefore);assert.equal(await quota.getByRole('button',{name:'Offer time',exact:true}).isDisabled(),true);await quotaContext.close();
  assert.equal(externalRequests,0);console.log(JSON.stringify({status:'PASSED',browser:'Chromium',timezone:'Europe/London',cases:8,adapter:preview?'PINNED_PREVIEW_FIXTURE':'SYNTHETIC_ONLY',lostSuccessRetryPreservedCommand:true,realReload:true,conflictReviewRequired:true,storageFailureMakesNoRequest:true,externalRequests,productionRequests:0,notifications:0,hostedAccessVerified:false}));
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await d.db.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
