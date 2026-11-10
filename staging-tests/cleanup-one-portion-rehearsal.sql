-- Run only in rtk-master-wok-staging (hvrqgufqjslvgiohgkvu).
-- Exact generated fixture prefix from the interrupted 8 November rehearsal.
BEGIN;
DELETE FROM master_wok_rehearsal.master_wok_time_responses
WHERE order_id IN (SELECT id FROM master_wok_rehearsal.orders WHERE idempotency_key LIKE 'four-ring-race-30f27a27-b2a2-48a6-80ff-e419a151a78e-%');
DELETE FROM master_wok_rehearsal.master_wok_notification_outbox
WHERE order_id IN (SELECT id FROM master_wok_rehearsal.orders WHERE idempotency_key LIKE 'four-ring-race-30f27a27-b2a2-48a6-80ff-e419a151a78e-%');
DELETE FROM master_wok_rehearsal.master_wok_booking_receipts
WHERE key LIKE 'four-ring-race-30f27a27-b2a2-48a6-80ff-e419a151a78e-%';
DELETE FROM master_wok_rehearsal.master_wok_service_plans p
WHERE service_date='2099-11-11'
AND plan->>'modelVersion'='combined-kitchen-four-ring-staging-v1'
AND NOT EXISTS (
 SELECT 1 FROM jsonb_array_elements(plan->'wok'->'jobs') j
 CROSS JOIN LATERAL jsonb_array_elements_text(j->'orderIds') x(id)
 WHERE NOT EXISTS (SELECT 1 FROM master_wok_rehearsal.orders o
  WHERE o.id::text=split_part(x.id,'@',1)
  AND o.idempotency_key LIKE 'four-ring-race-30f27a27-b2a2-48a6-80ff-e419a151a78e-%')
);
DELETE FROM master_wok_rehearsal.orders
WHERE idempotency_key LIKE 'four-ring-race-30f27a27-b2a2-48a6-80ff-e419a151a78e-%';
COMMIT;
