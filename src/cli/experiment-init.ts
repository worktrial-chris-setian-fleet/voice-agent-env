import { getStringArgValue } from './args.js';
import { initExperimentFromCli } from './shared.js';

await initExperimentFromCli(getStringArgValue('--label'), getStringArgValue('--notes'));
