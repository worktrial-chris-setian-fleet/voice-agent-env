import { getStringArgValue } from './args.js';
import { printExperiment } from './shared.js';

const experimentId = getStringArgValue('--experiment');
if (!experimentId) {
  throw new Error('Missing required --experiment <id>');
}

await printExperiment(experimentId);
