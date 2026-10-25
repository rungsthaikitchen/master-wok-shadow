# Offline writer source review

This folder is review tooling only. Nothing in the application runtime imports it. It makes no network calls and never runs supplied page code as a page.

Install exact locked dependencies with `npm ci --ignore-scripts`; run `npm test`. Pass locally obtained HTML or JavaScript module paths to `node audit.cjs ...` to produce a hashes-and-syntax inventory. Do not commit whole downloaded sources or credentials. CLI parse failures exit nonzero without dumping source text.

HTML5 parsing excludes commented/inert script markup. Acorn distinguishes actual calls from strings/comments. The inventory recognizes simple literal table chains and lists unresolved mutation-like calls for manual review. It is not a complete static-analysis proof, traffic report, RLS audit or guarantee of served-page reachability. The current-source tests execute only the credential-free extracted functions with synthetic objects and mocked DOM/database bindings.
