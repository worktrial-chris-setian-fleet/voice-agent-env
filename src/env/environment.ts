import Anthropic from '@anthropic-ai/sdk';
import { createCrmMcpPair } from '../mcp/server.js';
import { VoiceAgent } from '../voice-agent/voice-agent.js';
import { computeReward, REWARD } from './reward.js';
import type { Task, EpisodeState, StepResult, RewardEvent, CallerAction } from './types.js';
import type { McpPair } from '../mcp/server.js';
import type { CallState } from '../dialogue/types.js';

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
  private state: EpisodeState | null = null;
  private rewardBreakdown: { event: RewardEvent; amount: number }[] = [];
  private totalReward = 0;

  constructor(anthropic: Anthropic, options: EnvOptions = {}) {
    this.anthropic = anthropic;
    this.forceAnswered = options.forceAnswered ?? false;
  }

  async reset(task: Task): Promise<EpisodeState> {
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
    this.state = {
      task,
      conversationHistory: [],
      lastResponse: 'Episode started. Use initiate_call to begin.',
      callState: 'IDLE',
      turnCount: 0,
      episodeEnded: false,
      submittedAnswer: null,
    };
    return { ...this.state };
  }

  async step(action: CallerAction): Promise<StepResult> {
    if (!this.pair || !this.voiceAgent || !this.state) throw new Error('Call reset() first');
    if (this.state.episodeEnded) throw new Error('Episode already ended');

    const rewardEvents: RewardEvent[] = [];
    let responseText = '';
    let done = false;
    let newCallState: CallState = this.state.callState;
    const newHistory = [...this.state.conversationHistory];

    if (action.type === 'initiate_call') {
      rewardEvents.push('TURN_PENALTY');
      const outcome = this.forceAnswered ? 'ANSWERED' : pickCallOutcome();
      newHistory.push({ speaker: 'CALLER', utterance: `[dials ${action.target}]` });

      if (outcome === 'ANSWERED') {
        newCallState = 'CONVERSATION';
        this.voiceAgent.reset();
        responseText = 'Call connected.';
        newHistory.push({ speaker: 'VOICE_AGENT', utterance: responseText });
      } else {
        if (outcome === 'ANSWERING_MACHINE') {
          responseText = 'Reached answering machine.';
          rewardEvents.push('ANSWERING_MACHINE');
        } else if (outcome === 'WRONG_NUMBER') {
          responseText = "Wrong number.";
          rewardEvents.push('WRONG_NUMBER');
        } else {
          responseText = 'No answer.';
        }
        newCallState = outcome;
        newHistory.push({ speaker: 'VOICE_AGENT', utterance: responseText });
      }

    } else if (action.type === 'speak') {
      rewardEvents.push('TURN_PENALTY');
      newHistory.push({ speaker: 'CALLER', utterance: action.utterance });
      responseText = await this.voiceAgent.handleUtterance(action.utterance);
      newHistory.push({ speaker: 'VOICE_AGENT', utterance: responseText });

    } else if (action.type === 'submit_answer') {
      done = true;
      newCallState = 'ENDED';
      this.state.submittedAnswer = action.value;
      const submitted = normalizeAnswer(action.value);
      const target = normalizeAnswer(this.state.task.targetValue);
      if (answersMatch(submitted, target)) {
        rewardEvents.push('CORRECT_ANSWER');
      } else {
        rewardEvents.push('WRONG_ANSWER');
      }
      responseText = `Answer submitted: ${action.field} = ${action.value}`;

    } else if (action.type === 'end_call') {
      done = true;
      newCallState = 'ENDED';
      rewardEvents.push('CALL_ENDED_NO_ANSWER');
      responseText = 'Call ended.';
    }

    const stepReward = computeReward(rewardEvents);
    this.totalReward += stepReward;
    for (const e of rewardEvents) {
      this.rewardBreakdown.push({ event: e, amount: REWARD[e] });
    }

    this.state = {
      ...this.state,
      conversationHistory: newHistory,
      lastResponse: responseText,
      callState: newCallState,
      turnCount: action.type === 'speak' ? this.state.turnCount + 1 : this.state.turnCount,
      episodeEnded: done,
    };

    return { state: { ...this.state }, reward: stepReward, done, rewardEvents };
  }

  getRewardBreakdown() { return [...this.rewardBreakdown]; }
  getTotalReward() { return this.totalReward; }
}

function normalizeAnswer(s: string): string {
  return s.toLowerCase().replace(/[$,_]/g, ' ').replace(/\s+/g, ' ').trim();
}

function answersMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb)) return Math.abs(na - nb) < 0.01;
  return false;
}
