# OpenClaw model router

Choose a model and reasoning effort for each request. A small classifier assesses the work, then deterministic rules choose Luna, Sol or Astra. The policy aims to reduce unnecessary use of larger models.

This is an experimental, version-specific integration. Routed answers can need correction. These thresholds do not establish a production savings percentage or the best model for every task.

## How it works

1. Luna at low reasoning effort classifies the current request and a bounded excerpt from the previous turn.
2. The plugin validates its JSON assessment of difficulty, ambiguity, urgency, task type and other factors.
3. Rules in [policy.js](policy.js) choose the execution model and effort.
4. OpenClaw executes the request. The plugin records routing metadata, usage and completion events.

| Work | Default route |
| --- | --- |
| Everyday answers, lookups, research and drafting | Luna medium |
| Bounded coding and routine multi-step writes | Luna high |
| Difficult but clear work with explicit permission to wait | Luna can use max effort |
| Harder or ambiguous work, high stakes, large context or repeated failures | Sol, usually medium |
| Very complex coding/debugging with score 9+, or architecture with score 8+ | Astra medium, or low when urgent |
| Attachment passed to the hook | Luna high without text classification |
| Text exceeding 24,000 characters | Sol medium without classification |
| Classifier failure or eight-second timeout | Sol low |

Rules have precedence, so this table is a guide. Model names live in `defaultModels` in `policy.js`; classifier selection lives in [classifier.js](classifier.js). Urgency can change effort or model, but more reasoning on a smaller model is not proven equivalent to a larger one.

Explicit model pins bypass routing. Stored thinking preferences retain the selected effort while allowing model routing. The plugin classifies once per run and preserves OpenClaw's provider fallback candidate. It does not grade the final answer or automatically retry every poor answer. Failure signals and later requests can affect subsequent routing.

The default agent is `main`. Heartbeat, cron and subagent trigger values are excluded. Conversation excerpts are held in bounded process memory with a 30-minute expiry. Router logs omit prompts and responses, but contain usage and identifiers; review your host's other logs separately.

## Compatibility and prerequisites

The original integration was verified against OpenClaw 2026.9.3. It needs Node 22+, Python 3, access to the configured models and the host's direct-completion API. This repository does not supply model access or credentials.

The inspected OpenClaw build lacked a dynamic thinking override. [compat.py](compat.py) patches five exact, hash-pinned runtime files. **Run its check before applying it.** A different build must receive a new compatibility review. Do not bypass hash checks. See [COMPATIBILITY.md](COMPATIBILITY.md) for the contract and rollback.

The default classifier is `openai-api/gpt-5.6-luna`. Match the provider alias in `classifier.js` and the allowed-model configuration to your installation. Also adapt the execution model IDs in `policy.js` to models you can access, then evaluate the resulting policy.

## Install

Clone this repository and run the portable tests. There are no npm dependencies.

```sh
git clone https://github.com/Zero-Nine-Labs/openclaw-model-router.git
cd openclaw-model-router
npm test
python3 compat.py --check /absolute/path/to/openclaw
```

Only if the check recognises your runtime, apply the extension and install the plugin:

```sh
python3 compat.py --apply /absolute/path/to/openclaw
openclaw plugins install --link --force --accept-capabilities /absolute/path/to/openclaw-model-router
```

Enable the plugin and its completion permissions under `plugins.entries["model-router"]` in your OpenClaw configuration:

```json
{
  "enabled": true,
  "hooks": { "allowConversationAccess": true },
  "llm": {
    "allowAgentIdOverride": true,
    "allowModelOverride": true,
    "allowedModels": ["openai-api/gpt-5.6-luna"],
    "allowedCompletionModels": ["openai-api/gpt-5.6-luna"]
  },
  "config": { "agentIds": ["main"] }
}
```

The execution models must also be in your agent's model allowlist. Configure provider fallback through OpenClaw. Validate configuration, restart the gateway and verify model selection, thinking preferences and fallback in isolated sessions with delivery disabled before enabling it for normal work.

Fast mode is a host setting, not enabled by this plugin. Measure latency in your own environment.

## Test and evaluate

```sh
npm test
OPENCLAW_ROUTER_FIXTURES=/path/to/pinned/originals npm run test:compat
```

The first command runs 18 portable policy/plugin tests. The second runs 14 compatibility tests against the five original runtime files identified in `compat.py`. Obtain those files from your matching installation or its validated compatibility backup. They are not distributed here. A missing fixture directory is an error, not a skipped success.

The `evals` directory contains synthetic classifier cases and a runner. Historical expected labels predate the current policy and are preserved for comparison; do not treat them as current acceptance criteria. The medical and production examples are invented classification tests, not personal records or instructions to execute.

For classifier-only testing, temporarily enable `config.enableEval`, restart the gateway and run the following on the host. The RPC requires `operator.admin` and does not execute the case requests.

```sh
python3 evals/run.py --cases evals/cases.json --output results.jsonl --repeats 3 --workers 2
python3 evals/summarize.py results.jsonl --output summary.json
```

Disable `enableEval` and restart afterward. Add separate task-outcome checks: a plausible classification does not prove a useful answer. See [EVIDENCE.md](EVIDENCE.md) for measurements and limitations.

## Disable or restore

Disable the `model-router` plugin entry and restart the gateway to stop routing. To remove the runtime extension, restore the validated originals and restart again:

```sh
python3 compat.py --restore /absolute/path/to/openclaw
```

MIT licensed. The repository excludes credentials, private session logs and runtime fixtures.
