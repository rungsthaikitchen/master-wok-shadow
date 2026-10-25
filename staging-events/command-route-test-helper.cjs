const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
async function database(){
 const db=new PGlite();
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE master_wok_event_reader_login; CREATE ROLE master_wok_event_writer_login;');
 for(const file of ['schema.sql','booking-store.sql','delivery-booking-store.sql','cutover-record-export.sql','cutover-baseline-snapshot.sql','cutover-baseline-store.sql','cutover-response-candidate.sql','cutover-response-runtime-role.sql','command-route-candidate.sql','command-route-runtime-role.sql']) await db.exec(fs.readFileSync(path.join(__dirname,file),'utf8'));
 const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
 const scalar=async(sql,args=[])=>Object.values((await q(sql,args))[0])[0];
 const call=(name,args)=>scalar(`SELECT master_wok_event_test.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
 async function fixture(empty=false){
  const f=(await q("SELECT gen_random_uuid()::text AS route,gen_random_uuid()::text AS src,gen_random_uuid()::text AS dst,gen_random_uuid()::text AS booking,((clock_timestamp() AT TIME ZONE 'Europe/London')::date+1)::text AS day"))[0];
  await q('INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES($1,$3,true),($2,$3,true)',[f.src,f.dst,f.day]);
  await q('INSERT INTO master_wok_event_test.command_routes(id,service_date,current_stream) VALUES($1,$2,$3)',[f.route,f.day,f.src]);
  f.lines=[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}]}];
  if(!empty){
   await call('routed_create_booking',[f.route,'create',f.booking,'synthetic-route',f.day+'T18:00:00Z',f.lines]);
   await call('routed_apply_booking',[f.route,'offer-a','synthetic-route','offer',f.day+'T19:00:00Z',null,null]);
  }
  return f;
 }
 return {db,q,scalar,call,fixture};
}
module.exports={database};
