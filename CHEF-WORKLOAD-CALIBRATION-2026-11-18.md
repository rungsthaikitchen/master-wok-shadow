# Kitchen confirmation, 18 November 2026

## Final confirmed hob inventory and combinations

- Two small woks and two large woks physically available; five curry pans, four hob rings.
- Small-wok dishes can also cook in a large wok. Maximum concurrent small-wok dishes is three: two small woks plus one large. This supersedes the earlier four-small-wok interpretation.
- One large wok plus two small woks fits. Two large woks exclude every small wok.
- Two curry pans can run alongside either two large or two small woks.
- Noodles, fried rice, Dave Style chips and chicken-and-chips require large woks.
- Confirmed small-wok dishes: Pad Kra Pao, Black Pepper, Cashew, Sweet and Sour, Dave Style Crispy Chicken.
- A five-minute curry needs approximately three to four minutes of hands-on work.
- Chef Rung performs all mains and salad work. Cold preparation is not another cook.

## Review implementation and limits

The allocator uses the real two-small/two-large inventory. The footprint rule rejects two large plus any small wok in both allocation and independent validation, including protected work. Four hot vessels remains the overall ring limit. Dave Style chips and chicken-and-chips cannot use small woks; the salt-chicken starter remains separately classified.

Thirty-four focused tests pass. The corrected offline replay rebuilds the historical collection baseline, then adds the matching delivery basket at 19:50, 20:00, 20:10 and 20:20, with fixed eight-minute routing. Equipment fits all four candidates. Holding warnings are absent at 19:50 and 26, 36, 41 minutes for the later candidates respectively. These are provisional physical-fit results, not validated chef workload or an exact live route replay.

The original saved fixture contains now-invalid small-wok assignments for chips. It must not be silently rewritten as if historically valid. Production saved-plan compatibility and release qualification still need review.

Exact curry hands-on phase positions and mixed attention capacity remain uncalibrated. Approximate hands-on totals do not establish minute-by-minute staffing availability. No production deployment or certificate changes are included here.

Earlier evidence files retain the prior assumptions for comparison. chef-attention-final-inventory-20261118.json is the current replay evidence.

## Chef workload review

The offline review assigns salad and hot work to Rung and identifies their overlapping intervals. For five-minute curry jobs it records the reported three-to-four-minute hands-on estimate over the whole cook, without inventing exact phases or summing overlapping estimates as necessarily independent work. The estimate is not extrapolated to other cooking durations. No booking approval or rejection is derived.

The 20:00 and 20:10 candidate replays overlap two curries, two wok dishes and a beef salad at 19:36–19:41. Clarification is needed on shared hands-on work across two curry pans before turning this observation into a staffing constraint. Thirty-eight focused tests pass. Evidence: chef-workload-review-20261118.json.
