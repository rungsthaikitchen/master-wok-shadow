# Production flow review — 15 October 2026

Source: supplied index(2).html, admin(2).html, server.py, notifications.py and five Edge-function files. File hashes are recorded in INPUT-SOURCE-HASHES.json. Files were inspected statically; no application was imported with production credentials or run against live services.

## Observed paths

| Operation | Supplied source path | Shadow implication |
|---|---|---|
| Initial customer order | index HTML upserts `orders` on idempotency_key, then separately inserts `order_items` | Order header can exist before its lines. A Railway response is not the initial commit. |
| New-order notification | Checkout calls Railway `/send-order-confirmation` after saving items | This endpoint handles notifications and loyalty; it is not an authoritative booking acceptance event. |
| Admin accept/decline/suggest | admin HTML calls same-origin `/admin-api/order-action`; Railway `/admin-order-action` forwards to configured Edge URL (default hyper-worker); uploaded order-action header identifies it as hyper-worker | Intended proxy chain is visible, but the same-origin proxy source and deployed Railway URL override were not supplied. |
| Edge admin decision | hyper-worker builds a status/time update, then checks the `orders.update` result before returning success | Successful persisted update is the relevant decision boundary; notification success is separate. |
| Other admin status changes | admin HTML `updateOrderStatus` writes directly to Supabase | A Railway-only hook cannot observe every status transition. |
| Customer suggested-time response | notifications.py builds Railway accept/decline links; server.py directly patches order status/time on those routes | Account for this path independently of the empty order-confirm Edge function. The Edge-generated order-confirm.html links are a separate path whose deployed page was not supplied. |
| Alternative review flow | review-order writes `review_status` and payment-link fields and sends messages | No caller was found in the supplied pages. Do not assume it is active. The new collector does not request review_status, so this alternate flow needs mapping if used. |
| Geocoding/route quote | Other supplied functions handle location/route work | No changes needed for capacity shadow monitoring. |

The late second checkout implementation in index HTML is inside an HTML-commented script block; it is not counted as a second active creation flow.

The supplied index also contains experimental planning functions and external Master Wok script references. Its browser observer is explicitly `MASTER_WOK_SHADOW_ENABLED = false`. Leave it off. The new independent collector does not require replacing index/admin or enabling this browser observer.

## Consequences

A single hook on a Railway notification endpoint would give incomplete and potentially misleading coverage. A durable exact decision stream would need to cover browser writes, Edge decisions, direct admin changes and customer responses, including ordered revisions and cancellations. No such stream is proven by these files.

The added independent collector reads visible saved states through GET-only REST requests and writes only its own SQLite database. It offers persistent polling diagnostics without changes to customer pages, admin handlers, notification code or production Supabase. This is the simplest isolated monitoring step supported by the supplied code. It cannot prove which transitions happened between polls, establish transaction snapshot consistency or reconstruct past decision-time state.

## Existing code findings relevant to later integration

These are review findings, not fixes applied to the production source:

- hyper-worker's accept case changes status but does not set confirmed_time. Treat its preferred/proposed time fallback as an inferred effective time, not an explicit confirmation timestamp.
- hyper-worker's `mark_paid` case falls through into `complete` and overwrites the update. Never derive a distinct payment/booking decision from a guessed action name; inspect persisted state. This pre-existing issue should be handled separately before relying on precise action semantics.
- review-order decline does not check its update result before returning success; its SELECT omits proposed_time despite using it as an accept fallback. Do not use it as an integration point without resolving actual usage and persistence semantics.
- Railway's customer acceptance updater catches a write failure without propagating success/failure to the page. The collector does not rely on that page's success text as evidence of a committed response.

The supplied production files are unchanged. No proxy, Supabase function, browser or notification patches are included in this update.
