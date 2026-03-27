import type { CallerBehaviorMetrics, CallerBrief, EpisodeResult, TaskType } from '../env/types.js';

export type PolicyStatus = 'baseline' | 'candidate' | 'promoted' | 'archived';
export type ExperimentStatus = 'active' | 'archived';
export type UpdaterMode = 'manual' | 'llm';
export type RunType = 'golden' | 'stress' | 'random' | 'train';

export interface BaselinePolicy {
  policyId: 'baseline';
  createdAt: string;
  label: string;
  prompt: string;
  promptHash: string;
  notes: string | null;
}

export interface PolicyVersion {
  policyId: string;
  experimentId: string;
  parentPolicyId: string;
  createdAt: string;
  label: string;
  status: PolicyStatus;
  prompt: string;
  promptHash: string;
  changeSummary: string[];
  sourceRunId: string | null;
  sourcePolicyId: string | null;
  updater: UpdaterMode;
  notes: string | null;
}

export interface Experiment {
  experimentId: string;
  createdAt: string;
  label: string;
  rootPolicyId: 'baseline';
  currentPolicyId: string;
  bestPolicyId: string;
  status: ExperimentStatus;
  notes: string | null;
}

export interface PointerFile {
  policyId: string;
  updatedAt: string;
}

export interface UpdaterContext {
  sourceRunId?: string;
  sourcePolicyId?: string;
}

export interface RunManifest {
  runId: string;
  experimentId: string;
  policyId: string;
  createdAt: string;
  runType: RunType;
  scenarioSet: string;
  episodeCount: number;
  seed: number | null;
  promptHash: string;
  gitCommit: string | null;
  environmentVersion: string;
  updaterContext: UpdaterContext | null;
  notes: string | null;
}

export interface TaskTypeSummary {
  taskType: TaskType;
  episodeCount: number;
  successRate: number;
  avgReward: number;
}

export interface MultistepSummary {
  resolutionSuccessRate: number;
  targetFieldObservedRate: number;
  followUpCompletionRate: number;
  endedAwaitingFollowUpRate: number;
}

export interface CallerBehaviorSummary {
  ambiguousTurnCount: number;
  goodDisambiguationQuestionRate: number;
  prematureTargetRequestRate: number;
  redundantClarificationRate: number;
}

export interface RunSummary {
  runId: string;
  experimentId: string;
  policyId: string;
  runType: RunType;
  scenarioSet: string;
  episodeCount: number;
  successRate: number;
  avgReward: number;
  avgTurns: number;
  invalidActionRate: number;
  wrongAnswerRate: number;
  noAnswerRate: number;
  taskTypeBreakdown: TaskTypeSummary[];
  multistep: MultistepSummary;
  callerBehavior: CallerBehaviorSummary;
}

export interface StoredEpisodeTrajectory {
  runId: string;
  experimentId: string;
  policyId: string;
  episodeIndex: number;
  scenarioType: TaskType;
  brief: CallerBrief;
  success: boolean;
  failureReason?: EpisodeResult['failureReason'];
  totalReward: number;
  turnCount: number;
  rewardBreakdown: EpisodeResult['rewardBreakdown'];
  progress: EpisodeResult['progress'];
  conversationHistory: EpisodeResult['conversationHistory'];
  voiceAgentEvents: EpisodeResult['voiceAgentEvents'];
  voiceAgentToolEvents: EpisodeResult['voiceAgentToolEvents'];
  submittedField: string | null;
  submittedAnswer: string | null;
  invalidActionCount: number;
  hadInvalidAction: boolean;
  prematureSubmit: boolean;
  resolvedAccountBeforeSubmit: boolean;
  callerBehaviorMetrics: CallerBehaviorMetrics;
}

export interface ComparisonMetricDelta {
  metric: string;
  base: number;
  candidate: number;
  delta: number;
}

export interface RunComparison {
  baseRunId: string;
  candidateRunId: string;
  basePolicyId: string;
  candidatePolicyId: string;
  metricDeltas: ComparisonMetricDelta[];
  regressions: string[];
  improvements: string[];
  recommendation: 'promote' | 'hold';
}

export interface PolicyContext {
  policyId: string;
  prompt: string;
  promptHash: string;
}
