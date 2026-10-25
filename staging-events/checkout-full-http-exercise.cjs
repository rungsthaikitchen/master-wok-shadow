// Runs only as a child of the isolated staging trial; stdin carries ephemeral auth.
const {FullSubmissionAttempt,QUERY}=require('./checkout-full-persistence-client.cjs');
async function exercise(config){
 const url=new URL(config.url);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||!Number.isFinite(config.deadline)||config.fixtures.length!==2)throw Error('LOOPBACK_TRIAL_REQUIRED');
 let calls=0;
 async function post(body,authorized=true,raw=false){
  if(Date.now()/1000>=config.deadline||++calls>7)throw Error('HTTP_TRIAL_LIMIT');
  const headers={'Content-Type':'application/json'};if(authorized)headers.Authorization='Bearer '+config.operator;
  const r=await fetch(url.origin+'/staging/submit-checkout',{method:'POST',headers,body:raw?body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  return {code:r.status,data:await r.json()};
 }
 const f=config.fixtures[0];const body={requestId:f.request,orderId:f.order,quoteId:f.quote,checkout:f.payload};
 if((await post(body,false)).code!==401||(await post({...body,routeId:f.route})).code!==409||(await post('{"requestId":"a","requestId":"b"}',true,true)).code!==409)throw Error('HTTP_BOUNDARY_REFUSED');
 for(const [i,f]of config.fixtures.entries()){
  const attempt=new FullSubmissionAttempt(f.input);
  async function transport(p){
   if(p.query!==QUERY||p.parameters[0]!==f.route)throw Error('FIXED_QUERY_REQUIRED');
   const [,requestId,orderId,quoteId,checkout]=p.parameters;const r=await post({requestId,orderId,quoteId,checkout});
   if(r.code!==200)throw Error('HTTP_UNCOMMITTED_RESULT');return [{result:r.data.status}];
  }
  if(i===0){
   try{await attempt.submit(transport);throw Error('EXPECTED_HTTP_FAILURE_MISSING');}catch(e){if(e.message!=='FULL_CHECKOUT_SUBMISSION_FAILED')throw e;}
   if((await attempt.submit(transport)).status!=='ALREADY_RECORDED')throw Error('LOST_RESPONSE_RETRY_FAILED');
  }else{
   if((await attempt.submit(transport)).status!=='RECORDED'||(await attempt.submit(transport)).status!=='ALREADY_RECORDED')throw Error('DELIVERY_RETRY_FAILED');
  }
 }
 return {status:'PASSED',httpCalls:calls,lostSuccessResponseRetried:true};
}
module.exports={exercise};
if(require.main===module){
 let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>{data+=x;if(data.length>100000)process.exit(1);});
 process.stdin.on('end',()=>Promise.resolve().then(()=>exercise(JSON.parse(data))).then(x=>process.stdout.write(JSON.stringify(x))).catch(()=>{process.stderr.write('CHECKOUT_HTTP_EXERCISE_FAILED');process.exitCode=1;}));
}
