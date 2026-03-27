import { VoiceAgentEnv } from '../env/environment.js';
import { submissionMatchesTarget } from '../env/answer-utils.js';
import type { Agent } from '../agent/types.js';
import type { EpisodeResult, FailureReason, CallerAction, ProgressSnapshot, ScenarioSpec, EpisodeObservation } from '../env/types.js';
import type { VoiceAgentSemanticEvent, VoiceAgentToolEvent } from '../voice-agent/types.js';
import { Logger } from './logger.js';
import Anthropic from '@anthropic-ai/sdk';

export async function runEpisode(
  env: VoiceAgentEnv,
  agent: Agent,
  spec: ScenarioSpec,
  episodeIndex: number,
  logger: Logger
): Promise<EpisodeResult> {
  let observation: EpisodeObservation = await env.reset(spec);
  agent.reset(spec.brief);
  let progress: ProgressSnapshot = env.getProgressSnapshot(spec);
  const voiceAgentEvents: VoiceAgentSemanticEvent[] = [];
  const voiceAgentToolEvents: VoiceAgentToolEvent[] = [];

  logger.episodeStart(episodeIndex, spec);

  while (!observation.episodeEnded && observation.turnCount < 20) {
    const action = await agent.act(observation);
    const callerAction = toCallerAction(action.toolName, action.arguments);
    logger.agentAction(action, displayTurnNumber(callerAction, observation.turnCount));
    const result = await env.step(callerAction);
    observation = result.observation;
    progress = result.progress;
    voiceAgentEvents.push(...result.voiceAgentEvents);
    voiceAgentToolEvents.push(...result.voiceAgentToolEvents);

    logger.stepResult(result);

    if (result.done) break;
  }

  // Force end if max turns reached
  if (!observation.episodeEnded) {
    const forcedResult = await env.step({ type: 'end_call' });
    observation = forcedResult.observation;
    progress = forcedResult.progress;
  }

  const breakdown = env.getRewardBreakdown();
  const events = breakdown.map(b => b.event);
  const success =
    observation.submittedField !== null &&
    observation.submittedAnswer !== null &&
    submissionMatchesTarget(
      observation.submittedField,
      observation.submittedAnswer,
      spec.brief.targetField,
      spec.targetValue
    );

  let failureReason: FailureReason | undefined;
  if (!success) {
    if (events.includes('WRONG_ANSWER'))          failureReason = 'WRONG_ANSWER';
    else if (events.includes('ANSWERING_MACHINE')) failureReason = 'ANSWERING_MACHINE';
    else if (events.includes('WRONG_NUMBER'))      failureReason = 'WRONG_NUMBER';
    else if (observation.turnCount >= 20)          failureReason = 'MAX_TURNS';
    else                                           failureReason = 'NO_ANSWER';
  }

  const episodeResult: EpisodeResult = {
    episodeIndex,
    spec,
    totalReward: env.getTotalReward(),
    turnCount: observation.turnCount,
    success,
    failureReason,
    submittedField: observation.submittedField,
    submittedAnswer: observation.submittedAnswer,
    rewardBreakdown: breakdown,
    conversationHistory: observation.conversationHistory,
    progress,
    voiceAgentEvents,
    voiceAgentToolEvents,
    callerBehaviorMetrics: env.getCallerBehaviorMetrics(),
  };

  logger.episodeSummary(episodeResult);
  return episodeResult;
}

export async function runEpisodes(
  agent: Agent,
  specs: ScenarioSpec[],
  logger: Logger,
  anthropic: Anthropic
): Promise<EpisodeResult[]> {
  const env = new VoiceAgentEnv(anthropic);
  const results: EpisodeResult[] = [];
  for (let i = 0; i < specs.length; i++) {
    results.push(await runEpisode(env, agent, specs[i], i, logger));
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

function displayTurnNumber(action: CallerAction, currentTurnCount: number): number {
  if (action.type === 'initiate_call' || action.type === 'speak') {
    return currentTurnCount + 1;
  }
  return currentTurnCount;
}
