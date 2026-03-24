import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import chalk from 'chalk';
import { LLMAgent } from './agent/llm-agent.js';
import { runEpisode } from './runner/episode-runner.js';
import { VoiceAgentEnv } from './env/environment.js';
import { Logger } from './runner/logger.js';
import { GOLDEN_TASKS } from './env/golden-tasks.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// forceAnswered: true — no random call failures so every run is comparable
const env = new VoiceAgentEnv(anthropic, { forceAnswered: true });
const agent = new LLMAgent(anthropic);
const logger = new Logger();

console.log('');
console.log(chalk.bold.white('▓'.repeat(62)));
console.log(chalk.bold.white(`  GOLDEN TEST RUN — ${GOLDEN_TASKS.length} static scenarios`));
console.log(chalk.bold.white('▓'.repeat(62)));
console.log('');

const results = [];
for (let i = 0; i < GOLDEN_TASKS.length; i++) {
  results.push(await runEpisode(env, agent, GOLDEN_TASKS[i], i, logger));
}

// ── Scorecard ────────────────────────────────────────────────────────────────
const passed  = results.filter(r => r.success).length;
const failed  = results.length - passed;
const allPass = failed === 0;

console.log('');
console.log(chalk.bold.white('╔' + '═'.repeat(60) + '╗'));
console.log(chalk.bold.white('║') + chalk.bold.white(' GOLDEN SCORECARD'.padEnd(60)) + chalk.bold.white('║'));
console.log(chalk.bold.white('╠' + '═'.repeat(60) + '╣'));

for (const r of results) {
  const icon    = r.success ? chalk.green('✓') : chalk.red('✗');
  const outcome = r.success ? chalk.green('PASS') : chalk.red('FAIL');
  const label   = `  ${icon} Task ${r.episodeIndex + 1}: ${r.task.type} / ${r.task.targetField}`;
  const reward  = `reward ${r.totalReward >= 0 ? '+' : ''}${r.totalReward}`;
  const line    = `${label}  (${outcome}, ${reward})`;
  // chalk escape codes add invisible chars — pad the visible portion manually
  const visibleLen = `  - Task ${r.episodeIndex + 1}: ${r.task.type} / ${r.task.targetField}  (${r.success ? 'PASS' : 'FAIL'}, ${reward})`.length;
  const padding = Math.max(0, 60 - visibleLen);
  console.log(chalk.bold.white('║') + line + ' '.repeat(padding) + chalk.bold.white('║'));
}

console.log(chalk.bold.white('╠' + '═'.repeat(60) + '╣'));

const summary = ` Passed: ${passed}/${results.length}`;
const summaryColor = allPass ? chalk.green : chalk.red;
console.log(chalk.bold.white('║') + summaryColor(summary.padEnd(60)) + chalk.bold.white('║'));
console.log(chalk.bold.white('╚' + '═'.repeat(60) + '╝'));
console.log('');

if (!allPass) {
  process.exit(1);
}
