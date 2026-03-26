import type { RunComparison, RunSummary } from './types.js';

export function compareRuns(input: {
  baseRun: RunSummary;
  candidateRun: RunSummary;
}): RunComparison {
  const { baseRun, candidateRun } = input;
  const metrics: Array<[string, number, number]> = [
    ['successRate', baseRun.successRate, candidateRun.successRate],
    ['avgReward', baseRun.avgReward, candidateRun.avgReward],
    ['avgTurns', baseRun.avgTurns, candidateRun.avgTurns],
    ['invalidActionRate', baseRun.invalidActionRate, candidateRun.invalidActionRate],
    ['wrongAnswerRate', baseRun.wrongAnswerRate, candidateRun.wrongAnswerRate],
    ['noAnswerRate', baseRun.noAnswerRate, candidateRun.noAnswerRate],
    ['multistep.resolutionSuccessRate', baseRun.multistep.resolutionSuccessRate, candidateRun.multistep.resolutionSuccessRate],
    ['multistep.targetFieldObservedRate', baseRun.multistep.targetFieldObservedRate, candidateRun.multistep.targetFieldObservedRate],
    ['multistep.followUpCompletionRate', baseRun.multistep.followUpCompletionRate, candidateRun.multistep.followUpCompletionRate],
    ['multistep.endedAwaitingFollowUpRate', baseRun.multistep.endedAwaitingFollowUpRate, candidateRun.multistep.endedAwaitingFollowUpRate],
  ];

  const metricDeltas = metrics.map(([metric, base, candidate]) => ({
    metric,
    base,
    candidate,
    delta: candidate - base,
  }));

  const regressions: string[] = [];
  const improvements: string[] = [];

  for (const delta of metricDeltas) {
    const direction = lowerIsBetter(delta.metric) ? -1 : 1;
    if (delta.delta * direction > 0) {
      improvements.push(`${delta.metric} ${formatSigned(delta.delta)}`);
    } else if (delta.delta * direction < 0) {
      regressions.push(`${delta.metric} ${formatSigned(delta.delta)}`);
    }
  }

  const goldenRegressed = candidateRun.runType === 'golden' &&
    (candidateRun.successRate < baseRun.successRate || candidateRun.avgReward < baseRun.avgReward);

  return {
    baseRunId: baseRun.runId,
    candidateRunId: candidateRun.runId,
    basePolicyId: baseRun.policyId,
    candidatePolicyId: candidateRun.policyId,
    metricDeltas,
    regressions,
    improvements,
    recommendation: goldenRegressed || regressions.some((entry) => entry.startsWith('successRate'))
      ? 'hold'
      : 'promote',
  };
}

function lowerIsBetter(metric: string): boolean {
  return metric === 'avgTurns' ||
    metric.endsWith('invalidActionRate') ||
    metric.endsWith('wrongAnswerRate') ||
    metric.endsWith('noAnswerRate') ||
    metric.endsWith('endedAwaitingFollowUpRate');
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(4)}`;
}
