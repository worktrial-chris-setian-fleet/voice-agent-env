import { getStringArgValue } from './args.js';
import { initExperimentFromCli } from './shared.js';

const label = getStringArgValue('--label') ?? `reset-${new Date().toISOString().slice(0, 10)}`;
await initExperimentFromCli(label, 'Fresh experiment created from immutable baseline.');
