import Anthropic from '@anthropic-ai/sdk';
import { createCrmMcpPair } from '../mcp/server.js';
import { VoiceAgent } from '../voice-agent/voice-agent.js';
import { REWARD, turnPenalty } from './reward.js';
import { evaluateCallerDisambiguationTurn } from './caller-disambiguation.js';
import {
  answersMatch,
  fieldsMatch,
  makeClueKey,
  normalizeAnswer,
  normalizeFieldName,
  submissionMatchesTarget,
} from './answer-utils.js';
import type {
  CallerAction,
  EpisodeObservation,
  InvalidActionReason,
  InternalEpisodeState,
  ProgressPhase,
  ProgressSnapshot,
  ProgressUpdate,
  CallerBehaviorEvaluation,
  CallerBehaviorMetrics,
  ResolutionClue,
  RewardEvent,
  ScenarioSpec,
  StepResult,
} from './types.js';
import type { McpPair } from '../mcp/server.js';
import type { CallState } from '../dialogue/types.js';
import { buildVoiceAgentSessionConfig, hasResolutionClues } from './scenarios/index.js';
import type {
  VoiceAgentSemanticEvent,
  VoiceAgentToolEvent,
} from '../voice-agent/types.js';

export interface EnvOptions {
  /** Force every initiate_call to ANSWERED — useful for golden/regression runs. */
  forceAnswered?: boolean;
}

function pickCallOutcome(): 'ANSWERED' | 'ANSWERING_MACHINE' | 'WRONG_NUMBER' | 'NO_ANSWER' {
  const r = Math.random();
  if (r < 0.80) return 'ANSWERED';
  if (r < 0.90) return 'ANSWERING_MACHINE';
  if (r < 0.95) return 'WRONG_NUMBER';
  return 'NO_ANSWER';
}

export class VoiceAgentEnv {
  private anthropic: Anthropic;
  private forceAnswered: boolean;
  private pair: McpPair | null = null;
  private voiceAgent: VoiceAgent | null = null;
  private state: InternalEpisodeState | null = null;
  private rewardBreakdown: { event: RewardEvent; amount: number }[] = [];
  private totalReward = 0;
  private penaltyTurnCount = 0;
  private callAttemptCount = 0;
  private matchedResolutionClues = new Set<string>();
  private targetFieldObserved = false;
  private resolvedCompanyName: string | null = null;
  private askedDisambiguationKeys = new Set<string>();
  private callerBehaviorMetrics: CallerBehaviorMetrics = emptyCallerBehaviorMetrics();

  constructor(anthropic: Anthropic, options: EnvOptions = {}) {
    this.anthropic = anthropic;
    this.forceAnswered = options.forceAnswered ?? false;
  }

  async reset(spec: ScenarioSpec): Promise<EpisodeObservation> {
    if (this.pair) {
      try { await this.pair.client.close(); } catch { /* ignore */ }
      try {
        const s = this.pair.mcpServer as unknown as { close?: () => Promise<void> };
        if (typeof s.close === 'function') await s.close();
      } catch { /* ignore */ }
    }

    this.pair = await createCrmMcpPair();
    this.voiceAgent = new VoiceAgent(this.anthropic, this.pair.client);
    this.rewardBreakdown = [];
    this.totalReward = 0;
    this.penaltyTurnCount = 0;
    this.callAttemptCount = 0;
    this.matchedResolutionClues = new Set();
    this.targetFieldObserved = false;
    this.resolvedCompanyName = null;
    this.askedDisambiguationKeys = new Set();
    this.callerBehaviorMetrics = emptyCallerBehaviorMetrics();

    const observation: EpisodeObservation = {
      brief: spec.brief,
      conversationHistory: [],
      lastResponse: 'Episode started. Use initiate_call to begin.',
      callState: 'IDLE',
      turnCount: 0,
      episodeEnded: false,
      submittedField: null,
      submittedAnswer: null,
    };

    this.state = { spec, observation };
    this.voiceAgent.reset(buildVoiceAgentSessionConfig(spec));
    return { ...observation };
  }

  async step(action: CallerAction): Promise<StepResult> {
    if (!this.pair || !this.voiceAgent || !this.state) throw new Error('Call reset() first');
    if (this.state.observation.episodeEnded) throw new Error('Episode already ended');

    const { spec, observation } = this.state;

    let stepReward = 0;
    const rewardEvents: RewardEvent[] = [];
    const stepRewardBreakdown: { event: RewardEvent; amount: number }[] = [];
    let responseText = '';
    let done = false;
    let newCallState: CallState = observation.callState;
    const newHistory = [...observation.conversationHistory];
    let submittedField = observation.submittedField;
    let submittedAnswer = observation.submittedAnswer;
    let voiceAgentEvents: VoiceAgentSemanticEvent[] = [];
    let voiceAgentToolEvents: VoiceAgentToolEvent[] = [];
    let callerBehaviorEvaluation: CallerBehaviorEvaluation | null = null;
    let invalidActionReason: InvalidActionReason | undefined;
    const previousPhase = this.getProgressPhase(spec);
    let progressUpdate: ProgressUpdate = {
      newlyConfirmedClues: [],
      targetFieldObservedThisTurn: false,
      phaseChangedTo: null,
      resolvedCompanyNameThisTurn: null,
    };

    const addReward = (event: RewardEvent, amount: number) => {
      rewardEvents.push(event);
      stepRewardBreakdown.push({ event, amount });
      stepReward += amount;
      this.rewardBreakdown.push({ event, amount });
    };

    const isFirstDialAttempt = action.type === 'initiate_call' && this.callAttemptCount === 0;
    const consumesTurn = action.type === 'initiate_call' || action.type === 'speak';
    const incursTurnPenalty = action.type === 'speak' || (action.type === 'initiate_call' && !isFirstDialAttempt);
    const invalidReason = validateAction(observation.callState, action);

    if (incursTurnPenalty) {
      this.penaltyTurnCount++;
      addReward('TURN_PENALTY', turnPenalty(this.penaltyTurnCount));
    }

    if (invalidReason) {
      invalidActionReason = invalidReason;
      addReward('INVALID_ACTION', REWARD.INVALID_ACTION);
      responseText = invalidActionMessage(invalidReason);
    } else if (action.type === 'initiate_call') {
      this.callAttemptCount++;
      const outcome = this.forceAnswered ? 'ANSWERED' : pickCallOutcome();
      newHistory.push({ speaker: 'CALLER', utterance: `[dials ${action.target}]` });

      if (outcome === 'ANSWERED') {
        newCallState = 'CONVERSATION';
        this.voiceAgent.reset(buildVoiceAgentSessionConfig(spec));
        responseText = 'Call connected.';
        newHistory.push({ speaker: 'VOICE_AGENT', utterance: responseText });
      } else {
        if (outcome === 'ANSWERING_MACHINE') {
          responseText = 'Reached answering machine.';
          addReward('ANSWERING_MACHINE', REWARD.ANSWERING_MACHINE);
        } else if (outcome === 'WRONG_NUMBER') {
          responseText = 'Wrong number.';
          addReward('WRONG_NUMBER', REWARD.WRONG_NUMBER);
        } else {
          responseText = 'No answer.';
        }
        newCallState = outcome;
        newHistory.push({ speaker: 'VOICE_AGENT', utterance: responseText });
      }
    } else if (action.type === 'speak') {
      callerBehaviorEvaluation = evaluateCallerDisambiguationTurn({
        spec,
        utterance: action.utterance,
        ambiguityActive: this.isCallerAmbiguityActive(spec, previousPhase),
        askedDisambiguationKeys: this.askedDisambiguationKeys,
      });
      this.applyCallerBehaviorReward(callerBehaviorEvaluation, addReward);
      this.recordCallerBehaviorEvaluation(callerBehaviorEvaluation);
      newHistory.push({ speaker: 'CALLER', utterance: action.utterance });
      const voiceAgentTurn = await this.voiceAgent.handleUtterance(action.utterance);
      responseText = voiceAgentTurn.text;
      voiceAgentEvents = voiceAgentTurn.semanticEvents;
      voiceAgentToolEvents = voiceAgentTurn.toolEvents;
      progressUpdate = this.applyVoiceAgentEvents(spec, voiceAgentEvents, addReward);
      newHistory.push({ speaker: 'VOICE_AGENT', utterance: responseText });
    } else if (action.type === 'submit_answer') {
      done = true;
      newCallState = 'ENDED';
      submittedField = action.field;
      submittedAnswer = action.value;
      if (submissionMatchesTarget(action.field, action.value, spec.brief.targetField, spec.targetValue)) {
        addReward('CORRECT_ANSWER', REWARD.CORRECT_ANSWER);
      } else {
        addReward('WRONG_ANSWER', REWARD.WRONG_ANSWER);
      }
      responseText = `Answer submitted: ${action.field} = ${action.value}`;
    } else if (action.type === 'end_call') {
      done = true;
      newCallState = 'ENDED';
      addReward('CALL_ENDED_NO_ANSWER', REWARD.CALL_ENDED_NO_ANSWER);
      responseText = 'Call ended.';
    }

    this.totalReward += stepReward;
    const progress = this.getProgressSnapshot(spec);
    if (
      this.callerBehaviorMetrics.turnsToResolution === null &&
      this.resolvedCompanyName !== null &&
      this.callerBehaviorMetrics.ambiguousTurns > 0 &&
      (spec.brief.type === 'DISAMBIGUATION' || spec.brief.type === 'RESOLVE_THEN_RETRIEVE')
    ) {
      this.callerBehaviorMetrics.turnsToResolution = this.callerBehaviorMetrics.ambiguousTurns;
    }
    progressUpdate.phaseChangedTo = progress.phase !== previousPhase ? progress.phase : null;

    const nextObservation: EpisodeObservation = {
      ...observation,
      conversationHistory: newHistory,
      lastResponse: responseText,
      callState: newCallState,
      turnCount: consumesTurn ? observation.turnCount + 1 : observation.turnCount,
      episodeEnded: done,
      submittedField,
      submittedAnswer,
    };

    this.state = {
      spec,
      observation: nextObservation,
    };

    return {
      observation: { ...nextObservation },
      reward: stepReward,
      done,
      rewardEvents,
      stepRewardBreakdown,
      callerBehaviorEvaluation,
      invalidActionReason,
      voiceAgentEvents,
      voiceAgentToolEvents,
      progress,
      progressUpdate,
    };
  }

  getRewardBreakdown() { return [...this.rewardBreakdown]; }
  getTotalReward() { return this.totalReward; }
  getCallerBehaviorMetrics() { return { ...this.callerBehaviorMetrics }; }

  getProgressSnapshot(spec: ScenarioSpec): ProgressSnapshot {
    return {
      phase: this.getProgressPhase(spec),
      resolutionCluesMatched: this.matchedResolutionClues.size,
      totalResolutionClues: spec.resolutionClues?.length ?? 0,
      targetFieldObserved: this.targetFieldObserved,
      resolvedCompanyName: this.resolvedCompanyName,
    };
  }

  private applyVoiceAgentEvents(
    spec: ScenarioSpec,
    voiceAgentEvents: VoiceAgentSemanticEvent[],
    addReward: (event: RewardEvent, amount: number) => void
  ): ProgressUpdate {
    const progressUpdate: ProgressUpdate = {
      newlyConfirmedClues: [],
      targetFieldObservedThisTurn: false,
      phaseChangedTo: null,
      resolvedCompanyNameThisTurn: null,
    };

    const resolvedEvent = voiceAgentEvents.find((event): event is Extract<VoiceAgentSemanticEvent, { type: 'account_resolved' }> =>
      event.type === 'account_resolved' && event.accountId === spec.targetAccountId
    );
    if (resolvedEvent && this.resolvedCompanyName === null) {
      this.resolvedCompanyName = resolvedEvent.companyName;
      progressUpdate.resolvedCompanyNameThisTurn = resolvedEvent.companyName;
    }

    if (spec.brief.type === 'RESOLVE_THEN_RETRIEVE' && spec.resolutionClues && spec.resolutionClues.length > 0) {
      for (const clue of spec.resolutionClues) {
        const clueKey = makeClueKey(clue.field, clue.value);
        if (this.matchedResolutionClues.has(clueKey)) continue;

        const matchingEvent = voiceAgentEvents.find((event): event is Extract<VoiceAgentSemanticEvent, { type: 'resolution_clue_confirmed' }> =>
          event.type === 'resolution_clue_confirmed' &&
          event.accountId === spec.targetAccountId &&
          normalizeFieldName(event.clue.field) === normalizeFieldName(clue.field) &&
          answersMatch(normalizeAnswer(event.clue.value), normalizeAnswer(clue.value))
        );

        if (matchingEvent) {
          this.matchedResolutionClues.add(clueKey);
          progressUpdate.newlyConfirmedClues.push(clue.label);

          if (
            this.matchedResolutionClues.size === spec.resolutionClues.length &&
            this.resolvedCompanyName === null
          ) {
            this.resolvedCompanyName = matchingEvent.companyName;
            progressUpdate.resolvedCompanyNameThisTurn = matchingEvent.companyName;
          }
        }
      }
    }

    if (!this.targetFieldObserved) {
      const observedTargetField = voiceAgentEvents.some((event) =>
        event.type === 'field_returned' &&
        event.accountId === spec.targetAccountId &&
        normalizeFieldName(event.field) === normalizeFieldName(spec.brief.targetField)
      );

      if (observedTargetField) {
        this.targetFieldObserved = true;
        progressUpdate.targetFieldObservedThisTurn = true;
      }
    }

    if (this.resolvedCompanyName === null) {
      const observedTargetAccount = voiceAgentEvents.find((event): event is Extract<VoiceAgentSemanticEvent, { type: 'field_returned' }> =>
        event.type === 'field_returned' && event.accountId === spec.targetAccountId
      );
      if (observedTargetAccount) {
        this.resolvedCompanyName = observedTargetAccount.companyName;
        progressUpdate.resolvedCompanyNameThisTurn = observedTargetAccount.companyName;
      }
    }

    return progressUpdate;
  }

  private getProgressPhase(spec: ScenarioSpec): ProgressPhase {
    if (!hasResolutionClues(spec)) {
      return 'DIRECT';
    }
    if (this.targetFieldObserved) {
      return 'RETRIEVED';
    }
    if (this.matchedResolutionClues.size >= spec.resolutionClues.length) {
      return 'AWAITING_FOLLOW_UP';
    }
    return 'RESOLVING';
  }

  private isCallerAmbiguityActive(spec: ScenarioSpec, phase: ProgressPhase): boolean {
    if (spec.brief.type === 'DISAMBIGUATION') return this.resolvedCompanyName === null && !this.targetFieldObserved;
    if (spec.brief.type === 'RESOLVE_THEN_RETRIEVE') return phase === 'RESOLVING';
    return false;
  }

  private recordCallerBehaviorEvaluation(evaluation: CallerBehaviorEvaluation): void {
    if (!evaluation.applicable || !evaluation.ambiguityActive) return;

    this.callerBehaviorMetrics.ambiguousTurns++;
    for (const key of evaluation.disambiguationKeys) {
      this.askedDisambiguationKeys.add(key);
    }

    if (evaluation.label === 'GOOD_DISAMBIGUATION_QUESTION') {
      this.callerBehaviorMetrics.goodDisambiguationQuestions++;
    } else if (evaluation.label === 'PREMATURE_TARGET_REQUEST') {
      this.callerBehaviorMetrics.prematureTargetRequests++;
    } else if (evaluation.label === 'REDUNDANT_DISAMBIGUATION') {
      this.callerBehaviorMetrics.redundantClarifications++;
    }
  }

  private applyCallerBehaviorReward(
    evaluation: CallerBehaviorEvaluation,
    addReward: (event: RewardEvent, amount: number) => void
  ): void {
    if (!evaluation.applicable || !evaluation.ambiguityActive || evaluation.label === null) return;
    addReward(evaluation.label, REWARD[evaluation.label]);
  }
}

function emptyCallerBehaviorMetrics(): CallerBehaviorMetrics {
  return {
    ambiguousTurns: 0,
    goodDisambiguationQuestions: 0,
    prematureTargetRequests: 0,
    redundantClarifications: 0,
    turnsToResolution: null,
  };
}

function validateAction(callState: CallState, action: CallerAction): InvalidActionReason | null {
  if (callState === 'ENDED') return null;

  if (callState === 'CONVERSATION') {
    if (action.type === 'initiate_call') return 'CANNOT_INITIATE_DURING_CONVERSATION';
    return null;
  }

  if (action.type === 'speak') {
    return 'CANNOT_SPEAK_WITHOUT_CONNECTION';
  }

  if (action.type === 'submit_answer') {
    return 'CANNOT_SUBMIT_WITHOUT_CONNECTION';
  }

  return null;
}

function invalidActionMessage(reason: InvalidActionReason): string {
  switch (reason) {
    case 'CANNOT_INITIATE_DURING_CONVERSATION':
      return 'Cannot initiate a new call while already connected. Either continue the conversation or end the call.';
    case 'CANNOT_SPEAK_WITHOUT_CONNECTION':
      return 'Cannot speak before the call is connected. Initiate or retry the call first.';
    case 'CANNOT_SUBMIT_WITHOUT_CONNECTION':
      return 'Cannot submit an answer before reaching the voice agent. Initiate or retry the call first.';
  }
}
