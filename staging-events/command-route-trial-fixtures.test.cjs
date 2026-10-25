const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {database}=require('./command-route-test-helper.cjs');
test('dedicated route rehearsal fixtures commit disabled and preserve exact booking/offer history',async()=>{
 const {db,q,scalar}=await database();
 try{
  await db.exec(fs.readFileSync(path.join(__dirname,'command-route-trial-fixtures.sql'),'utf8'));
  assert.equal(await scalar('SELECT count(*)::integer FROM master_wok_event_test.command_routes'),4);
  assert.equal(await scalar('SELECT count(*)::integer FROM master_wok_event_test.streams WHERE enabled'),0);
  const rows=await q('SELECT event_count::integer FROM master_wok_event_test.streams ORDER BY event_count');
  assert.deepEqual(rows.map(x=>x.event_count),[0,0,0,0,2,2,2,2]);
  assert.equal(await scalar("SELECT count(*)::integer FROM master_wok_event_test.events WHERE payload->>'kind'='CUTOVER_BASELINE'"),0);
  assert.equal(await scalar("SELECT has_function_privilege('master_wok_event_writer_login','master_wok_event_test.switch_command_route(uuid,integer,uuid,text)','EXECUTE')"),false);
 }finally{await db.close();}
});
