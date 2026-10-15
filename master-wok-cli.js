#!/usr/bin/env node
'use strict';
// Offline diagnostics only. No credentials, network, database or production access.
const fs = require('node:fs/promises');
const {createReplayAssessment} = require('./master-wok-server-adapter');
const {createRecordStore,summarize} = require('./master-wok-record-store');
const {createLiveShadowObserver} = require('./master-wok-live-shadow');
async function main() {
  const [command,input,directory] = process.argv.slice(2);
  if (command === 'replay' && input && directory) {
    if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Europe/London') throw Error('SERVICE_TIMEZONE_REQUIRED');
    const vm=require('node:vm'); const path=require('node:path');
    const context=vm.createContext({window:{},Date});
    for(const file of ['master-wok-model-bundle.js','master-wok.js','master-wok-shadow.js']) {
      vm.runInContext(await fs.readFile(path.join(__dirname,file),'utf8'),context,{timeout:2000});
    }
    const rows=JSON.parse(await fs.readFile(directory,'utf8'));
    if(!Array.isArray(rows) || rows.length>500) throw Error('INVALID_REPLAY_ROWS');
    context.rows=rows.map(row=>{
      if(!Array.isArray(row.lines) || !row.lines.length || row.lines.length > 100 || row.lines.some(line=>
        !line || !context.window.MasterWokModelV1.hasItem(line.itemId) ||
        !Number.isSafeInteger(line.qty) || line.qty<1 || line.qty>100 ||
        (line.mods!=null && (!Array.isArray(line.mods) || line.mods.length>30)))) throw Error('INVALID_LINES');
      return {orderId:row.orderId,readyMinute:row.readyMinute,placedAt:new Date(row.placedAt),
        classification:context.window.MasterWokModelV1.classifyBasket(row.lines)};
    });
    context.serviceDate=input;
    const result=vm.runInContext('window.MasterWokShadowV1.replayReservationsV1(serviceDate,rows)',context,{timeout:10000});
    console.log(JSON.stringify(result,null,2));
    if(result.observations.length!==rows.length) process.exitCode=1;
  } else if (command === 'summary'  && input) {
    const store=await createRecordStore(input);
    console.log(JSON.stringify(summarize(await store.readAll()),null,2));
  } else if (command === 'observe-fixture' && input && directory) {
    const event=JSON.parse(await fs.readFile(input,'utf8'));
    const store=await createRecordStore(directory);
    const observer=createLiveShadowObserver({enabled:true,assess:createReplayAssessment(),persist:store.persist});
    const result=await observer.observe(event);
    console.log(JSON.stringify(result));
    if (!result.observed) process.exitCode=1;
  } else {
    throw Error('Usage: TZ=Europe/London node master-wok-cli.js observe-fixture event.json /absolute/shadow-volume | summary /absolute/shadow-volume');
  }
}
main().catch(()=>{console.error('MASTER_WOK_OFFLINE_COMMAND_FAILED');process.exitCode=1;});
