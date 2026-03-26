import { getStringArgValue } from './args.js';
import { createAnthropicClient } from './shared.js';
import { runExperimentStep } from '../runner/run-orchestrator.js';

const experimentId = getStringArgValue('--experiment');
if (!experimentId) {
  throw new Error('Missing required --experiment <id>');
}

const updater = (getStringArgValue('--updater', 'manual') ?? 'manual') as 'manual' | 'llm';
const result = await runExperimentStep({
  anthropic: createAnthropicClient(),
  experimentId,
  updaterMode: updater,
  manualPrompt: getStringArgValue('--prompt-text'),
  manualPromptFile: getStringArgValue('--prompt-file'),
});

console.log(JSON.stringify({
  candidatePolicyId: result.candidatePolicyId,
  promoted: result.promoted,
  baseRuns: result.baseRuns.map((run) => run.artifacts.summary),
  candidateRuns: result.candidateRuns.map((run) => run.artifacts.summary),
  comparisons: result.comparisons,
}, null, 2));
