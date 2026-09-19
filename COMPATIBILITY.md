# OpenClaw 2026.9.3 compatibility

Stock OpenClaw accepts model and provider overrides from `before_model_resolve`, but has no thinking override. This extension adds a transient effort choice to the inspected 2026.9.3 build. It patches installed runtime JavaScript; it is not part of OpenClaw's public SDK contract.

The plugin checks `routingThinkingSupported: true` before routing. Without this marker it leaves the host selection alone. An upgrade that changes the pinned files requires a new compatibility review.

## Runtime contract

The hook event gains `routingThinkingSupported`, `thinkingExplicit`, `modelExplicit`, and `isFallbackRetry`. The hook result gains `thinkingOverride`, accepting `low`, `medium`, `high`, or `max`.

Explicit model choices prevent hook model/provider replacement. Explicit thinking choices prevent hook effort replacement. Existing locked harness sessions still bypass the hook entirely. The plugin additionally checks persisted session selections and explicit directives.

Each run caches its classification. If the host retries with a different provider/model, or marks a fallback retry, the plugin preserves that candidate and applies only the cached effort. It does not repeatedly select the failed provider. This uses the hook's per-attempt context; no shared model configuration or session thinking setting is mutated.

## Changed files

| Runtime file | Change |
| --- | --- |
| `attempt-execution-crM9pZWL.mjs` | Carries one-turn model and thinking selections, plus the retry marker, into embedded execution. |
| `agent-runner-utils-Bd5FUrZ1.mjs` | Carries channel thinking overrides and available model/retry markers into embedded execution. |
| `embedded-agent-DNQn_PMM.mjs` | Carries markers into model setup and applies validated routed effort to that execution's parameters before model capability clamping. |
| `setup-4a_QaRYo.mjs` | Emits the capability/state markers, validates returned effort, and preserves explicit selections. |
| `hook-runner-global-aekT_Vmt.mjs` | Merges the thinking override alongside model/provider results. |

Exact original and patched SHA256 hashes live in `compat.py`. The patcher refuses unknown content before writing and keeps validated original backups in `.openclaw-compat-backup` under the runtime's `dist` directory. Writes replace individual files atomically and roll back on handled write failures. The set of five writes is not a single filesystem transaction; interruption can leave a mixed state, which `--restore` handles using validated backups.

## Check, apply, and restore

```sh
python3 compat.py --check /opt/homebrew/lib/node_modules/openclaw
python3 compat.py --apply /opt/homebrew/lib/node_modules/openclaw
python3 compat.py --restore /opt/homebrew/lib/node_modules/openclaw
```

Repeated apply/restore calls are idempotent. Restart the gateway after application or restoration. Disable the plugin before restoring the extension when returning to stock behavior.

## Verification

`OPENCLAW_ROUTER_FIXTURES=/path/to/pinned/originals npm run test:compat` checks preflight rejection, patch/restore hashes, repeated operations, mixed-state restoration, and JavaScript syntax for all five files. It executes extracted runtime expressions/functions for manual flags, hook precedence, and effort application. `npm test` runs the portable plugin tests, covering fallback candidates and concurrent session isolation. The compatibility command requires the five original runtime files listed above; the repository does not include them.

These tests do not substitute for live gateway checks. Acceptance also requires observing actual execution model and reasoning effort, preserving manual model/thinking choices, and confirming gateway health. Public benchmark scores do not verify this runtime integration.
