import 'dotenv/config';
import { resolveExperimentId, resolvePolicyId, createAnthropicClient } from './cli/shared.js';
import { getIntArgValue, getStringArgValue } from './cli/args.js';
import { runScenarioSet } from './runner/run-orchestrator.js';

const anthropic = createAnthropicClient();
const experimentId = await resolveExperimentId(getStringArgValue('--experiment'));
await runScenarioSet({
  anthropic,
  experimentId,
  policyId: await resolvePolicyId({ experimentId, explicitPolicyId: getStringArgValue('--policy') }),
  runType: 'random',
  episodeCount: getIntArgValue('--episodes', parseInt(process.env.N_EPISODES ?? '5', 10)),
});
