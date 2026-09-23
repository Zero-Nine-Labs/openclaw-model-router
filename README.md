# OpenClaw model router

Choose an execution model and reasoning effort for each request. JEV 1.13 classifies the current task through OpenRouter's Decisions API; deterministic rules choose a small, medium or large model tier. You configure the provider/model reference for each tier. This public distribution uses synthetic examples and contains no operator-specific routing defaults.

This is experimental. Classification can be wrong, and route-label agreement does not prove answer quality or production savings. The GPT-6 example below has not been remeasured against the historical evaluations. See [EVIDENCE.md](EVIDENCE.md).

## How it works

[jev.js](jev.js) validates typed decisions for complexity, clarity, reference resolution, work family, escalation conditions, urgency, explicit timing and continuation. Complexity is an ordinal score from 0 to 100, not a probability of success. Strong unresolved-reference evidence can override a clear assessment at a native score of 0.95; that threshold is empirical, not calibrated confidence.

[decision.js](decision.js) applies these rules:

| Work | Default route |
| --- | --- |
| Clear simple work, complexity up to 30 | small model medium |
| Routine work up to 60 | small model high |
| General work up to 85, unless urgent | small model high |
| Bounded software up to 85, with permission to wait | small model max |
| Unclear requests | medium model low |
| Consequential actions, repeated failures, or substantial context dependence | At least medium model medium |
| Harder work | medium model medium |
| Clear system software at 80+, or bounded software at 90+ | large model medium; low when urgent |
| Attachments | small model high without text classification |
| Text exceeding 24,000 characters | medium model medium without classification |
| Classifier errors or eight-second timeout | medium model low |

Rule precedence matters. Total conversation size alone does not force escalation: a simple request in a 150k+ token thread can use the small tier. Work requiring distant conversation details absent from the recent exchange still escalates. Continuations of an already escalated task retain at least the medium tier until a new task is identified.

Explicit model pins bypass routing. Stored thinking preferences preserve effort while allowing model selection. Classification runs once per run, and retries preserve the host's fallback candidate. The plugin does not grade answers or automatically retry every poor answer.

The default agent is `main`; heartbeat, cron and subagent triggers are excluded. Conversation excerpts are bounded in memory and expire after 30 minutes. Route logs omit prompts and responses, but include selected model, reason, complexity, context size, classifier latency/usage/cost and completion events. The host's own logs may contain additional data.

## Install or upgrade

Requires the Node version supported by your OpenClaw installation, Python 3, model access and an OpenRouter API key. There are no npm dependencies. The key must be available as `OPENROUTER_API_KEY` in the gateway process environment. The plugin sends the current request and bounded recent exchange directly to OpenRouter; the old host-completion classifier configuration no longer applies.

```sh
git clone https://github.com/Zero-Nine-Labs/openclaw-model-router.git
cd openclaw-model-router
npm test
python3 compat.py --check /absolute/path/to/openclaw
```

Only apply the compatibility extension if the check recognizes your exact runtime:

```sh
python3 compat.py --apply /absolute/path/to/openclaw
openclaw plugins install --link --force --accept-capabilities /absolute/path/to/openclaw-model-router
```

The thinking extension has exact profiles for OpenClaw 2026.9.3 and 2026.9.5. Preserve your configuration and runtime backups, and never bypass hash checks. [COMPATIBILITY.md](COMPATIBILITY.md) explains the extension and rollback.

Enable the plugin under `plugins.entries["model-router"]`:

```json
{
  "enabled": true,
  "hooks": { "allowConversationAccess": true },
  "config": {
    "agentIds": ["main"],
    "models": {
      "small": "openai/gpt-6-luna",
      "medium": "openai/gpt-6-sol",
      "large": "openai/gpt-6-astra"
    }
  }
}
```

The example routes clear work to GPT-6 Luna, ambiguous or harder work to GPT-6 Sol, and the largest tier to GPT-6 Astra. Set OpenClaw’s default and execution fallback separately, for example:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai/gpt-6-sol",
        "fallbacks": ["openai-api/gpt-6-luna"]
      }
    }
  }
}
```

Replace the example references with models available to your account and included in the agent allowlist, including the fallback. The `models` configuration is required; missing or malformed references stop plugin initialization. Configure execution fallback through OpenClaw. When upgrading from an earlier version, add this configuration before enabling the new code. Old `llm` completion permissions are unnecessary for the direct JEV classifier. Validate configuration, restart, then verify model, effort and fallback in isolated sessions with delivery disabled. Fast mode remains a host setting.

On the pinned 2026.9.3 build, an additional optional repair prevents false "selected model unavailable" notices after successful intentional routing:

```sh
python3 fallback-notice-compat.py --check /absolute/path/to/openclaw
python3 fallback-notice-compat.py --apply /absolute/path/to/openclaw
```

This separate repair is not verified for 2026.9.5 and refuses other runtime bundles. It preserves genuine fallback notices. Exact-account availability preflight remains unimplemented; the host's configured execution fallback is still required.

## Test and evaluate

```sh
npm test
OPENCLAW_ROUTER_FIXTURES=/path/to/original-thinking-files npm run test:compat
OPENCLAW_FALLBACK_FIXTURES=/path/to/original-fallback-file npm run test:fallback
```

Portable tests cover JEV parsing and transport, routing, manual choices, concurrent sessions, retries and long-context cases. The two compatibility suites need validated original 2026.9.3 runtime fixtures, which are not distributed here. Missing fixtures are errors, not skipped successes. The 2026.9.5 profile was checked against the exact installed bundle, including patch/restore hashes and live automatic and manual routing turns.

For classifier-only testing, temporarily set `config.enableEval` to `true` and restart. The authenticated RPC requires `operator.admin` and never executes case prompts:

```sh
python3 evals/run.py --cases evals/cases.json --output results.jsonl --repeats 3 --workers 2
python3 evals/summarize.py results.jsonl --output summary.json
```

Disable `enableEval` and restart afterward. Current cases use JEV's schema and include 180k-token routing facts. Evaluation fixtures contain synthetic tasks only. Operator-specific historical evaluations are not part of this public distribution. Add separate outcome checks for actual task execution.

## Disable or restore

Disable the plugin and restart to stop routing. Restore only the extensions you applied:

```sh
python3 fallback-notice-compat.py --restore /absolute/path/to/openclaw
python3 compat.py --restore /absolute/path/to/openclaw
```

Restart after restoration. MIT licensed. Credentials, private session logs and host fixtures are excluded from the repository.

## Public distribution

Keep credentials, account configuration, real conversations, operational reports and host fixtures outside this repository. The checked-in examples and tests use generic model tiers. The MIT license and contributor attribution are preserved. Existing Git history is retained; this update anonymizes the current distribution, not earlier commits or GitHub attribution.
