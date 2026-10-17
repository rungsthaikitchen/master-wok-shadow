BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object('cases',COALESCE(jsonb_agg(jsonb_build_object(
 'caseKey',c.case_key,'expectedPrediction',c.expected_prediction,'expectedKind',c.expected_kind,
 'source',jsonb_build_object('projectRef','hvrqgufqjslvgiohgkvu','dataOrigin','SYNTHETIC_STAGING',
 'basis','ATOMIC_STAGING_FIXTURE_QUERY','complete',true,'serviceDate',c.service_date::text,'assessedAt',c.assessed_at,
 'expectedOrders',c.expected_orders,'expectedItems',c.expected_items,'candidateIds',c.candidate_ids,
 'existingPlan',c.planning_evidence->'existingPlan','legs',c.planning_evidence->'legs',
 'maxEstimateAgeMinutes',c.planning_evidence->'maxEstimateAgeMinutes',
 'orders',(SELECT COALESCE(jsonb_agg(jsonb_build_object('orderId',a.value,'created_at',o.created_at,
  'preferred_time',o.preferred_time,'proposed_time',o.proposed_time,'confirmed_time',o.confirmed_time,
  'status',o.status,'is_test',o.is_test,'order_type',o.order_type,'delivery_fee',o.delivery_fee) ORDER BY a.value),'[]'::jsonb)
  FROM jsonb_each_text(c.order_aliases) a JOIN public.orders o ON o.id=a.key::uuid WHERE o.is_test IS TRUE),
 'items',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i.id,'orderId',a.value,'item_id',i.item_id,
  'qty',i.qty,'modifiers',i.modifiers) ORDER BY i.id),'[]'::jsonb)
  FROM jsonb_each_text(c.order_aliases) a JOIN public.orders o ON o.id=a.key::uuid AND o.is_test IS TRUE
  JOIN public.order_items i ON i.order_id=o.id)
 )) ORDER BY c.case_key),'[]'::jsonb)) AS staging_source
FROM master_wok_delivery_test.cases c WHERE c.data_origin='SYNTHETIC_STAGING';
COMMIT;
