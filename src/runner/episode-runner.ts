import { VoiceAgentEnv } from '../env/environment.js';
import type { Agent } from '../agent/types.js';
import type { Task } from '../env/types.js';
import type { EpisodeResult, FailureReason, CallerAction } from '../env/types.js';
import { Logger } from './logger.js';
import Anthropic from '@anthropic-ai/sdk';

export async function runEpisode(
  env: VoiceAgentEnv,
  agent: Agent,
  task: Task,
  episodeIndex: number,
  logger: Logger
): Promise<EpisodeResult> {
  let state = await env.reset(task);
  agent.reset(task);

  logger.episodeStart(episodeIndex, task);

  while (!state.episodeEnded && state.turnCount < 20) {
    const action = await agent.act(state);
    logger.agentAction(action, state.turnCount + 1);

    const callerAction = toCallerAction(action.toolName, action.arguments);
    const result = await env.step(callerAction);
    state = result.state;

    logger.stepResult(result);

    if (result.done) break;
  }

  // Force end if max turns reached
  if (!state.episodeEnded) {
    await env.step({ type: 'end_call' });
  }

  const breakdown = env.getRewardBreakdown();
  const events = breakdown.map(b => b.event);
  const success = state.submittedAnswer !== null &&
    normalizeAnswer(state.submittedAnswer) === normalizeAnswer(task.targetValue);

  let failureReason: FailureReason | undefined;
  if (!success) {
    if (events.includes('WRONG_ANSWER'))          failureReason = 'WRONG_ANSWER';
    else if (events.includes('ANSWERING_MACHINE')) failureReason = 'ANSWERING_MACHINE';
    else if (events.includes('WRONG_NUMBER'))      failureReason = 'WRONG_NUMBER';
    else if (state.turnCount >= 20)                failureReason = 'MAX_TURNS';
    else                                           failureReason = 'NO_ANSWER';
  }

  const episodeResult: EpisodeResult = {
    episodeIndex,
    task,
    totalReward: env.getTotalReward(),
    turnCount: state.turnCount,
    success,
    failureReason,
    submittedAnswer: state.submittedAnswer,
    rewardBreakdown: breakdown,
    conversationHistory: state.conversationHistory,
  };

  logger.episodeSummary(episodeResult);
  return episodeResult;
}

export async function runEpisodes(
  agent: Agent,
  tasks: Task[],
  logger: Logger,
  anthropic: Anthropic
): Promise<EpisodeResult[]> {
  const env = new VoiceAgentEnv(anthropic);
  const results: EpisodeResult[] = [];
  for (let i = 0; i < tasks.length; i++) {
    results.push(await runEpisode(env, agent, tasks[i], i, logger));
  }
  logger.runSummary(results);
  return results;
}

function toCallerAction(toolName: string, args: Record<string, string>): CallerAction {
  if (toolName === 'initiate_call') {
    return { type: 'initiate_call', target: args['target'] ?? '' };
  }
  if (toolName === 'speak') {
    return { type: 'speak', utterance: args['utterance'] ?? '' };
  }
  if (toolName === 'submit_answer') {
    return { type: 'submit_answer', field: args['field'] ?? '', value: args['value'] ?? '' };
  }
  return { type: 'end_call' };
}

function normalizeAnswer(s: string): string {
  return s.toLowerCase().replace(/[$,_]/g, ' ').replace(/\s+/g, ' ').trim();
}
