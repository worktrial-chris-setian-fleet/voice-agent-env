import { getIntArgValue, getStringArgValue } from './args.js';
import { createAnthropicClient } from './shared.js';
import { runExperimentLoop } from '../runner/run-orchestrator.js';

const experimentId = getStringArgValue('--experiment');
if (!experimentId) {
  throw new Error('Missing required --experiment <id>');
}

const updater = (getStringArgValue('--updater', 'manual') ?? 'manual') as 'manual' | 'llm';
const iterations = getIntArgValue('--iterations', 1);

const results = await runExperimentLoop({
  anthropic: createAnthropicClient(),
  experimentId,
  iterations,
  updaterMode: updater,
  manualPrompt: getStringArgValue('--prompt-text'),
  manualPromptFile: getStringArgValue('--prompt-file'),
});

console.log(JSON.stringify(results.map((result, index) => ({
  iteration: index + 1,
  candidatePolicyId: result.candidatePolicyId,
  promoted: result.promoted,
})), null, 2));
