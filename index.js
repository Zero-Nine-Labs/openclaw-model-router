import { createHash } from 'node:crypto';
import { classify } from './jev.js';
import { chooseRoute, profiles } from './decision.js';
import { registerEvaluation } from './evaluate.js';

const defaults = { agentIds: ['main'], timeoutMs: 8000, maxPromptChars: 24000, sessionTtlMs: 1800000, maxSessions: 500 };
const logKey = key => createHash('sha256').update(key).digest('hex').slice(0, 12);
const explicitDirective = /(?:^|\s)\/(?:model|think|thinking|t)(?:\s|:|$)/i;

export function createRouter(api, { now = Date.now, classifyRequest = classify } = {}) {
  const config = { ...defaults, ...api.pluginConfig };
  const sessions = new Map();
  const runs = new Map();
  let warnedMissingPatch = false;
  const keyFor = ctx => ctx.sessionKey ? `${ctx.agentId ?? 'main'}:${ctx.sessionKey}` : undefined;
  const log = (event, data) => api.logger.info(`[model-router] ${JSON.stringify({ event, ...data })}`);
  function prune() {
    for (const [key, state] of sessions) if (now() - state.updatedAt > config.sessionTtlMs) sessions.delete(key);
    while (sessions.size >= config.maxSessions) sessions.delete(sessions.keys().next().value);
    for (const [id, run] of runs) if (now() - run.at > config.sessionTtlMs) runs.delete(id);
    while (runs.size >= config.maxSessions * 2) runs.delete(runs.keys().next().value);
  }
  function remember(key, state) { sessions.delete(key); sessions.set(key, { ...state, updatedAt: now() }); }
  async function beforeModel(event, ctx) {
    if (!config.agentIds.includes(ctx.agentId ?? 'main') || ['heartbeat', 'cron', 'subagent'].includes(ctx.trigger)) return;
    const key = keyFor(ctx);
    if (!key || !ctx.runId) return;
    if (!event.routingThinkingSupported) {
      if (!warnedMissingPatch) { api.logger.warn('[model-router] Dynamic routing inactive: compatible thinking hook extension is missing.'); warnedMissingPatch = true; }
      return;
    }
    if (event.modelExplicit || explicitDirective.test(event.prompt)) return;
    let entry;
    try { entry = api.runtime.agent.session.getSessionEntry({ agentId: ctx.agentId, sessionKey: ctx.sessionKey, readConsistency: 'latest' }); }
    catch { api.logger.warn('[model-router] Session metadata unavailable; retaining host selection.'); return; }
    const userModelPin = entry?.modelOverride && (entry.modelOverrideSource === 'user' || entry.modelOverrideSource !== 'auto' && !entry.modelOverrideFallbackOriginModel);
    if (userModelPin || entry?.modelSelectionLocked) return;
    const preserveThinking = event.thinkingExplicit || Boolean(entry?.thinkingLevel);
    const applyThinkingPreference = decision => {
      if (!preserveThinking || !decision) return decision;
      const { thinkingOverride, ...modelSelection } = decision;
      return Object.keys(modelSelection).length ? modelSelection : undefined;
    };
    prune();
    const cached = runs.get(ctx.runId);
    if (!cached && event.isFallbackRetry) return;
    if (cached) {
      const decision = await cached.promise;
      return applyThinkingPreference(cached.provider === ctx.modelProviderId && cached.model === ctx.modelId && !event.isFallbackRetry
        ? decision : { thinkingOverride: decision.thinkingOverride });
    }
    const promise = route(event, ctx, key, entry);
    runs.set(ctx.runId, { at: now(), promise, provider: ctx.modelProviderId, model: ctx.modelId });
    return applyThinkingPreference(await promise);
  }
  async function route(event, ctx, key, entry) {
    const started = now();
    const previous = sessions.get(key);
    const inputTokens = previous?.inputTokens ?? entry?.inputTokens ?? 0;
    let assessment;
    let usage;
    let selected;
    let classifierErrorCode;
    if (event.prompt.length > config.maxPromptChars || event.attachments?.length) {
      selected = event.attachments?.length
        ? { ...profiles.routine_luna, profile: 'routine_luna', reason: 'unseen_attachment' }
        : { ...profiles.difficult, profile: 'difficult', reason: 'classifier_input_limit' };
    } else {
      try {
        const result = await classifyRequest({ prompt: event.prompt, recent: previous?.recent ?? '', timeoutMs: config.timeoutMs });
        assessment = result.assessment;
        usage = result.usage;
        selected = chooseRoute(assessment, { failures: assessment.continuation ? previous?.failures ?? 0 : 0, previousTier: assessment.continuation ? previous?.route.tier : undefined });
        const effortRank = ['low', 'medium', 'high', 'max'];
        if (assessment.clarity === 'clear' && assessment.continuation && !assessment.timing_explicit && previous && selected.tier === previous.route.tier && effortRank.indexOf(selected.effort) < effortRank.indexOf(previous.route.effort)) {
          selected = { ...previous.route, reason: 'retain_task_profile' };
        }
      } catch (error) {
        classifierErrorCode = typeof error?.code === 'string' && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : ['SyntaxError', 'TypeError', 'TimeoutError', 'AbortError'].includes(error?.name) ? error.name : 'CLASSIFIER_ERROR';
        const failure = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'classifier_timeout' : 'classifier_failed';
        selected = { ...profiles.routine, profile: 'routine', reason: failure };
      }
    }
    const continuing = previous && (assessment?.continuation || !assessment);
    const taskId = continuing ? previous.taskId : ctx.runId;
    const classifierCostUsd = Number.isFinite(usage?.costUsd) && usage.costUsd > 0 ? usage.costUsd : null;
    remember(key, { taskId, route: selected, runId: ctx.runId, failures: continuing ? previous.failures : 0, request: event.prompt.slice(0, 2500), recent: `User: ${event.prompt.slice(0, 2500)}`, inputTokens: previous?.inputTokens ?? 0 });
    log('route', { runId: ctx.runId, taskId, session: logKey(key), profile: selected.profile, model: selected.model, effort: event.thinkingExplicit ? null : entry?.thinkingLevel ?? selected.effort, effortSource: event.thinkingExplicit || entry?.thinkingLevel ? 'manual' : 'router', reason: selected.reason, complexity: assessment?.complexity, taskFamily: assessment?.family, urgency: assessment?.urgency, clarity: assessment?.clarity, referenceResolution: assessment?.reference_resolution, referenceProbability: assessment?.reference_probability, guard: assessment?.guard, inputTokens, classifierMs: now() - started, classifierCostUsd, classifierUsage: usage, classifierErrorCode });
    const [providerOverride, ...modelParts] = selected.model.split('/');
    return { providerOverride, modelOverride: modelParts.join('/'), thinkingOverride: selected.effort };
  }
  function llmOutput(event, ctx) {
    const key = keyFor(ctx), state = sessions.get(key);
    if (!state || state.runId !== event.runId) return;
    const text = event.assistantTexts?.join('\n') ?? '';
    remember(key, { ...state, recent: text ? `User: ${state.request}\nAssistant: ${text.slice(-2500)}` : state.recent, inputTokens: Number.isFinite(event.usage?.contextUsage?.promptTokens) && event.usage.contextUsage.promptTokens >= 0 ? event.usage.contextUsage.promptTokens : event.usage ? (event.usage.input ?? 0) + (event.usage.cacheRead ?? 0) + (event.usage.cacheWrite ?? 0) : state.inputTokens });
    log('attempt', { runId: event.runId, taskId: state.taskId, session: logKey(key), model: `${event.provider}/${event.model}`, requestedEffort: state.route.effort, observedEffort: event.reasoningEffort ?? null, usage: event.usage, executionCostUsd: null, costStatus: 'not_reported_by_hook' });
  }
  function agentEnd(event, ctx) {
    const key = keyFor(ctx), state = sessions.get(key);
    if (!state || state.runId !== (event.runId ?? ctx.runId)) return;
    remember(key, { ...state, failures: event.success ? 0 : state.failures + 1 });
    log('turn_end', { runId: state.runId, taskId: state.taskId, session: logKey(key), completed: event.success, durationMs: event.durationMs });
  }
  return { beforeModel, llmOutput, agentEnd };
}

export default {
  id: 'model-router',
  name: 'Difficulty and urgency model router',
  register(api) {
    registerEvaluation(api);
    const router = createRouter(api);
    api.on('before_model_resolve', router.beforeModel);
    api.on('llm_output', router.llmOutput);
    api.on('agent_end', router.agentEnd);
  },
};
