import { getStringArgValue } from './args.js';
import { printPolicy } from './shared.js';

const policy = getStringArgValue('--policy', 'baseline');
if (!policy) {
  throw new Error('Missing required --policy <id|baseline>');
}

await printPolicy(policy, getStringArgValue('--experiment'));
