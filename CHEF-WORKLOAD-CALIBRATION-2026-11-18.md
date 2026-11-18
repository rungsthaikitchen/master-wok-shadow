# Kitchen confirmation, 18 November 2026

David confirmed with Chef Rung:

- At most two noodle, fried-rice, Dave Style salt-and-pepper chips or chicken-and-chips dishes simultaneously, because of large-wok hob space.
- Four small-wok dishes can run simultaneously: Pad Kra Pao, Black Pepper, Cashew, Sweet and Sour, Dave Style Crispy Chicken.
- A five-minute curry needs approximately three to four minutes of hands-on work.
- Chef Rung performs all the mains and salad work. Do not treat cold preparation as another cook.
- Follow-up: two large woks cannot run with even one small wok. Two curry saucepans can run alongside either two large woks or two small woks. The exact one-large-wok mixed combination has not been confirmed.

## Diagnostic branch changes

`salt-chips` and `salt-chickenchips` now require the two large wok vessels. The starter `salt-chicken` is a different item; its allocation is unchanged pending confirmation.

These facts do not establish the exact curry attention phase positions or the appropriate allowance for mixing active wok work, curries and salad preparation. Do not invent an exact staffing profile from the approximate curry total. Four small woks are explicitly achievable, so a one-active-job limit would contradict the kitchen.

The saved 18 November fixture places `salt-chips` in a small wok. Under the corrected vessel rule, that protected reservation must be reported as invalid rather than silently moved. It is a historical replay fixture, not an active service to repair. A corrected from-scratch replay is needed before evaluating chef work and before qualifying a release. Previously saved plans may need compatibility handling at deployment.

No production deployment or certificate changes are included here.

## Follow-up footprint implementation

The review allocator and independent timeline validator now reject two occupied large woks plus any small wok, including protected reservations. Four small-wok positions are represented separately: using large-wok IDs as substitutes for the third and fourth small wok would incorrectly trigger the footprint restriction. Four total hot vessels remains the overall ring limit, so two large woks plus two pans and two small woks plus two pans remain possible.

One large wok with small woks is not newly restricted because its exact limit has not been confirmed. Replay results using that mixed configuration therefore remain provisional, alongside the unfinished chef-attention model.
