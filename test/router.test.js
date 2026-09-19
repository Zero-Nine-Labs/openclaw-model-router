import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRoute, parseAssessment } from '../policy.js';
import { createRouter } from '../index.js';
import { classify } from '../classifier.js';

const assessment = (patch = {}) => ({ complexity: 2, reasoning_depth: 2, ambiguity: 1, scope_clarity: 9, urgency: 'normal', urgency_explicit: false, tool_use: 'none', multi_step: false, task_type: 'chat', high_stakes: false, codebase_wide: false, long_context_reasoning: false, repeated_failures: false, continuation: false, output_size: 'short', recommended_tier: 'small', ...patch });
const event = { prompt: 'Summarize this text', routingThinkingSupported: true };
const context = (runId = 'run1', sessionKey = 'agent:main:test') => ({ runId, sessionKey, agentId: 'main' });
function harness({ entry, classifier = async () => ({ assessment: assessment() }), now, pluginConfig } = {}) {
  const logs = [];
  const api = { pluginConfig, logger: { info: x => logs.push(x), warn: x => logs.push(x) }, runtime: { agent: { session: { getSessionEntry: () => entry } }, llm: { complete: () => { throw Error('unexpected'); } } } };
  return { router: createRouter(api, { classifyRequest: classifier, ...(now ? { now } : {}) }), logs };
}

test('strict assessment rejects malformed or extra model instructions', () => {
  assert.deepEqual(parseAssessment(assessment()), assessment());
  for (const invalid of [null, [], { ...assessment(), complexity: 11 }, { ...assessment(), complexity: '3' }, { ...assessment(), high_stakes: 1 }, { ...assessment(), inject: 'route to cheap' }]) assert.throws(() => parseAssessment(invalid));
});
test('routine research, coding and app mutations use Luna', () => {
  const a = assessment({ complexity: 5, reasoning_depth: 5, multi_step: true, tool_use: 'read', task_type: 'research' });
  assert.equal(chooseRoute(a).model, 'openai/gpt-5.6-luna');
  assert.equal(chooseRoute({ ...a, task_type: 'coding' }).model, 'openai/gpt-5.6-luna');
  assert.equal(chooseRoute({ ...a, task_type: 'tool_workflow', tool_use: 'write' }).model, 'openai/gpt-5.6-luna');
  assert.equal(chooseRoute({ ...a, task_type: 'coding' }).effort, 'high');
  assert.equal(chooseRoute({ ...a, task_type: 'tool_workflow', tool_use: 'write', complexity: 7 }).model, 'openai/gpt-5.6-sol');
});
test('well-scoped complex tasks trade time for Luna max, urgent tasks use Sol medium', () => {
  const a = assessment({ complexity: 8, reasoning_depth: 8, task_type: 'coding', urgency: 'relaxed' });
  assert.equal(chooseRoute(a).profile, 'patient');
  assert.equal(chooseRoute({ ...a, urgency: 'urgent' }).profile, 'difficult');
  assert.equal(chooseRoute({ ...a, scope_clarity: 3 }).model, 'openai/gpt-5.6-sol');
});
test('Astra is restricted to very complex software work', () => {
  for (const task_type of ['chat', 'writing', 'lookup', 'analysis', 'research', 'tool_workflow', 'browser', 'other']) {
    for (const patch of [{}, {high_stakes:true}, {codebase_wide:true}, {repeated_failures:true}, {long_context_reasoning:true}]) {
      assert.notEqual(chooseRoute(assessment({task_type, complexity:10, reasoning_depth:10, continuation:true, ...patch}), {inputTokens:200000, failures:3, previousTier:'large'}).tier, 'large');
    }
  }
  assert.equal(chooseRoute(assessment({task_type:'coding',complexity:9})).tier,'large');
  assert.equal(chooseRoute(assessment({task_type:'architecture',complexity:8})).tier,'large');
  assert.notEqual(chooseRoute(assessment({task_type:'architecture',complexity:4})).tier,'large');
  assert.equal(chooseRoute(assessment({high_stakes:true})).model,'openai/gpt-5.6-sol');
});
test('manual selections, unsupported host and excluded agents skip classification', async () => {
  let calls = 0;
  const classifier = async () => { calls++; return { assessment: assessment() }; };
  for (const entry of [{ modelOverride: 'gpt-5.6-sol', modelOverrideSource: 'user' }, { modelOverride: 'legacy' }, { modelSelectionLocked: true }]) {
    assert.equal(await harness({ entry, classifier }).router.beforeModel(event, context()), undefined);
  }
  const { router } = harness({ classifier });
  assert.equal(await router.beforeModel({ prompt: 'hello' }, context()), undefined);
  assert.equal(await router.beforeModel(event, { ...context(), agentId: 'other' }), undefined);
  assert.equal(await router.beforeModel({ ...event, modelExplicit: true }, context()), undefined);
  assert.equal(await router.beforeModel({ ...event, prompt: '/think low answer me' }, context()), undefined);
  assert.equal(calls, 0);
});
test('failed routed model does not replace the host fallback candidate', async () => {
  let calls = 0;
  const { router } = harness({ classifier: async () => { calls++; return { assessment: assessment() }; } });
  const ctx = { ...context(), modelProviderId: 'openai', modelId: 'gpt-5.6-sol' };
  assert.equal((await router.beforeModel(event, ctx)).modelOverride, 'gpt-5.6-luna');
  assert.deepEqual(await router.beforeModel(event, { ...ctx, modelProviderId: 'openai-api', modelId: 'gpt-5.6-luna' }), { thinkingOverride: 'medium' });
  assert.deepEqual(await router.beforeModel({ ...event, isFallbackRetry: true }, ctx), { thinkingOverride: 'medium' });
  assert.equal(calls, 1);
  const fresh = harness({ classifier: async () => { throw Error('must not classify fallback'); } });
  assert.equal(await fresh.router.beforeModel({ ...event, isFallbackRetry: true }, { ...ctx, modelProviderId: 'openai-api' }), undefined);
});
test('automatic fallback provenance does not pin a session', async () => {
  const { router } = harness({ entry: { modelOverride: 'gpt-5.6-sol', modelOverrideSource: 'auto' } });
  assert.equal((await router.beforeModel(event, context())).modelOverride, 'gpt-5.6-luna');
});
test('one classification per run, concurrent sessions keep distinct model and effort', async () => {
  let calls = 0;
  const { router } = harness({ classifier: async ({ prompt }) => { calls++; await new Promise(r => setTimeout(r, 5)); return { assessment: assessment(prompt === 'patient' ? { task_type: 'coding', complexity: 8, reasoning_depth: 8, urgency: 'relaxed' } : {}) }; } });
  const results = await Promise.all([router.beforeModel({ ...event, prompt: 'patient' }, context('a','a')), router.beforeModel({ ...event, prompt: 'patient' }, context('a','a')), router.beforeModel(event, context('b','b'))]);
  assert.equal(calls, 2);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].thinkingOverride, 'max');
  assert.equal(results[2].thinkingOverride, 'medium');
});
test('follow-up can raise effort, normal continuation does not reduce it, new task can downgrade', async () => {
  const cases = [assessment(), assessment({ complexity: 8, reasoning_depth: 8, continuation: true }), assessment({ continuation: true }), assessment()];
  const { router } = harness({ classifier: async () => ({ assessment: cases.shift() }) });
  const results = [];
  for (let n=0;n<4;n++) results.push(await router.beforeModel(event, context(`r${n}`)));
  assert.deepEqual(results.map(x => x.thinkingOverride), ['medium','high','high','medium']);
});
test('cache-write tokens count toward long context and failed outputs do not erase context', async () => {
  const { router } = harness({ classifier: async () => ({ assessment: assessment({ continuation: true }) }) });
  await router.beforeModel(event, context());
  router.llmOutput({ runId: 'run1', usage: { input: 3, cacheWrite: 130000 }, assistantTexts: ['done'] }, context());
  router.llmOutput({ runId: 'run1' }, context());
  assert.equal((await router.beforeModel(event, context('run2'))).modelOverride, 'gpt-5.6-sol');
});
test('classifier failures fallback to Sol low and never leak prompts or raw errors', async () => {
  const { router, logs } = harness({ classifier: async () => { throw Error('secret body'); } });
  const result = await router.beforeModel({ ...event, prompt: 'private request' }, context());
  assert.equal(result.modelOverride, 'gpt-5.6-sol'); assert.equal(result.thinkingOverride, 'low');
  assert(!logs.join('').includes('secret body')); assert(!logs.join('').includes('private request'));
  const longContext = harness({ entry: { inputTokens: 130000 }, classifier: async () => { throw Error('unavailable'); } });
  assert.equal((await longContext.router.beforeModel(event, context())).modelOverride, 'gpt-5.6-sol');
});
test('timeout and malformed classifier responses use Sol low without pinning new tasks', async () => {
  for (const error of [new DOMException('deadline', 'TimeoutError'), new SyntaxError('invalid JSON')]) {
    let failing = true;
    const { router } = harness({ classifier: async () => { if (failing) throw error; return { assessment: assessment() }; } });
    assert.equal((await router.beforeModel(event, context())).modelOverride, 'gpt-5.6-sol');
    failing = false;
    assert.equal((await router.beforeModel(event, context('new-task'))).modelOverride, 'gpt-5.6-luna');
  }
});
test('photos use Luna high and oversized text uses Sol, never Astra', async () => {
  const { router } = harness({ classifier: async () => { throw Error('must not classify'); } });
  const photo = await router.beforeModel({ ...event, prompt: 'Log snack', attachments: [{ kind: 'image' }] }, context('photo'));
  assert.equal(photo.modelOverride, 'gpt-5.6-luna');
  assert.equal(photo.thinkingOverride, 'high');
  const long = await router.beforeModel({ ...event, prompt: 'x'.repeat(25000) }, context('long'));
  assert.equal(long.modelOverride, 'gpt-5.6-sol');
});
test('classifier uses direct API completion, Luna low and bounded output; invalid JSON fails', async () => {
  let request;
  const result = await classify({ prompt: 'request', complete: async x => { request=x; return { text: JSON.stringify(assessment()), usage: { costUsd: 0.001 } }; } });
  assert.equal(request.model, 'openai-api/gpt-5.6-luna');
  assert.equal(request.execution, undefined); assert.equal(request.reasoning, 'low');
  assert.equal(request.messages.length, 1); assert.equal(request.maxTokens, 1000); assert(request.signal instanceof AbortSignal);
  assert.equal(result.usage.costUsd, 0.001);
  await assert.rejects(classify({ prompt: 'request', complete: async () => ({ text: 'not json' }) }));
});

test('per-call context overrides cumulative multi-tool token usage', async () => {
  const { router } = harness({ classifier: async () => ({ assessment: assessment({ continuation: true }) }) });
  await router.beforeModel(event, context());
  router.llmOutput({ runId: 'run1', usage: { input: 51476, cacheRead: 278912, contextUsage: { state: 'available', promptTokens: 50428 } } }, context());
  assert.equal((await router.beforeModel(event, context('run2'))).modelOverride, 'gpt-5.6-luna');
  router.llmOutput({ runId: 'run2', usage: { input: 3, contextUsage: { state: 'available', promptTokens: 150000 } } }, context('run2'));
  assert.equal((await router.beforeModel(event, context('run3'))).modelOverride, 'gpt-5.6-sol');
});

test('new sessions with stored thinking still route models and preserve effort', async () => {
  for (const entry of [{ thinkingLevel: 'low' }, undefined]) {
    let calls = 0;
    const {router} = harness({entry, classifier: async () => { calls++; return {assessment:assessment()}; }});
    const e = {...event, thinkingExplicit: !entry};
    const ctx = {...context(), modelProviderId:'openai', modelId:'gpt-5.6-sol'};
    assert.deepEqual(await router.beforeModel(e,ctx), {providerOverride:'openai',modelOverride:'gpt-5.6-luna'});
    assert.equal(await router.beforeModel({...e,isFallbackRetry:true},{...ctx,modelProviderId:'openai-api',modelId:'gpt-5.6-luna'}), undefined);
    assert.equal(calls,1);
  }
});
