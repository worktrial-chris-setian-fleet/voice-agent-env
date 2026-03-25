import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import chalk from 'chalk';
import { LLMAgent } from './agent/llm-agent.js';
import { runEpisode } from './runner/episode-runner.js';
import { VoiceAgentEnv } from './env/environment.js';
import { Logger } from './runner/logger.js';
import { STRESS_TASKS, STRESS_LABELS } from './env/stress-tasks.js';
import type { EpisodeResult } from './env/types.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// forceAnswered: true — call routing randomness would mask policy signal
const env = new VoiceAgentEnv(anthropic, { forceAnswered: true });
const agent = new LLMAgent(anthropic);
const logger = new Logger();

console.log('');
console.log(chalk.bold.yellow('▓'.repeat(62)));
console.log(chalk.bold.yellow(`  STRESS TEST RUN — ${STRESS_TASKS.length} adversarial scenarios`));
console.log(chalk.bold.yellow('▓'.repeat(62)));
console.log('');

const results: EpisodeResult[] = [];
for (let i = 0; i < STRESS_TASKS.length; i++) {
  results.push(await runEpisode(env, agent, STRESS_TASKS[i], i, logger));
}

// ── Scorecard ─────────────────────────────────────────────────────────────────
const passed   = results.filter(r => r.success).length;
const avgReward = (results.reduce((s, r) => s + r.totalReward, 0) / results.length).toFixed(1);
const avgTurns  = (results.reduce((s, r) => s + r.turnCount, 0) / results.length).toFixed(1);

console.log('');
console.log(chalk.bold.yellow('╔' + '═'.repeat(70) + '╗'));
console.log(chalk.bold.yellow('║') + chalk.bold.yellow(' STRESS SCORECARD'.padEnd(70)) + chalk.bold.yellow('║'));
console.log(chalk.bold.yellow('║') + chalk.dim(' Metric: reward score. Some failures are expected.'.padEnd(70)) + chalk.bold.yellow('║'));
console.log(chalk.bold.yellow('╠' + '═'.repeat(70) + '╣'));

// Header row
const header = '  Scenario                                      Pass    Reward  Turns';
console.log(chalk.bold.yellow('║') + chalk.bold.white(header.padEnd(70)) + chalk.bold.yellow('║'));
console.log(chalk.bold.yellow('╠' + '─'.repeat(70) + '╣'));

for (let i = 0; i < results.length; i++) {
  const r = results[i];
  const label = STRESS_LABELS[i] ?? `S${i + 1}`;
  const icon = r.success ? chalk.green('PASS') : chalk.red('FAIL');
  const rewardStr = `${r.totalReward >= 0 ? '+' : ''}${r.totalReward}`;
  const rewardColor = r.totalReward >= 6 ? chalk.green : r.totalReward >= 2 ? chalk.yellow : chalk.red;

  const col = label.length > 46 ? label.slice(0, 45) + '…' : label.padEnd(46);
  const visibleLine = `  ${col}${r.success ? 'PASS' : 'FAIL'}    ${rewardStr.padStart(4)}    ${String(r.turnCount).padStart(3)}`;
  const padding = Math.max(0, 70 - visibleLine.length);

  const coloredLine = `  ${col}${icon}    ${rewardColor(rewardStr.padStart(4))}    ${String(r.turnCount).padStart(3)}`;
  console.log(chalk.bold.yellow('║') + coloredLine + ' '.repeat(padding) + chalk.bold.yellow('║'));
}

console.log(chalk.bold.yellow('╠' + '═'.repeat(70) + '╣'));

const passRate = `${passed}/${results.length} passed`;
const summary  = `  ${passRate}   avg reward: ${avgReward}   avg turns: ${avgTurns}`;
const summaryColor = passed === results.length ? chalk.green : passed >= results.length * 0.75 ? chalk.yellow : chalk.red;
console.log(chalk.bold.yellow('║') + summaryColor(summary.padEnd(70)) + chalk.bold.yellow('║'));
console.log(chalk.bold.yellow('╚' + '═'.repeat(70) + '╝'));
console.log('');
