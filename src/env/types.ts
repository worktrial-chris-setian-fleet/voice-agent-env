import type { DialogueTurn, CallState } from '../dialogue/types.js';
import type { QueryableField } from '../crm/types.js';

export type TaskType = 'SIMPLE_LOOKUP' | 'DISAMBIGUATION';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type CallerPersona = 'professional' | 'casual' | 'assertive' | 'uncertain';
export type QueryStyle = 'direct' | 'conversational' | 'verify';

export interface Task {
  type: TaskType;
  description: string;         // fed to the agent as the task prompt
  targetAccountId: string;     // ground truth — never shown to agent
  targetField: QueryableField;
  targetValue: string;         // normalized ground truth answer
  ambiguousName?: string;      // for DISAMBIGUATION: the name with multiple matches
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
  | 'TURN_PENALTY';

export interface EpisodeState {
  task: Task;
  conversationHistory: DialogueTurn[];
  lastResponse: string;
  callState: CallState;
  turnCount: number;
  episodeEnded: boolean;
  submittedAnswer: string | null;
}

export interface StepResult {
  state: EpisodeState;
  reward: number;
  done: boolean;
  rewardEvents: RewardEvent[];
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
  submittedAnswer: string | null;
  rewardBreakdown: { event: RewardEvent; amount: number }[];
  conversationHistory: DialogueTurn[];
}

export type CallerAction =
  | { type: 'initiate_call'; target: string }
  | { type: 'speak'; utterance: string }
  | { type: 'submit_answer'; field: string; value: string }
  | { type: 'end_call' };
