# Evaluation and limits

Version `0.2.4-jev-experimental` merges the deployed JEV runtime and task-context policy into the shared repository while retaining its 2026.9.5 compatibility profile. The core `index.js`, `jev.js`, `decision.js` and `evaluate.js` match the verified deployed 0.2.3 implementation. Package metadata, documentation and the separate notice patch's profile registration differ.

## Current evidence

- 25 portable tests pass, including typed JEV response validation, malformed output, timeouts, unresolved references, manual selections, concurrent sessions, fallback candidates and simple/complex/distant-context routing with 180,000-token metadata.
- 14 thinking-extension tests and 19 fallback-notice tests pass against pinned original OpenClaw 2026.9.3 fixtures. They exercise patch/restore, hash rejection, explicit choices, routed effort and true versus false fallback notices. Fixtures are not distributed.
- The retained OpenClaw 2026.9.5 thinking profile was contributed before this merge. It has not been revalidated against 2026.9.5 fixtures here. The optional fallback-notice repair supports only its pinned 2026.9.3 bundle.
- A frozen live JEV test of eight synthetic cases, repeated three times, matched all 24 expected route labels with no classifier errors. Mean latency was 402 ms. Simple requests stayed on Luna; distant-history and dispersed-document tasks triggered context escalation.
- A separate alternating old/new classifier check found one timeout in 24 calls with the old rubric and none in 24 with the revised rubric. Mean latency was 686 ms and 461 ms respectively. Small, correlated samples cannot establish future reliability.
- Seven isolated deployed gateway checks all completed without tools or channel delivery. Four selected Luna and three Sol. One classifier timeout correctly used Sol low; a subsequent arithmetic check recovered to Luna. The verifier retained the original expected-model failure.

Those gateway checks seeded session context metadata to 180,000 through the public session API. Classification, routing and model execution were real, but they were not literal 180k-token transcripts. The runtime was healthy with matching installed hashes and no plugin errors.

## Production comparison

The earlier 24-route audit contained 12 Luna and 12 Sol selections, with no classifier errors. Five low-complexity Sol decisions had an ordinary guard and escalated solely on conversation length. Replaying those individual decisions under the revised policy gives 17 Luna and 7 Sol; that is counterfactual, not observed savings. Historical continuation state was not invented.

At the recorded follow-up, one organic production turn selected Luna and completed without classifier error. More production traffic is needed to compare a representative post-change cohort. Private transcripts, session identifiers and raw production logs are not published here.

## Historical Luna evidence

`evals/legacy/api-low-normal.jsonl` contains the earlier synthetic 12-call Luna-classifier sample: 12 valid assessments and 11 expected-route matches, nearest-rank p50 1,878 ms and maximum 4,034 ms. It predates JEV and later policy changes; it is not a current accuracy score.

## Remaining limitations

Routing labels do not establish answer quality, model optimality or billed savings. Classifier cost is reported when available; execution dollar cost is not supplied by the hook. Failed calls may have unknown cost. Subscription usage and per-token API billing are different measures.

The strong-reference threshold is empirical. Ambiguous follow-ups can still be misclassified. A continuation of an already escalated task retains Sol even when its current score is low.

Exact-account availability preflight is not implemented. The optional notice repair corrects bookkeeping after successful routing; it does not make unavailable models callable. Host API and failure-observation work remains separate and must preserve account identity, cooldown expiry, native runtime observations and fallback behavior.
