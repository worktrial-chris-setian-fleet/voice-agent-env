import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { LLMAgent } from './agent/llm-agent.js';
import { runEpisodes } from './runner/episode-runner.js';
import { Logger } from './runner/logger.js';
import { generateTask } from './env/tasks.js';
import type { TaskType } from './env/types.js';

const argEpisodes = process.argv.indexOf('--episodes');
const N_EPISODES = argEpisodes !== -1
  ? parseInt(process.argv[argEpisodes + 1] ?? '5', 10)
  : parseInt(process.env.N_EPISODES ?? '5', 10);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const logger = new Logger();

// Generate a mix of task types
const TASK_TYPES: TaskType[] = ['SIMPLE_LOOKUP', 'DISAMBIGUATION', 'RESOLVE_THEN_RETRIEVE'];
const specs = Array.from({ length: N_EPISODES }, (_, i) =>
  generateTask({ type: TASK_TYPES[i % TASK_TYPES.length] })
);

const agent = new LLMAgent(anthropic);

await runEpisodes(agent, specs, logger, anthropic);
