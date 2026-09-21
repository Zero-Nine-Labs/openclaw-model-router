# Verification and limitations

The public repository contains synthetic evaluation cases and generic model references. It does not distribute an operator's production transcripts, routing configuration, account identifiers, host fixtures or production measurements.

## Automated checks

`npm test` exercises the classifier parser and transport, task-based routing, configurable model tiers, manual preferences, concurrent runs, fallback preservation, classifier errors and long-context cases. The classifier transport tests use a local stub; they do not prove access to an external model or account.

The compatibility and fallback-notice suites exercise exact pinned runtime transformations, rejection of mismatched input and restoration. They require original OpenClaw runtime fixtures supplied by the operator. Missing fixtures are errors, not skipped successes. The existing 2026.9.5 thinking-hook profile is preserved; the optional fallback-notice repair is limited to the pinned 2026.9.3 build.

## Classifier evaluation

`evals/cases.json` is a synthetic fixture set for the current JEV schema. Its expected profiles test routing intent, not answer quality. Large `inputTokens` values are routing metadata, not literal long transcripts. Run these cases against your own account with `evals/run.py`; the runner never executes the prompt as an agent task.

`evals/summarize.py` reports classifier costs only when supplied by the classifier. Failed calls can have unknown costs. Execution cost, task success and savings require separate measurements.

## Limits

The strong-reference threshold is empirical. Ambiguous follow-ups can still be misclassified. Continuations of an escalated task retain at least the medium tier until a new task is identified. Model/account availability must be enforced by the host's configured fallback chain; the stock host has no exact-account preselection capability for this local plugin.

Validate the selected model and reasoning effort, fallback behavior and completed task outcome in isolated sessions before using a new configuration. No production accuracy or savings claim is made by these fixtures.
