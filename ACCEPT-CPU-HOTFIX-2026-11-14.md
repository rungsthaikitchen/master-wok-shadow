# Accept CPU hotfix — 14 November 2026

Live RTK-1640 remained pending while repeated Accept attempts hit worker CPU limits. The lifecycle assessor searched for a new kitchen plan despite an unchanged reservation.

Only staff Accept with unchanged commitments, order type, coordinates and test flag can request reuse. The four-ring planner independently validates saved unstarted work against current locked orders, coverage, placement, resource occupancy, blackouts and auxiliary rules. Invalid retained work falls back to the existing full search. Delivery preparation and food age validation remain mandatory. No SQL migration, mode change or direct order edit.

378 core tests pass. Read-only replay of today's exact three-order state validated in 9ms with cooking jobs and delivery trips preserved; no writes or notifications were triggered by replay. Deployed production master-wok-booking runtime 18; fetched source matches tested bundle. Source SHA256 381184be3f48965f07f7b4dc032c8a9ff7932c1ecce6727ffa4ce16347d431e6. Previous runtime17 bundle retained for rollback. User to retry Accept once; actual completion requires database confirmation.
