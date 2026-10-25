const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {database}=require('./command-route-test-helper.cjs');
test('restricted rehearsal fixtures are complete, privately quoted and disabled by default',async()=>{
 const d=await database();
 try{
  for(const file of ['checkout-submission-candidate.sql','checkout-submission-runtime-role.sql','checkout-submission-trial-fixtures.sql'])await d.db.exec(fs.readFileSync(path.join(__dirname,file),'utf8'));
  assert.equal(await d.scalar('SELECT count(*)::integer FROM master_wok_event_test.checkout_quotes'),6);
  assert.equal(await d.scalar('SELECT count(*)::integer FROM master_wok_event_test.command_routes'),5);
  assert.equal(await d.scalar('SELECT count(*)::integer FROM master_wok_event_test.streams WHERE enabled'),0);
  assert.equal(await d.scalar('SELECT count(*)::integer FROM master_wok_event_test.checkout_submissions'),0);
  assert.equal(await d.scalar("SELECT has_table_privilege('master_wok_event_writer_login','master_wok_event_test.checkout_quotes','INSERT,UPDATE,DELETE')"),false);
  assert.equal(await d.scalar("SELECT has_table_privilege('master_wok_event_writer_login','master_wok_event_test.checkout_submissions','UPDATE,DELETE')"),false);
  assert.equal(await d.scalar("SELECT has_function_privilege('master_wok_event_writer_login','master_wok_event_test.submit_checkout(uuid,text,uuid,uuid,jsonb)','EXECUTE')"),true);
 }finally{await d.db.close();}
});
