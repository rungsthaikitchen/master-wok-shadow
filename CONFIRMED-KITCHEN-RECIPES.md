# Kitchen recipe facts — 1 November 2026

Source: David's kitchen timings/capacities supplied in this development session.
Batch quantities map to menu servings; they are not counts of individual cakes or
prawns within a serving. No production booking authority is implied by these facts.

| Recipe | Method/resource | Minutes | Small fryer basket | Large fryer basket | Other capacity |
| --- | --- | ---: | ---: | ---: | --- |
| Fish cakes | Deep fry | 3 | 3 batches | 6 batches | |
| Fried prawns | Deep fry | 2 | 3 batches | 6 batches | |
| Pork dumplings | Microwave | 5 | | | 1 batch per run |
| Thai sausage | Deep fry (confirmed) | 3 | 5 batches | 10 batches | |
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

Verification: 212 JavaScript tests pass in UTC and Europe/London; 42 private
PostgreSQL scenario groups pass. New cases use actual server prices and a mixed
basket with starters, main and extra egg, complete persistence, reconnect, started
microwave cancellation protection and rollback after plan persistence. Evidence:
STAGING-CONFIRMED-RECIPES-RESULT.json. Fixtures removed; handler disabled with JWT
restored. Production remains unchanged and legacy authoritative.

Thai sausage deep frying was subsequently confirmed by David in the same session.
It now shares fryer baskets with the other recipes using its own 5/10 batch limits.

Further launch facts confirmed by David, 1 November:

- Jasmine/sticky rice may be freshly available or reheated to order for 2m30.
  Always reserve one microwave cycle per serving; round to 3 minutes on the
  scheduler's integer-minute grid. Fresh availability needs no staff toggle.
- Prawn crackers are prepared before service. No per-order cooking job is needed;
  ordinary customer lead-time, hours and blackout rules still apply.
- Existing satay/moo-ping finishing is one minute per serving, conservatively
  serialized on the same chef/wok timeline as mains and eggs.
- Existing egg/coconut rice one-minute preheat is a predecessor of its exact wok
  batch. Starting preheat freezes that batch, including across reconnects.
- Busy adds 15 minutes and Very Busy adds 30 minutes to normal whole-basket lead
  time, with cooking durations and kitchen capacity unchanged. Existing stored
  mode/throttle values remain compatible; pause and expiry still work.

Latest verification: all 44 current priced menu items individually commit full
orders in private staging. Mixed rice/starter work, preheat dependency restart and
Busy/Very Busy hint/checkout consistency also pass. 219 JavaScript tests in both
timezones and 53 joined PostgreSQL scenario groups pass. See
STAGING-FULL-MENU-RESULT.json. These checks do not enable production bookings.
