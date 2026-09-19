import { assessmentSchema, classifierInstructions, parseAssessment } from './policy.js';

export async function classify({ prompt, recent = '', complete, agentId, timeoutMs = 8000 }) {
  const signal = AbortSignal.timeout(timeoutMs);
  const result = await complete({
    model: 'openai-api/gpt-5.6-luna',
    agentId,
    reasoning: 'low',
    purpose: 'model-router: classify difficulty, urgency and scope without solving',
    systemPrompt: `${classifierInstructions}\nOutput must validate against this JSON schema:\n${JSON.stringify(assessmentSchema)}`,
    messages: [{ role: 'user', content: JSON.stringify({ recent_conversation: recent, current_request: prompt }) }],
    maxTokens: 1000,
    signal,
  });
  signal.throwIfAborted();
  return { assessment: parseAssessment(JSON.parse(result.text)), usage: result.usage };
}
