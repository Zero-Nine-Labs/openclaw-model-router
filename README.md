# OpenClaw model router

Choose an execution model and reasoning effort for each request. JEV 1.13 classifies the current task through OpenRouter's Decisions API; deterministic rules select Luna, Sol or Astra. Version `0.2.4-jev-experimental` combines the deployed JEV router with this repository's OpenClaw 2026.9.5 compatibility support.

This is experimental. Classification can be wrong, and route-label agreement does not prove answer quality or production savings. See [EVIDENCE.md](EVIDENCE.md).

## How it works

[jev.js](jev.js) validates typed decisions for complexity, clarity, reference resolution, work family, escalation conditions, urgency, explicit timing and continuation. Complexity is an ordinal score from 0 to 100, not a probability of success. Strong unresolved-reference evidence can override a clear assessment at a native score of 0.95; that threshold is empirical, not calibrated confidence.

[decision.js](decision.js) applies these rules:

| Work | Default route |
| --- | --- |
| Clear simple work, complexity up to 30 | Luna medium |
| Routine work up to 60 | Luna high |
| General work up to 85, unless urgent | Luna high |
| Bounded software up to 85, with permission to wait | Luna max |
| Unclear requests | Sol low |
| Consequential actions, repeated failures, or substantial context dependence | At least Sol medium |
| Harder work | Sol medium |
| Clear system software at 80+, or bounded software at 90+ | Astra medium; low when urgent |
| Attachments | Luna high without text classification |
| Text exceeding 24,000 characters | Sol medium without classification |
| Classifier errors or eight-second timeout | Sol low |

Rule precedence matters. Total conversation size alone does not force Sol: a simple request in a 150k+ token thread can use Luna. Work requiring distant conversation details absent from the recent exchange still escalates. Continuations of an already escalated task retain at least Sol until a new task is identified.

Explicit model pins bypass routing. Stored thinking preferences preserve effort while allowing model selection. Classification runs once per run, and retries preserve the host's fallback candidate. The plugin does not grade answers or automatically retry every poor answer.

The default agent is `main`; heartbeat, cron and subagent triggers are excluded. Conversation excerpts are bounded in memory and expire after 30 minutes. Route logs omit prompts and responses, but include selected model, reason, complexity, context size, classifier latency/usage/cost and completion events. The host's own logs may contain additional data.

## Install or upgrade from the Luna classifier

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
  "config": { "agentIds": ["main"] }
}
```

The execution models must be in the agent allowlist. Adapt model IDs in `decision.js` to your account, and configure execution fallback through OpenClaw. Old `llm` completion permissions are unnecessary for the direct JEV classifier. Validate configuration, restart, then verify model, effort and fallback in isolated sessions with delivery disabled. Fast mode remains a host setting.

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

Portable tests cover JEV parsing and transport, routing, manual choices, concurrent sessions, retries and long-context cases. The two compatibility suites need validated original 2026.9.3 runtime fixtures, which are not distributed here. Missing fixtures are errors, not skipped successes. The 2026.9.5 profile is preserved from the earlier contribution; it was not revalidated against 2026.9.5 runtime fixtures in this merge.

For classifier-only testing, temporarily set `config.enableEval` to `true` and restart. The authenticated RPC requires `operator.admin` and never executes case prompts:

```sh
python3 evals/run.py --cases evals/cases.json --output results.jsonl --repeats 3 --workers 2
python3 evals/summarize.py results.jsonl --output summary.json
```

Disable `enableEval` and restart afterward. Current cases use JEV's schema and include 180k-token routing facts. Historical Luna cases and measurements remain under `evals/legacy`; they are not current acceptance criteria. Add separate outcome checks for actual task execution.

## Disable or restore

Disable the plugin and restart to stop routing. Restore only the extensions you applied:

```sh
python3 fallback-notice-compat.py --restore /absolute/path/to/openclaw
python3 compat.py --restore /absolute/path/to/openclaw
```

Restart after restoration. MIT licensed. Credentials, private session logs and host fixtures are excluded from the repository.
