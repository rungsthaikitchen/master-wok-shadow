#!/usr/bin/env node
'use strict';
// Offline JSON fixture runner. Disabled by default; no transport is installed.
const fs=require('node:fs');
const {assessDeliverySnapshot}=require('./master-wok-delivery-assessment');
const args=process.argv.slice(2);
if(!args.includes('--enabled')) {
 console.log(JSON.stringify({status:'DISABLED',verified:false}));
} else if(args.length!==2||args[0]!=='--enabled') {
 console.log(JSON.stringify({status:'UNVERIFIED',reasonCode:'INVALID_CLI_ARGUMENTS',verified:false}));
 process.exitCode=1;
} else {
 try {
  const fd=fs.openSync(args[1],'r');let bytes;
  try {
   if(!fs.fstatSync(fd).isFile())throw Error();
   // Bounded read also handles files that grow after stat.
   const buffer=Buffer.alloc(1000001),size=fs.readSync(fd,buffer,0,buffer.length,null);
   if(size>1000000)throw Error();bytes=buffer.subarray(0,size).toString('utf8');
  } finally {fs.closeSync(fd);}
  const result=assessDeliverySnapshot(JSON.parse(bytes),{enabled:true});
  console.log(JSON.stringify(result,null,2));
  if(result.status!=='SHADOW_RECOMMENDATION')process.exitCode=1;
 } catch(_) {
  console.log(JSON.stringify({status:'UNVERIFIED',reasonCode:'INPUT_FILE_UNVERIFIED',verified:false}));
  process.exitCode=1;
 }
}
