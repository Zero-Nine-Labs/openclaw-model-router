# OpenClaw compatibility

Stock OpenClaw accepts model and provider overrides from `before_model_resolve`, but has no thinking override. This extension adds a transient effort choice to the inspected 2026.9.3 and 2026.9.5 builds. It patches installed runtime JavaScript; it is not part of OpenClaw's public SDK contract.

Supported releases are exact bundle profiles, selected by filename and SHA256. Unknown or mixed builds are refused.

The plugin checks `routingThinkingSupported: true` before routing. Without this marker it leaves the host selection alone. An upgrade that changes the pinned files requires a new compatibility review.

## Runtime contract

The hook event gains `routingThinkingSupported`, `thinkingExplicit`, `modelExplicit`, and `isFallbackRetry`. The hook result gains `thinkingOverride`, accepting `low`, `medium`, `high`, or `max`.

Explicit model choices prevent hook model/provider replacement. Explicit thinking choices prevent hook effort replacement. Existing locked harness sessions still bypass the hook entirely. The plugin additionally checks persisted session selections and explicit directives.

Each run caches its classification. If the host retries with a different provider/model, or marks a fallback retry, the plugin preserves that candidate and applies only the cached effort. It does not repeatedly select the failed provider. This uses the hook's per-attempt context; no shared model configuration or session thinking setting is mutated.

## Supported profiles

| OpenClaw | Runtime files patched |
| --- | ---: |
| 2026.9.3 | 5 |
| 2026.9.5 | 4 |

## Changed files

| Runtime file | Change |
| --- | --- |
| `attempt-execution-crM9pZWL.mjs` | Carries one-turn model and thinking selections, plus the retry marker, into embedded execution. |
| `agent-runner-utils-Bd5FUrZ1.mjs` | Carries channel thinking overrides and available model/retry markers into embedded execution. |
| `embedded-agent-DNQn_PMM.mjs` | Carries markers into model setup and applies validated routed effort to that execution's parameters before model capability clamping. |
| `setup-4a_QaRYo.mjs` | Emits the capability/state markers, validates returned effort, and preserves explicit selections. |
| `hook-runner-global-aekT_Vmt.mjs` | Merges the thinking override alongside model/provider results. |

Exact original and patched SHA256 hashes live in `compat.py`. The patcher refuses unknown content before writing and keeps validated original backups in `.openclaw-compat-backup` under the runtime's `dist` directory. Writes replace individual files atomically and roll back on handled write failures. The writes are not a single filesystem transaction; interruption can leave a mixed state, which `--restore` handles using validated backups.

## Check, apply, and restore

```sh
python3 compat.py --check /opt/homebrew/lib/node_modules/openclaw
python3 compat.py --apply /opt/homebrew/lib/node_modules/openclaw
python3 compat.py --restore /opt/homebrew/lib/node_modules/openclaw
```

Repeated apply/restore calls are idempotent. Restart the gateway after application or restoration. Disable the plugin before restoring the extension when returning to stock behavior.

## Verification

`OPENCLAW_ROUTER_FIXTURES=/path/to/pinned/originals npm run test:compat` checks preflight rejection, patch/restore hashes, repeated operations, mixed-state restoration, and JavaScript syntax for the matching profile. It executes extracted runtime expressions/functions for manual flags, hook precedence, and effort application. `npm test` runs the portable plugin tests, covering fallback candidates and concurrent session isolation. The compatibility command requires the original runtime files listed in `compat.py`; the repository does not include them.

These tests do not substitute for live gateway checks. Acceptance also requires observing actual execution model and reasoning effort, preserving manual model/thinking choices, and confirming gateway health. Public benchmark scores do not verify this runtime integration.

## Optional fallback-notice repair

`fallback-notice-compat.py` has its own single-file profile for OpenClaw 2026.9.3, targeting `agent-runner.runtime-ChH8PGBC.mjs`. It uses the shared patch engine but replaces the profile registry for that invocation, so the 2026.9.5 thinking profile remains unchanged.

When execution explicitly reports no fallback and no failed attempts, the host uses the successfully routed model as the origin of its notice calculation. Genuine failures, persisted automatic fallback origins and native runtime model selection retain their precedence.

Original SHA256: `611f4dea79b1a3908a30de2ae155072e302f995259d13b578752b1b2fab309be`.
Patched SHA256: `5baeeffddbdb8c8d5d0c1f3cab190e98da2e4dcbe7d69865029345242aad5762`.

```sh
python3 fallback-notice-compat.py --check /absolute/path/to/openclaw
python3 fallback-notice-compat.py --apply /absolute/path/to/openclaw
python3 fallback-notice-compat.py --restore /absolute/path/to/openclaw
```

Validated originals are stored separately in `.openclaw-fallback-notice-backup`. This repair is not verified for 2026.9.5; an unrecognized bundle is refused. Restart after applying or restoring it. `OPENCLAW_FALLBACK_FIXTURES=/path/to/originals npm run test:fallback` exercises the pinned file and its extracted notice behavior.
