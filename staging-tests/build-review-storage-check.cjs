'use strict';
// Emits a synthetic, rollback-only storage test for the isolated staging schema.
const {createBasketReviewStore}=require('../master-wok-basket-review');
const examples=require('./large-basket-examples');
const literal=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
(async()=>{
 const statements=[];
 const save=createBasketReviewStore({schema:'master_wok_rehearsal',pool:{query:async(sql,values)=>{
  statements.push(sql.replace(/\$(\d+)/g,(_,n)=>literal(values[Number(n)-1])));return {rows:[{id:'synthetic',status:'pending'}]};}}});
 const reviews=Object.entries(examples).map(([name,items],i)=>({requestKey:`77777777-7777-4777-8777-${String(i+1).padStart(12,'0')}`,
  customer:{name:'Staging review '+name,phone:'07000000000'},orderType:'collection',preferredTime:'2026-11-12T20:15:00Z',items}));
 for(const review of reviews)await save(review);
 await save(reviews[0]);
 await save({...reviews[0],customer:{...reviews[0].customer,name:'Changed name'}});
 console.log('BEGIN;\nCREATE TEMP TABLE review_test_receipts(id uuid,status text) ON COMMIT DROP;');
 for(const statement of statements)console.log('WITH saved AS ('+statement+') INSERT INTO review_test_receipts SELECT * FROM saved;');
 console.log(`DO $$ BEGIN
 IF (SELECT count(*) FROM review_test_receipts)<>5 THEN RAISE EXCEPTION 'Replay/conflict receipt mismatch'; END IF;
 IF (SELECT count(*) FROM master_wok_rehearsal.master_wok_basket_reviews WHERE request_key::text LIKE '77777777-7777-4777-8777-%')<>4 THEN RAISE EXCEPTION 'Duplicate review created'; END IF;
 IF EXISTS(SELECT 1 FROM master_wok_rehearsal.master_wok_basket_reviews r WHERE request_key::text LIKE '77777777-7777-4777-8777-%'
 AND (SELECT sum((line->>'unit_price')::numeric*(line->>'qty')::numeric) FROM jsonb_array_elements(r.basket) line)<>150) THEN RAISE EXCEPTION 'Basket value changed'; END IF;
 IF has_table_privilege('anon','master_wok_rehearsal.master_wok_basket_reviews','SELECT') OR
 has_table_privilege('authenticated','master_wok_rehearsal.master_wok_basket_reviews','SELECT') THEN RAISE EXCEPTION 'Reviews exposed to public API'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='master_wok_rehearsal.master_wok_basket_reviews'::regclass) THEN RAISE EXCEPTION 'RLS missing'; END IF;
 END $$;
 SELECT 'PASS' AS result,'four £150 baskets, identical replay, changed replay conflict, no public read, RLS' AS checks;
 ROLLBACK;`);
})().catch(error=>{console.error(error);process.exitCode=1;});
