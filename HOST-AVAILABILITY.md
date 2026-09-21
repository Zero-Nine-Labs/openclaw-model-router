# Host availability extension draft

The router can consume an optional `before_model_resolve` capability named `checkModelAvailability`. This is a proposed local host extension, not an API shipped by stock OpenClaw 2026.9.3. The router-side implementation is tested; host implementation and integration acceptance are still required before ZN-878 can be completed.

The callback accepts a bounded batch of `{ provider, model }` references and returns matching entries with `kind` equal to `available`, `unavailable`, or `unknown`. Optional `reason` values are `model_unavailable`, `cooldown`, `auth_failed`, `missing_auth`, `unobserved`, or `scope_closed`; `retryAt` is an epoch-millisecond deadline. Availability describes current evidence, not a guarantee that a future network request will succeed.

The host must bind the callback to the current run, effective model account and prepared runtime. Plugins cannot choose an account, agent directory or credential store. Reads must not refresh credentials or perform external catalog discovery. Retained callbacks must lose authority after hook dispatch, abort, account replacement or runtime closure. Missing native observations remain unknown. Cooldowns are evaluated freshly, with model-specific failures and bounded expiry owned by the runtime that observed them.

When its policy-preferred model is known unavailable, the router returns:

```js
{
  modelUnavailable: { provider, model, reason },
  thinkingOverride
}
```

The host must consume this result outside the hook exception handler and enter its canonical configured fallback chain. It must exclude the unavailable tuple even when it differs from the initial host candidate, preserve healthy eligible candidates in their configured order, and preserve manual model/thinking preferences. A fallback retry must be identified as such so the router does not repeat its original selection.

Router logs retain `preferredModel`, record a null selected `model` when requesting fallback, and include `availability`, `availabilityReason`, `availabilityRetryAt` and `fallbackRequested`. Actual `attempt` events identify the executed model. `classifierMs` and `availabilityMs` are separate measurements. Raw availability errors, credentials and account identifiers are not logged.

On a host without this capability, routing retains its existing behavior and reports `unknown` with `unsupported_host`. A failed check reports `unknown` with `check_failed`. Neither state is evidence of model availability.

Before deployment, integration proof must cover a registered local plugin, account isolation and replacement, cooldown expiry, native failure/recovery, closed callback scope, both matching and differing initial/preferred model candidates, configured runtime fallback, and existing thinking/notice compatibility behavior.
