# Master Wok shadow integration review

Start with [CURRENT-STATUS.md](CURRENT-STATUS.md) for current status, tests, dependencies and deployment steps. The earlier [REVIEW-AND-DEPLOYMENT.md](REVIEW-AND-DEPLOYMENT.md) documents the exact-event observer contract.

MASTER-WOK-HANDOVER-NOTES.md is the original incoming handover, retained for context; its statements about missing components predate this review. The kit now includes local durable record storage and an injected queue-worker boundary. Backend integration, a durable event source and production deployment remain outstanding. Observer and worker are disabled by default.

Update — 15 October: production sources are now reviewed. Start with [PRODUCTION-FLOW-REVIEW.md](PRODUCTION-FLOW-REVIEW.md) and [railway-shadow/README.md](railway-shadow/README.md) for the new independent GET-only Python collector. It persists observed states and hypothetical model hints; it does not claim exact decision history. Production files remain unchanged.
