import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../index.js';

const assessment = (patch = {}) => ({ complexity: 20, clarity: 'clear', family: 'general', guard: 'ordinary', urgency: 'normal', timing_explicit: false, continuation: false, ...patch });
const event = { prompt: 'Summarize this text', routingThinkingSupported: true };
const context = (runId = 'run1', sessionKey = 'agent:main:test') => ({ runId, sessionKey, agentId: 'main' });
function harness({ entry, classifier = async () => ({ assessment: assessment() }), now, pluginConfig } = {}) {
  const logs = [];
  const api = { pluginConfig, logger: { info: x => logs.push(x), warn: x => logs.push(x) }, runtime: { agent: { session: { getSessionEntry: () => entry } }, llm: { complete: () => { throw Error('unexpected'); } } } };
  return { router: createRouter(api, { classifyRequest: classifier, ...(now ? { now } : {}) }), logs };
}

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
  const { router } = harness({ classifier: async ({ prompt }) => { calls++; await new Promise(r => setTimeout(r, 5)); return { assessment: assessment(prompt === 'patient' ? { family: 'bounded_software', complexity: 80, urgency: 'relaxed' } : {}) }; } });
  const results = await Promise.all([router.beforeModel({ ...event, prompt: 'patient' }, context('a','a')), router.beforeModel({ ...event, prompt: 'patient' }, context('a','a')), router.beforeModel(event, context('b','b'))]);
  assert.equal(calls, 2);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].thinkingOverride, 'max');
  assert.equal(results[2].thinkingOverride, 'medium');
});
test('follow-up can raise effort, normal continuation does not reduce it, new task can downgrade', async () => {
  const cases = [assessment(), assessment({ complexity: 80, continuation: true }), assessment({ continuation: true }), assessment()];
  const { router } = harness({ classifier: async () => ({ assessment: cases.shift() }) });
  const results = [];
  for (let n=0;n<4;n++) results.push(await router.beforeModel(event, context(`r${n}`)));
  assert.deepEqual(results.map(x => x.thinkingOverride), ['medium','high','high','medium']);
});
test('large cached context does not promote a simple follow-up', async () => {
  const { router } = harness({ classifier: async () => ({ assessment: assessment({ continuation: true }) }) });
  await router.beforeModel(event, context());
  router.llmOutput({ runId: 'run1', usage: { input: 3, cacheWrite: 130000 }, assistantTexts: ['done'] }, context());
  router.llmOutput({ runId: 'run1' }, context());
  assert.equal((await router.beforeModel(event, context('run2'))).modelOverride, 'gpt-5.6-luna');
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
test('large measured and cumulative context do not promote simple requests', async () => {
  const { router } = harness({ classifier: async () => ({ assessment: assessment({ continuation: true }) }) });
  await router.beforeModel(event, context());
  router.llmOutput({ runId: 'run1', usage: { input: 51476, cacheRead: 278912, contextUsage: { state: 'available', promptTokens: 50428 } } }, context());
  assert.equal((await router.beforeModel(event, context('run2'))).modelOverride, 'gpt-5.6-luna');
  router.llmOutput({ runId: 'run2', usage: { input: 3, contextUsage: { state: 'available', promptTokens: 150000 } } }, context('run2'));
  assert.equal((await router.beforeModel(event, context('run3'))).modelOverride, 'gpt-5.6-luna');
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

test('unclear continuation returns Sol low even after a higher-effort task', async () => {
  const cases=[assessment({guard:'consequential'}),assessment({clarity:'unclear',continuation:true})];
  const {router}=harness({classifier:async()=>({assessment:cases.shift()})});
  assert.equal((await router.beforeModel(event,context('first'))).thinkingOverride,'medium');
  assert.deepEqual(await router.beforeModel(event,context('second')),{providerOverride:'openai',modelOverride:'gpt-5.6-sol',thinkingOverride:'low'});
});

test('explicit timing on a continuation can reduce Astra effort', async () => {
  const a=assessment({family:'system_software',complexity:90});
  const cases=[a,{...a,continuation:true,urgency:'urgent',timing_explicit:true}];
  const {router}=harness({classifier:async()=>({assessment:cases.shift()})});
  assert.equal((await router.beforeModel(event,context('first'))).thinkingOverride,'medium');
  assert.deepEqual(await router.beforeModel(event,context('second')),{providerOverride:'openai',modelOverride:'gpt-6-astra',thinkingOverride:'low'});
});

test('classifier receives bounded previous request and response for follow-ups', async () => {
  const requests=[];
  const {router}=harness({classifier:async x=>{requests.push(x);return {assessment:assessment({continuation:true})};}});
  await router.beforeModel({...event,prompt:'Configure the TV'},context('first'));
  router.llmOutput({runId:'first',assistantTexts:['A DHCP reservation would prevent recurrence.']},context('first'));
  await router.beforeModel({...event,prompt:'Can you do that?'},context('second'));
  assert.equal(requests[1].recent,'User: Configure the TV\nAssistant: A DHCP reservation would prevent recurrence.');
});


test('150k-token sessions route the current task and retain diagnostic fields', async () => {
  for (const [patch, model, reason] of [
    [{ continuation: true }, 'gpt-5.6-luna', 'simple'],
    [{ complexity: 78, family: 'bounded_software' }, 'gpt-5.6-sol', 'difficult'],
    [{ guard: 'long_context' }, 'gpt-5.6-sol', 'long_context'],
    [{ guard: 'consequential' }, 'gpt-5.6-sol', 'consequential'],
    [{ clarity: 'unclear' }, 'gpt-5.6-sol', 'unclear_request'],
  ]) {
    const usage = { inputTokens: 100, outputTokens: 20, costUsd: 0.0001 };
    const {router, logs} = harness({entry: {inputTokens: 180000}, classifier: async () => ({assessment: assessment(patch), usage})});
    assert.equal((await router.beforeModel(event, context())).modelOverride, model);
    const route = JSON.parse(logs[0].slice('[model-router] '.length));
    assert.equal(route.model, `openai/${model}`);
    assert.equal(route.reason, reason);
    assert.equal(route.inputTokens, 180000);
    assert.equal(route.complexity, patch.complexity ?? 20);
    assert.equal(typeof route.classifierMs, 'number');
    assert.deepEqual(route.classifierUsage, usage);
  }
});

test('unavailable preferred model requests host fallback without selecting it or reclassifying', async () => {
  let classifications = 0;
  let checks = 0;
  const { router, logs } = harness({ classifier: async () => { classifications++; return { assessment: assessment({ guard: 'consequential' }) }; } });
  const ctx = { ...context(), modelProviderId: 'openai', modelId: 'gpt-5.6-sol' };
  const checked = { ...event, checkModelAvailability: async candidates => {
    checks++;
    assert.deepEqual(candidates, [{ provider: 'openai', model: 'gpt-5.6-sol' }]);
    return [{ ...candidates[0], kind: 'unavailable', reason: 'cooldown', retryAt: 12345 }];
  } };
  const first = await router.beforeModel(checked, ctx);
  assert.equal(first.modelOverride, undefined);
  assert.deepEqual(first.modelUnavailable, { provider: 'openai', model: 'gpt-5.6-sol', reason: 'cooldown' });
  assert.deepEqual(await router.beforeModel({ ...checked, isFallbackRetry: true }, { ...ctx, modelProviderId: 'openai-api', modelId: 'gpt-5.6-luna' }), { thinkingOverride: 'medium' });
  assert.equal(classifications, 1);
  assert.equal(checks, 1);
  const route = JSON.parse(logs.find(line => line.startsWith('[model-router] ')).slice(15));
  assert.equal(route.model, null);
  assert.equal(route.preferredModel, 'openai/gpt-5.6-sol');
  assert.equal(route.availability, 'unavailable');
  assert.equal(route.availabilityReason, 'cooldown');
  assert.equal(route.fallbackRequested, true);
});

test('availability is checked freshly for new runs and never overrides manual pins', async () => {
  let available = false;
  let checks = 0;
  const checked = { ...event, checkModelAvailability: async candidates => {
    checks++;
    return candidates.map(candidate => ({ ...candidate, kind: available ? 'available' : 'unavailable', reason: 'model_unavailable' }));
  } };
  const { router } = harness();
  assert.equal((await router.beforeModel(checked, context('a'))).modelOverride, undefined);
  available = true;
  assert.equal((await router.beforeModel(checked, context('b'))).modelOverride, 'gpt-5.6-luna');
  const pinned = harness({ entry: { modelOverride: 'gpt-5.6-sol', modelOverrideSource: 'user' } });
  assert.equal(await pinned.router.beforeModel(checked, context()), undefined);
  assert.equal(checks, 2);
});

test('unknown availability preserves routing and availability failures never leak raw errors', async () => {
  for (const checkModelAvailability of [
    async candidates => candidates.map(candidate => ({ ...candidate, kind: 'unknown', reason: 'unobserved' })),
    async () => { throw Error('secret account credentials'); },
  ]) {
    const { router, logs } = harness();
    assert.equal((await router.beforeModel({ ...event, checkModelAvailability }, context())).modelOverride, 'gpt-5.6-luna');
    assert(!logs.join('').includes('secret account credentials'));
  }
});

test('availability latency is measured separately from classifier latency', async () => {
  let clock = 100;
  const { router, logs } = harness({ now: () => clock, classifier: async () => { clock += 10; return { assessment: assessment() }; } });
  await router.beforeModel({ ...event, checkModelAvailability: async candidates => { clock += 1000; return candidates.map(candidate => ({ ...candidate, kind: 'available' })); } }, context());
  const route = JSON.parse(logs[0].slice(15));
  assert.equal(route.classifierMs, 10);
  assert.equal(route.availabilityMs, 1000);
});
