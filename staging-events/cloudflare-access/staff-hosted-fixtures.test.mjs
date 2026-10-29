import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{database}=require('../command-route-test-helper.cjs');
test('hosted fixture seed and temporary ACL scripts apply cleanly; cleanup disables only those streams',async()=>{
 const d=await database();try{
  const read=n=>fs.readFileSync(new URL('../'+n,import.meta.url),'utf8');
  // Exercise the historical seed/ACL structure on a future local service day.
  // Retain the committed hosted fixture and its expiry unchanged.
  const day=await d.scalar("SELECT ((clock_timestamp() AT TIME ZONE 'Europe/London')::date+1)::text");
  await d.db.exec(read('staff-command-candidate.sql'));await d.db.exec(read('staff-command-trial-fixtures.sql').replaceAll('2026-10-28',day));await d.db.exec(read('staff-command-trial-role.sql'));
  const f=JSON.parse(fs.readFileSync(new URL('../../fixtures/staff-command-trial-27-oct-v1.json',import.meta.url),'utf8')).map(row=>({...row,day}));
  assert.equal(await d.scalar('SELECT count(*)::int FROM master_wok_event_test.streams WHERE enabled'),6);
  assert.equal(await d.scalar('SELECT count(*)::int FROM master_wok_event_test.events'),12);
  assert.equal(await d.scalar('SELECT count(*)::int FROM master_wok_event_test.reservations'),6);
  const a=f[0];assert.deepEqual(await d.call('apply_staff_command',[a.route,a.command,'a'.repeat(64),a.order,2,'offer',a.day+'T19:30:00Z']),{status:'RECORDED',revision:3});
  await d.db.exec(read('staff-command-trial-cleanup.sql'));
  assert.equal(await d.scalar('SELECT count(*)::int FROM master_wok_event_test.streams WHERE enabled'),0);
  assert.equal(await d.scalar("SELECT has_function_privilege('master_wok_event_writer_login','master_wok_event_test.apply_staff_command(uuid,uuid,text,uuid,integer,text,timestamptz)','EXECUTE')"),false);
 }finally{await d.db.close();}
});
