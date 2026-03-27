import type { DialogueTurn, CallState } from '../dialogue/types.js';
import type { QueryableField } from '../crm/types.js';
import type { VoiceAgentSemanticEvent, VoiceAgentToolEvent } from '../voice-agent/types.js';

/** Supported scenario families that define the caller's retrieval path. */
export type TaskType = 'SIMPLE_LOOKUP' | 'DISAMBIGUATION' | 'RESOLVE_THEN_RETRIEVE';
/** Coarse difficulty bucket used when generating scenarios. */
export type Difficulty = 'easy' | 'medium' | 'hard';
/** High-level caller tone used to vary task phrasing and agent behavior pressure. */
export type CallerPersona = 'professional' | 'casual' | 'assertive' | 'uncertain';
/** Prompting style for the caller's task brief. */
export type QueryStyle = 'direct' | 'conversational' | 'verify';
/** Internal multistep progress phase for environment scoring and logging. */
export type ProgressPhase = 'DIRECT' | 'RESOLVING' | 'AWAITING_FOLLOW_UP' | 'RETRIEVED';

/** One disambiguating fact the caller must use to resolve the correct account. */
export interface ResolutionClue {
  /** CRM field that carries the clue. */
  field: QueryableField;
  /** Exact ground-truth value the environment expects to be surfaced. */
  value: string;
  /** Human-readable label for logs and progress displays. */
  label: string;
}

/**
 * Caller-visible reset payload.
 * This is the "assignment" for the RL subject and must not include hidden ground truth.
 */
export interface CallerBrief {
  /** Scenario family the caller is about to solve. */
  type: TaskType;
  /** Natural-language task description shown to the caller agent. */
  instructions: string;
  /** Final CRM field the caller is expected to retrieve and submit. */
  targetField: QueryableField;
}

/**
 * Environment-private scenario specification.
 * This combines caller-visible brief text with hidden evaluation ground truth.
 */
export interface ScenarioSpec {
  /** Caller-visible instructions and target field for this episode. */
  brief: CallerBrief;
  /** Hidden CRM account ID that represents the correct underlying answer source. */
  targetAccountId: string;
  /** Hidden expected final answer value used for scoring submissions. */
  targetValue: string;
  /** Difficulty metadata for generation, analysis, and evaluation slicing. */
  difficulty: Difficulty;
  /** Persona metadata used to shape task wording and later policy analysis. */
  callerPersona: CallerPersona;
  /** Query style metadata used to shape task wording and later policy analysis. */
  queryStyle: QueryStyle;
  /** Optional ambiguous contact name used by disambiguation-style scenarios. */
  ambiguousName?: string;
  /** Optional initial dial target when the caller should not start with the full company name. */
  callTarget?: string;
  /** Optional clue set required to resolve the right account before retrieval. */
  resolutionClues?: ResolutionClue[];
}

/**
 * Caller-visible observation after each environment step.
 * This is the full state the RL subject is allowed to condition on.
 */
export interface EpisodeObservation {
  /** Original caller-visible episode brief for reference across turns. */
  brief: CallerBrief;
  /** Complete dialogue history observed by the caller so far. */
  conversationHistory: DialogueTurn[];
  /** Most recent voice-agent or environment response text. */
  lastResponse: string;
  /** Current call lifecycle state. */
  callState: CallState;
  /** Count of turn-consuming caller actions taken so far. */
  turnCount: number;
  /** Whether the episode has terminated. */
  episodeEnded: boolean;
  /** Last submitted field, if the caller has attempted a final answer. */
  submittedField: string | null;
  /** Last submitted value, if the caller has attempted a final answer. */
  submittedAnswer: string | null;
}

/**
 * Full environment-owned episode state.
 * This wraps the hidden scenario spec together with the public observation.
 */
export interface InternalEpisodeState {
  /** Private scenario ground truth and generation metadata. */
  spec: ScenarioSpec;
  /** Public observation that is safe to expose to the caller agent. */
  observation: EpisodeObservation;
}

/** Reward event categories used for breakdowns, shaping, and later trajectory analysis. */
export type RewardEvent =
  | 'CORRECT_ANSWER'
  | 'WRONG_ANSWER'
  | 'CALL_ENDED_NO_ANSWER'
  | 'ANSWERING_MACHINE'
  | 'WRONG_NUMBER'
  | 'INVALID_ACTION'
  | 'RESOLUTION_CLUE_CONFIRMED'
  | 'TARGET_FIELD_OBSERVED'
  | 'TURN_PENALTY';

/** Caller-attributed disambiguation labels used for instrumentation and future reward shaping. */
export type CallerBehaviorLabel =
  | 'GOOD_DISAMBIGUATION_QUESTION'
  | 'PREMATURE_TARGET_REQUEST'
  | 'REDUNDANT_DISAMBIGUATION';

/** Evaluation of one caller utterance while resolving ambiguity. */
export interface CallerBehaviorEvaluation {
  /** Whether this utterance was evaluated against the disambiguation rubric. */
  applicable: boolean;
  /** Whether the caller was still in an ambiguity-resolution phase. */
  ambiguityActive: boolean;
  /** Caller-attributed classification for this utterance, if any. */
  label: CallerBehaviorLabel | null;
  /** Short explanation suitable for logs and debugging. */
  reason: string | null;
  /** CRM fields referenced by the utterance. */
  referencedFields: QueryableField[];
  /** Whether the utterance explicitly asks which company/account is correct. */
  asksForCompany: boolean;
  /** Fields that would meaningfully narrow the candidate set. */
  discriminatingFields: QueryableField[];
  /** Deduped evaluator keys consumed for redundancy tracking. */
  disambiguationKeys: string[];
  /** Number of candidate accounts under consideration for this ambiguous task. */
  candidateCount: number;
}

/** Episode-level caller-behavior instrumentation for ambiguous tasks. */
export interface CallerBehaviorMetrics {
  /** Number of caller `speak` turns evaluated while ambiguity remained unresolved. */
  ambiguousTurns: number;
  /** Count of high-signal disambiguation questions. */
  goodDisambiguationQuestions: number;
  /** Count of requests for the final field before the caller had resolved identity. */
  prematureTargetRequests: number;
  /** Count of repeated/low-value clarification attempts. */
  redundantClarifications: number;
}

/** Snapshot of multistep progress at the end of a step or episode. */
export interface ProgressSnapshot {
  /** Current environment view of the task's multistep phase. */
  phase: ProgressPhase;
  /** Number of required resolution clues that have been confirmed so far. */
  resolutionCluesMatched: number;
  /** Total number of clues required by the scenario. */
  totalResolutionClues: number;
  /** Whether the target field has been surfaced by the voice agent yet. */
  targetFieldObserved: boolean;
  /** Resolved company name once the environment is confident about account identity. */
  resolvedCompanyName: string | null;
}

/** Per-step delta describing what multistep progress changed on the current turn. */
export interface ProgressUpdate {
  /** Newly confirmed clue labels observed on this step. */
  newlyConfirmedClues: string[];
  /** Whether the target field was first observed on this step. */
  targetFieldObservedThisTurn: boolean;
  /** New progress phase entered on this step, if any. */
  phaseChangedTo: ProgressPhase | null;
  /** Resolved company name if account identity was first locked in on this step. */
  resolvedCompanyNameThisTurn: string | null;
}

/** Full environment response for one caller action. */
export interface StepResult {
  /** Next caller-visible observation after applying the action. */
  observation: EpisodeObservation;
  /** Scalar reward assigned for this step. */
  reward: number;
  /** Whether this action ended the episode. */
  done: boolean;
  /** Reward event breakdown explaining where the reward came from. */
  rewardEvents: RewardEvent[];
  /** Per-event signed reward amounts for this step, in application order. */
  stepRewardBreakdown: { event: RewardEvent; amount: number }[];
  /** Caller-attributed disambiguation evaluation for this turn, when applicable. */
  callerBehaviorEvaluation: CallerBehaviorEvaluation | null;
  /** Invalid-action classification when the caller took an illegal action. */
  invalidActionReason?: InvalidActionReason;
  /** High-level semantic events emitted by the voice agent this turn. */
  voiceAgentEvents: VoiceAgentSemanticEvent[];
  /** Low-level raw tool trace emitted by the voice agent for debugging/replay. */
  voiceAgentToolEvents: VoiceAgentToolEvent[];
  /** Full multistep progress snapshot after the action. */
  progress: ProgressSnapshot;
  /** Incremental multistep progress changes caused by this action. */
  progressUpdate: ProgressUpdate;
}

/** Reasons the environment may reject an action as illegal in the current call state. */
export type InvalidActionReason =
  | 'CANNOT_INITIATE_DURING_CONVERSATION'
  | 'CANNOT_SPEAK_WITHOUT_CONNECTION'
  | 'CANNOT_SUBMIT_WITHOUT_CONNECTION';

/** High-level episode failure categories used in summaries and evaluation reports. */
export type FailureReason =
  | 'WRONG_ANSWER'
  | 'NO_ANSWER'
  | 'ANSWERING_MACHINE'
  | 'WRONG_NUMBER'
  | 'MAX_TURNS';

/** Final episode record used by the runner, logger, and future trajectory storage. */
export interface EpisodeResult {
  /** Zero-based episode index within a run. */
  episodeIndex: number;
  /** Private scenario specification used to generate and score the episode. */
  spec: ScenarioSpec;
  /** Sum of all per-step rewards for the episode. */
  totalReward: number;
  /** Final count of turn-consuming caller actions. */
  turnCount: number;
  /** Whether the caller finished with the correct field/value submission. */
  success: boolean;
  /** Failure classification when the episode does not end successfully. */
  failureReason?: FailureReason;
  /** Final submitted field, if any. */
  submittedField: string | null;
  /** Final submitted answer value, if any. */
  submittedAnswer: string | null;
  /** Per-event reward breakdown accumulated over the episode. */
  rewardBreakdown: { event: RewardEvent; amount: number }[];
  /** Full dialogue transcript for the episode. */
  conversationHistory: DialogueTurn[];
  /** Final multistep progress snapshot. */
  progress: ProgressSnapshot;
  /** Semantic event stream accumulated across the episode. */
  voiceAgentEvents: VoiceAgentSemanticEvent[];
  /** Raw tool-event stream accumulated across the episode. */
  voiceAgentToolEvents: VoiceAgentToolEvent[];
  /** Caller-attributed disambiguation instrumentation accumulated across the episode. */
  callerBehaviorMetrics: CallerBehaviorMetrics;
}

/** Small caller action space exposed by the environment. */
export type CallerAction =
  /** Start or retry a call to a target string chosen by the caller. */
  | { type: 'initiate_call'; target: string }
  /** Say something to the connected voice agent. */
  | { type: 'speak'; utterance: string }
  /** Submit a final field/value answer to end the episode. */
  | { type: 'submit_answer'; field: string; value: string }
  /** End the episode without submitting an answer. */
  | { type: 'end_call' };
