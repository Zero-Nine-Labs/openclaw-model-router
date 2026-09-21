import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, parseDecision, questions } from '../jev.js';
import { chooseRoute } from '../decision.js';

const assessment = patch => ({ complexity: 20, clarity: 'clear', reference_resolution: 'resolved_or_not_needed', reference_probability: 0, family: 'general', guard: 'ordinary', urgency: 'normal', timing_explicit: false, continuation: false, ...patch });
const response = () => ({ answers: Object.fromEntries(Object.entries({ complexity: 0.8, clarity: 'clear', reference_resolution: 'resolved_or_not_needed', family: 'general', guard: 'ordinary', urgency: 'normal', timing_explicit: 'no', continuation: 'no' }).map(([key,value]) => [key, key === 'complexity' ? {type:'score',score:value} : {type:'choice',choice:value,...(key==='reference_resolution'?{probabilities:{resolved_or_not_needed:1,unresolved:0}}:{})}])) });

test('native decision parser accepts only complete, bounded typed answers', () => {
  assert.deepEqual(parseDecision(response()), assessment());
  for (const value of [-1,4.01,Infinity,NaN,'2',null]) {
    const raw=response(); raw.answers.complexity.score=value; assert.throws(()=>parseDecision(raw));
  }
  for (const raw of [null, {answers:[]}, {answers:{}}, {answers:{...response().answers,extra:{type:'choice',choice:'yes'}}}]) assert.throws(()=>parseDecision(raw));
  for (const field of Object.keys(questions).filter(k=>k!=='complexity')) {
    for (const value of ['unknown',null,{},true]) {
      const raw=response();raw.answers[field].choice=value;assert.throws(()=>parseDecision(raw));
    }
  }
});

test('transport uses native Decisions with an abort deadline and no host completion', async () => {
  let request;
  const result=await classify({prompt:'current',recent:'prior',apiKey:'test-only',fetchImpl:async (url,options)=>{
    request={url,...options};return {ok:true,json:async()=>({...response(),usage:{input_tokens:42,output_tokens:7,cost:0.001}})};
  }});
  assert.equal(request.url,'https://openrouter.ai/api/alpha/decisions');
  assert.equal(request.headers.Authorization,'Bearer test-only');
  assert(request.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(request.body).state,{current_request:'current',recent_conversation:'prior'});
  assert.equal(JSON.parse(request.body).model,'typesafe/jev-1.13');
  assert.deepEqual(result.assessment,assessment());
  assert.equal(result.usage.costUsd,0.001);
  await assert.rejects(classify({prompt:'x',apiKey:'',fetchImpl:()=>assert.fail('missing key must not send')}));
  await assert.rejects(classify({prompt:'x',apiKey:'test-only',fetchImpl:async()=>({ok:false,json:()=>assert.fail('do not expose error body')})}),/HTTP error/);
  await assert.rejects(classify({prompt:'x',apiKey:'test-only',timeoutMs:1,fetchImpl:async()=>({ok:true,json:async()=>{await new Promise(r=>setTimeout(r,10));return response();}})}),{name:'TimeoutError'});
});

test('unresolved ordinary requests use Sol low at every score; guards remain independent', () => {
  for(const complexity of [0,25,60,85,100]) {
    const a=assessment({complexity,clarity:'unclear',continuation:true,family:'system_software'});
    assert.equal(chooseRoute(a,{previousTier:'large'}).profile,'routine');
    for(const guard of ['consequential','repeated_failures','long_context']) assert.equal(chooseRoute({...a,guard}).profile,'difficult');
    assert.equal(chooseRoute(a,{inputTokens:150000}).profile,'routine');
    assert.equal(chooseRoute(a,{failures:2}).profile,'difficult');
  }
});

test('general tasks never use Astra, even with extreme scores or prior Astra task', () => {
  for(const clarity of ['clear','unclear']) for(const guard of ['ordinary','consequential','repeated_failures','long_context']) for(const urgency of ['normal','urgent','relaxed']) {
    assert.notEqual(chooseRoute(assessment({complexity:100,clarity,guard,urgency,continuation:true}),{previousTier:'large',inputTokens:200000,failures:3}).tier,'large');
  }
  assert.equal(chooseRoute(assessment({family:'system_software',complexity:80})).profile,'critical');
  assert.equal(chooseRoute(assessment({family:'system_software',complexity:80,urgency:'urgent'})).profile,'urgent_critical');
  assert.equal(chooseRoute(assessment({family:'bounded_software',complexity:80})).profile,'difficult');
  assert.equal(chooseRoute(assessment({family:'bounded_software',complexity:80,urgency:'relaxed'})).profile,'patient');
});

test('unresolved reference overrides clear assessment without weakening guard floors', () => {
  const raw=response();raw.answers.reference_resolution.choice='unresolved';raw.answers.reference_resolution.probabilities={resolved_or_not_needed:0,unresolved:1};
  const a=parseDecision(raw);
  assert.equal(a.clarity,'unclear');
  assert.equal(chooseRoute(a).profile,'routine');
  assert.equal(chooseRoute({...a,guard:'consequential'}).profile,'difficult');
  assert.equal(chooseRoute({...a,family:'system_software',complexity:100}).profile,'routine');
  assert.equal(chooseRoute(a,{inputTokens:150000}).profile,'routine');
});

test('resolved reference never overrides the original unclear assessment', () => {
  const raw=response();raw.answers.clarity.choice='unclear';
  assert.equal(parseDecision(raw).clarity,'unclear');
  assert.equal(chooseRoute(parseDecision(raw)).profile,'routine');
  delete raw.answers.reference_resolution;
  assert.throws(()=>parseDecision(raw));
});

test('only strong reference evidence vetoes a clear request', () => {
  for (const [probability,clarity] of [[0.5,'clear'],[0.94,'clear'],[0.95,'unclear'],[1,'unclear']]) {
    const raw=response();raw.answers.reference_resolution={type:'choice',choice:'unresolved',probabilities:{unresolved:probability,resolved_or_not_needed:1-probability}};
    const a=parseDecision(raw);assert.equal(a.clarity,clarity);assert.equal(a.reference_probability,probability);
  }
});

test('missing or malformed reference probabilities fail closed instead of inventing certainty', () => {
  for (const probabilities of [undefined,null,[],{}, {unresolved:'1',resolved_or_not_needed:0}, {unresolved:NaN,resolved_or_not_needed:0}, {unresolved:1.1,resolved_or_not_needed:-0.1}, {unresolved:1,resolved_or_not_needed:1}, {unresolved:1,resolved_or_not_needed:0,extra:0}]) {
    const raw=response();raw.answers.reference_resolution.probabilities=probabilities;assert.throws(()=>parseDecision(raw));
  }
});
