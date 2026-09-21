import test from 'node:test';
import assert from 'node:assert/strict';
import { registerEvaluation } from '../evaluate.js';
const models = { small: 'example/small-model', medium: 'example/medium-model', large: 'example/large-model' };

test('evaluation method is disabled by default and admin-scoped when enabled', () => {
  let registration;
  const api = { registerGatewayMethod: (...args) => { registration = args; } };
  registerEvaluation(api);
  assert.equal(registration, undefined);
  registerEvaluation({ ...api, pluginConfig: { enableEval: true, models } });
  assert.equal(registration[0], 'model-router.evaluate');
  assert.deepEqual(registration[2], { scope: 'operator.admin', profileAccess: 'required' });
});
test('evaluation rejects oversized inputs and unbounded facts before any completion', async () => {
  let handler;
  registerEvaluation({ pluginConfig: { enableEval: true, models }, registerGatewayMethod: (_, fn) => { handler = fn; } });
  for (const params of [{prompt:'x'.repeat(24001)}, {prompt:'hello',facts:{failures:-1}}, {prompt:'hello',facts:{arbitrary:true}}, {prompt:'hello',recent:'x'.repeat(5001)}]) {
    let response;
    await handler({params,respond:(...args)=>{response=args;}});
    assert.equal(response[0],false);
    assert.equal(response[2].code,'INVALID_REQUEST');
  }
});

test('evaluation reports the configured model rather than an operator default', async () => {
  let handler;
  registerEvaluation({ pluginConfig: { enableEval: true, models }, registerGatewayMethod: (_, fn) => { handler = fn; } }, {
    classifyRequest: async () => ({ assessment: { complexity: 20, clarity: 'clear', family: 'general', guard: 'ordinary', urgency: 'normal' } }),
  });
  let response;
  await handler({ params: { prompt: 'What is 2 + 2?' }, respond: (...args) => { response = args; } });
  assert.equal(response[0], true);
  assert.equal(response[1].route.model, models.small);
});
