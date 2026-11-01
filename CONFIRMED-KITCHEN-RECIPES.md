# Kitchen recipe facts — 1 November 2026

Source: David's kitchen timings/capacities supplied in this development session.
Batch quantities map to menu servings; they are not counts of individual cakes or
prawns within a serving. No production booking authority is implied by these facts.

| Recipe | Method/resource | Minutes | Small fryer basket | Large fryer basket | Other capacity |
| --- | --- | ---: | ---: | ---: | --- |
| Fish cakes | Deep fry | 3 | 3 batches | 6 batches | |
| Fried prawns | Deep fry | 2 | 3 batches | 6 batches | |
| Pork dumplings | Microwave | 5 | | | 1 batch per run |
| Thai sausage | Method not stated; pending confirmation | 3 | 5 batches | 10 batches | Blocked until method confirmed |
| Spare ribs | Microwave | 5 | | | 1 batch per run |
| Fried eggs | Shallow fry, small wok | 2 | | | 2 eggs per wok |

Fish/prawn capacities are recipe-specific. Existing main fryer capacities remain
3 portions in the large basket and 2 per small basket. Different recipes do not
share one frying cycle. Recipe compatibility preserves spice, modifiers and notes.

The model shares one microwave across dumpling/rib cycles. It conservatively puts
egg work on the existing single-wok/chef timeline, including extra eggs on mains;
it does not assume another chef can cook eggs concurrently. Existing provisional
holding/buffer policy remains unchanged and still requires final launch signoff.

Persisted plans now contain auxiliary jobs. Model version v2 can read prior v1
plans. Started microwave/egg work stays fixed on reconnect, cancellation or further
bookings. Starting a main does not erase its outstanding extra-egg work. No chef
start confirmations, screens or additional interactions are introduced.

Verification: 212 JavaScript tests pass in UTC and Europe/London; 41 private
PostgreSQL scenario groups pass. New cases use actual server prices and a mixed
basket with starters, main and extra egg, complete persistence, reconnect, started
microwave cancellation protection and rollback after plan persistence. Evidence:
STAGING-CONFIRMED-RECIPES-RESULT.json. Fixtures removed; handler disabled with JWT
restored. Production remains unchanged and legacy authoritative.
