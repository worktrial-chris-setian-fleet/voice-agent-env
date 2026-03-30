import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

async function withTempWorkspace<T>(fn: (workspaceDir: string) => Promise<T>): Promise<T> {
  const originalCwd = process.cwd();
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'voice-agent-env-policy-'));
  process.chdir(workspaceDir);
  try {
    return await fn(workspaceDir);
  } finally {
    process.chdir(originalCwd);
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

async function importFresh<T>(relativePathFromTest: string): Promise<T> {
  const absolutePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), relativePathFromTest);
  const url = pathToFileURL(absolutePath).href;
  return import(`${url}?t=${Date.now()}-${Math.random()}`) as Promise<T>;
}

test('baseline creation is idempotent', async () => {
  await withTempWorkspace(async () => {
    const policyService = await importFresh<typeof import('../../src/policy/policy-service.js')>('../../src/policy/policy-service.ts');

    const first = await policyService.ensureBaselineFromCurrentPrompt();
    const second = await policyService.ensureBaselineFromCurrentPrompt();

    assert.equal(first.policyId, 'baseline');
    assert.equal(second.promptHash, first.promptHash);
  });
});

test('new experiments start from baseline and policy versions are parent-linked', async () => {
  await withTempWorkspace(async () => {
    const policyService = await importFresh<typeof import('../../src/policy/policy-service.js')>('../../src/policy/policy-service.ts');
    const experimentService = await importFresh<typeof import('../../src/policy/experiment-service.js')>('../../src/policy/experiment-service.ts');
    await policyService.ensureBaselineFromCurrentPrompt();
    const experiment = await experimentService.initExperiment({ label: 'test-lineage' });
    assert.equal(experiment.currentPolicyId, 'baseline');
    assert.equal(experiment.bestPolicyId, 'baseline');

    const policy = await policyService.createPolicyVersion({
      experimentId: experiment.experimentId,
      parentPolicyId: 'baseline',
      prompt: 'prompt {{TASK_DESCRIPTION}} {{TARGET_FIELD}}',
      label: 'candidate',
      updater: 'manual',
      changeSummary: ['manual change'],
    });

    assert.equal(policy.parentPolicyId, 'baseline');
    assert.equal(policy.policyId, 'policy-v001');
  });
});

test('scratch experiments do not overwrite named experiments', async () => {
  await withTempWorkspace(async () => {
    const policyService = await importFresh<typeof import('../../src/policy/policy-service.js')>('../../src/policy/policy-service.ts');
    const experimentService = await importFresh<typeof import('../../src/policy/experiment-service.js')>('../../src/policy/experiment-service.ts');

    await policyService.ensureBaselineFromCurrentPrompt();
    const named = await experimentService.initExperiment({ label: 'named-run' });
    const scratch = await experimentService.createScratchExperiment();

    assert.notEqual(named.experimentId, scratch.experimentId);
    assert.match(scratch.label, /^scratch-/);
  });
});

test('comparison marks golden regression as hold', async () => {
  const comparisonModule = await importFresh<typeof import('../../src/policy/comparison.js')>('../../src/policy/comparison.ts');
  const comparison = comparisonModule.compareRuns({
    baseRun: {
      runId: 'run-base-golden',
      experimentId: 'exp-1',
      policyId: 'baseline',
      runType: 'golden',
      scenarioSet: 'golden-v1',
      episodeCount: 6,
      successRate: 1,
      avgReward: 9,
      avgTurns: 2,
      invalidActionRate: 0,
      wrongAnswerRate: 0,
      noAnswerRate: 0,
      taskTypeBreakdown: [],
      multistep: {
        resolutionSuccessRate: 1,
        targetFieldObservedRate: 1,
        followUpCompletionRate: 1,
        endedAwaitingFollowUpRate: 0,
      },
      callerBehavior: {
        ambiguousTurnCount: 2,
        goodDisambiguationQuestionRate: 0.5,
        prematureTargetRequestRate: 0,
        avgTurnsToResolution: 1.5,
      },
    },
    candidateRun: {
      runId: 'run-candidate-golden',
      experimentId: 'exp-1',
      policyId: 'policy-v001',
      runType: 'golden',
      scenarioSet: 'golden-v1',
      episodeCount: 6,
      successRate: 0.8,
      avgReward: 8,
      avgTurns: 2.1,
      invalidActionRate: 0,
      wrongAnswerRate: 0.2,
      noAnswerRate: 0,
      taskTypeBreakdown: [],
      multistep: {
        resolutionSuccessRate: 1,
        targetFieldObservedRate: 1,
        followUpCompletionRate: 1,
        endedAwaitingFollowUpRate: 0,
      },
      callerBehavior: {
        ambiguousTurnCount: 2,
        goodDisambiguationQuestionRate: 0.5,
        prematureTargetRequestRate: 0,
        avgTurnsToResolution: 1.5,
      },
    },
  });

  assert.equal(comparison.recommendation, 'hold');
});
