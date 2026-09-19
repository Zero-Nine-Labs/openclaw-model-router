# Evaluation and limits

Runtime policy version 0.1.8. Classifier measurements describe routing behaviour, not answer quality or billed savings.

## Synthetic classifier experiment

The 12-case sample in `evals/api-low-normal.jsonl` produced 12 valid assessments and 11 matches to its expected routes. The recorded nearest-rank p50 was 1,878 ms; the arithmetic median was 1,930 ms and the maximum was 4,034 ms. `evals/api-low-normal-summary.json` preserves the remaining mismatch.

The inputs are synthetic test cases. This experiment predates the latest policy restrictions on Astra, so it is historical evidence rather than an accuracy score for version 0.1.8. Results from an earlier configuration with an incorrect effort mapping are excluded.

These measurements do not establish performance on other providers or workloads. Classifier-only tests do not execute the requested tasks or evaluate their final answers.

## Cost and quality

Execution dollar costs are not reported to the plugin hook. Classifier cost metadata is also unavailable in this sample. Null or zero pricing metadata must not be reported as free usage.

No measured production savings percentage is claimed. A useful comparison must include classification, execution, retries, external tools and the effort needed to correct bad answers. Subscription usage and per-token API billing are different accounting systems.

The router does not automatically evaluate answer quality. A poor result can come from classification, model capability, missing context or tool behaviour. Evaluate completed tasks separately from routing-label accuracy.

## Verification

The release passed 18 portable tests and 14 compatibility tests. Compatibility tests require the five validated original runtime files identified in `compat.py`, supplied outside this repository.

Portable tests cover routing policy, model overrides, thinking preferences, classifier errors and fallback behaviour. Compatibility tests exercise patching and restoration against the pinned runtime. These checks do not replace isolated integration tests against your own OpenClaw installation.
