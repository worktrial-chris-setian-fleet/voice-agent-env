import 'dotenv/config';
import { resolveExperimentId, resolvePolicyId, createAnthropicClient } from './cli/shared.js';
import { getStringArgValue } from './cli/args.js';
import { runScenarioSet } from './runner/run-orchestrator.js';

const experimentId = await resolveExperimentId(getStringArgValue('--experiment'));
await runScenarioSet({
  anthropic: createAnthropicClient(),
  experimentId,
  policyId: await resolvePolicyId({ experimentId, explicitPolicyId: getStringArgValue('--policy') }),
  runType: 'stress',
});
