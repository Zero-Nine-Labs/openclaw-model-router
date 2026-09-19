import { classify } from './classifier.js';
import { chooseRoute } from './policy.js';

export function registerEvaluation(api) {
  if (api.pluginConfig?.enableEval !== true) return;
  api.registerGatewayMethod('model-router.evaluate', async ({ params, respond }) => {
    const started = Date.now();
    const { prompt, recent = '', facts = {} } = params;
    const validFacts = facts && typeof facts === 'object' && !Array.isArray(facts)
      && Object.keys(facts).every(key => ['inputTokens', 'failures', 'previousTier'].includes(key))
      && ['inputTokens', 'failures'].every(key => facts[key] === undefined || Number.isInteger(facts[key]) && facts[key] >= 0 && facts[key] <= 1000000)
      && (facts.previousTier === undefined || ['small', 'medium', 'large'].includes(facts.previousTier));
    if (typeof prompt !== 'string' || !prompt.length || prompt.length > 24000 || typeof recent !== 'string' || recent.length > 5000 || !validFacts) {
      respond(false, undefined, { code: 'INVALID_REQUEST', message: 'Expected prompt (1–24000 characters), optional recent (up to 5000), and bounded routing facts.' });
      return;
    }
    try {
      const result = await classify({ prompt, recent, agentId: 'main', complete: args => api.runtime.llm.complete(args), timeoutMs: api.pluginConfig?.timeoutMs ?? 8000 });
      respond(true, { ok: true, assessment: result.assessment, route: chooseRoute(result.assessment, facts), usage: result.usage, latencyMs: Date.now() - started });
    } catch (error) {
      const kind = ['TimeoutError', 'AbortError', 'SyntaxError'].includes(error?.name) ? error.name : 'CLASSIFIER_ERROR';
      respond(true, { ok: false, error: kind, latencyMs: Date.now() - started });
    }
  }, { scope: 'operator.admin', profileAccess: 'required' });
}
