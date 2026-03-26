import type { EpisodeResult, TaskType } from '../env/types.js';
import type { RunManifest, RunSummary, StoredEpisodeTrajectory, TaskTypeSummary } from './types.js';

export function buildStoredTrajectory(input: {
  manifest: RunManifest;
  result: EpisodeResult;
}): StoredEpisodeTrajectory {
  const { manifest, result } = input;
  const invalidActionCount = result.rewardBreakdown.filter((entry) => entry.event === 'INVALID_ACTION').length;
  const prematureSubmit = Boolean(
    result.spec.brief.type === 'RESOLVE_THEN_RETRIEVE' &&
    result.submittedAnswer !== null &&
    !result.progress.targetFieldObserved
  );
  const resolvedAccountBeforeSubmit = Boolean(
    result.submittedAnswer !== null &&
    result.progress.resolvedCompanyName !== null
  );

  return {
    runId: manifest.runId,
    experimentId: manifest.experimentId,
    policyId: manifest.policyId,
    episodeIndex: result.episodeIndex,
    scenarioType: result.spec.brief.type,
    brief: result.spec.brief,
    success: result.success,
    failureReason: result.failureReason,
    totalReward: result.totalReward,
    turnCount: result.turnCount,
    rewardBreakdown: result.rewardBreakdown,
    progress: result.progress,
    conversationHistory: result.conversationHistory,
    voiceAgentEvents: result.voiceAgentEvents,
    voiceAgentToolEvents: result.voiceAgentToolEvents,
    submittedField: result.submittedField,
    submittedAnswer: result.submittedAnswer,
    invalidActionCount,
    hadInvalidAction: invalidActionCount > 0,
    prematureSubmit,
    resolvedAccountBeforeSubmit,
  };
}

export function deriveRunSummary(manifest: RunManifest, trajectories: StoredEpisodeTrajectory[]): RunSummary {
  const episodeCount = trajectories.length;
  const successCount = trajectories.filter((trajectory) => trajectory.success).length;
  const invalidActionCount = trajectories.filter((trajectory) => trajectory.hadInvalidAction).length;
  const wrongAnswerCount = trajectories.filter((trajectory) => trajectory.failureReason === 'WRONG_ANSWER').length;
  const noAnswerCount = trajectories.filter((trajectory) =>
    trajectory.failureReason === 'NO_ANSWER' ||
    trajectory.failureReason === 'ANSWERING_MACHINE' ||
    trajectory.failureReason === 'WRONG_NUMBER'
  ).length;

  const grouped = new Map<TaskType, StoredEpisodeTrajectory[]>();
  for (const trajectory of trajectories) {
    const existing = grouped.get(trajectory.scenarioType) ?? [];
    existing.push(trajectory);
    grouped.set(trajectory.scenarioType, existing);
  }

  const taskTypeBreakdown: TaskTypeSummary[] = Array.from(grouped.entries()).map(([taskType, values]) => ({
    taskType,
    episodeCount: values.length,
    successRate: ratio(values.filter((value) => value.success).length, values.length),
    avgReward: average(values.map((value) => value.totalReward)),
  }));

  const multistep = trajectories.filter((trajectory) => trajectory.scenarioType === 'RESOLVE_THEN_RETRIEVE');

  return {
    runId: manifest.runId,
    experimentId: manifest.experimentId,
    policyId: manifest.policyId,
    runType: manifest.runType,
    scenarioSet: manifest.scenarioSet,
    episodeCount,
    successRate: ratio(successCount, episodeCount),
    avgReward: average(trajectories.map((trajectory) => trajectory.totalReward)),
    avgTurns: average(trajectories.map((trajectory) => trajectory.turnCount)),
    invalidActionRate: ratio(invalidActionCount, episodeCount),
    wrongAnswerRate: ratio(wrongAnswerCount, episodeCount),
    noAnswerRate: ratio(noAnswerCount, episodeCount),
    taskTypeBreakdown,
    multistep: {
      resolutionSuccessRate: multistep.length === 0
        ? 0
        : average(multistep.map((trajectory) =>
            trajectory.progress.totalResolutionClues === 0
              ? 0
              : trajectory.progress.resolutionCluesMatched / trajectory.progress.totalResolutionClues
          )),
      targetFieldObservedRate: ratio(multistep.filter((trajectory) => trajectory.progress.targetFieldObserved).length, multistep.length),
      followUpCompletionRate: ratio(multistep.filter((trajectory) => trajectory.progress.phase === 'RETRIEVED').length, multistep.length),
      endedAwaitingFollowUpRate: ratio(multistep.filter((trajectory) => trajectory.progress.phase === 'AWAITING_FOLLOW_UP').length, multistep.length),
    },
  };
}

function ratio(count: number, total: number): number {
  if (total === 0) return 0;
  return count / total;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
