import type { DialogueTurn, CallState } from '../dialogue/types.js';
import type { QueryableField } from '../crm/types.js';
import type { VoiceAgentEvent } from '../voice-agent/types.js';

export type TaskType = 'SIMPLE_LOOKUP' | 'DISAMBIGUATION' | 'RESOLVE_THEN_RETRIEVE';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type CallerPersona = 'professional' | 'casual' | 'assertive' | 'uncertain';
export type QueryStyle = 'direct' | 'conversational' | 'verify';
export type ProgressPhase = 'DIRECT' | 'RESOLVING' | 'AWAITING_FOLLOW_UP' | 'RETRIEVED';

export interface ResolutionClue {
  field: QueryableField;
  value: string;
  label: string;
}

export interface Task {
  type: TaskType;
  description: string;         // fed to the agent as the task prompt
  targetAccountId: string;     // ground truth — never shown to agent
  targetField: QueryableField;
  targetValue: string;         // normalized ground truth answer
  ambiguousName?: string;      // for DISAMBIGUATION: the name with multiple matches
  callTarget?: string;         // the initial entity the caller should dial for multistep tasks
  resolutionClues?: ResolutionClue[];
  difficulty: Difficulty;
  callerPersona: CallerPersona;
  queryStyle: QueryStyle;
}

export type RewardEvent =
  | 'CORRECT_ANSWER'
  | 'WRONG_ANSWER'
  | 'CALL_ENDED_NO_ANSWER'
  | 'ANSWERING_MACHINE'
  | 'WRONG_NUMBER'
  | 'RESOLUTION_CLUE_CONFIRMED'
  | 'TARGET_FIELD_OBSERVED'
  | 'TURN_PENALTY';

export interface ProgressSnapshot {
  phase: ProgressPhase;
  resolutionCluesMatched: number;
  totalResolutionClues: number;
  targetFieldObserved: boolean;
  resolvedCompanyName: string | null;
}

export interface ProgressUpdate {
  newlyConfirmedClues: string[];
  targetFieldObservedThisTurn: boolean;
  phaseChangedTo: ProgressPhase | null;
  resolvedCompanyNameThisTurn: string | null;
}

export interface EpisodeState {
  task: Task;
  conversationHistory: DialogueTurn[];
  lastResponse: string;
  callState: CallState;
  turnCount: number;
  episodeEnded: boolean;
  submittedField: string | null;
  submittedAnswer: string | null;
}

export interface StepResult {
  state: EpisodeState;
  reward: number;
  done: boolean;
  rewardEvents: RewardEvent[];
  voiceAgentEvents: VoiceAgentEvent[];
  progress: ProgressSnapshot;
  progressUpdate: ProgressUpdate;
}

export type FailureReason =
  | 'WRONG_ANSWER'
  | 'NO_ANSWER'
  | 'ANSWERING_MACHINE'
  | 'WRONG_NUMBER'
  | 'MAX_TURNS';

export interface EpisodeResult {
  episodeIndex: number;
  task: Task;
  totalReward: number;
  turnCount: number;
  success: boolean;
  failureReason?: FailureReason;
  submittedField: string | null;
  submittedAnswer: string | null;
  rewardBreakdown: { event: RewardEvent; amount: number }[];
  conversationHistory: DialogueTurn[];
  progress: ProgressSnapshot;
  voiceAgentEvents: VoiceAgentEvent[];
}

export type CallerAction =
  | { type: 'initiate_call'; target: string }
  | { type: 'speak'; utterance: string }
  | { type: 'submit_answer'; field: string; value: string }
  | { type: 'end_call' };
