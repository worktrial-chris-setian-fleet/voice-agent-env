import Anthropic from '@anthropic-ai/sdk';
import { LLMAgent } from '../agent/llm-agent.js';
import { generateTask } from '../env/tasks.js';
import { GOLDEN_TASKS } from '../env/golden-tasks.js';
import { STRESS_TASKS } from '../env/stress-tasks.js';
import type { ScenarioSpec, TaskType } from '../env/types.js';
import { Logger } from './logger.js';
import { VoiceAgentEnv } from '../env/environment.js';
import { runEpisode } from './episode-runner.js';
import { nextRunId } from '../policy/ids.js';
import { persistRunArtifacts } from './artifact-writer.js';
import { getExperiment, setBestPolicy, setCurrentPolicy } from '../policy/experiment-service.js';
import { compareRuns } from '../policy/comparison.js';
import { createLlmPromptUpdate, createManualPromptUpdate } from '../policy/prompt-updater.js';
import { createPolicyVersion, ensureBaselineFromCurrentPrompt, getPolicy } from '../policy/policy-service.js';
import * as store from '../policy/store.js';
import type {
  PolicyContext,
  RunComparison,
  RunManifest,
  RunSummary,
  RunType,
  StoredEpisodeTrajectory,
  UpdaterMode,
} from '../policy/types.js';

const ENVIRONMENT_VERSION = 'env-v1';

export interface RunScenarioSetOptions {
  anthropic: Anthropic;
  experimentId: string;
  policyId: string;
  runType: RunType;
  episodeCount?: number;
  seed?: number | null;
  forceAnswered?: boolean;
  logger?: Logger;
  notes?: string | null;
  updaterContext?: RunManifest['updaterContext'];
}

export interface ScenarioRunResult {
  policy: PolicyContext;
  artifacts: Awaited<ReturnType<typeof persistRunArtifacts>>;
}

export async function runScenarioSet(options: RunScenarioSetOptions): Promise<ScenarioRunResult> {
  await ensureBaselineFromCurrentPrompt();
  const experiment = await getExperiment(options.experimentId);
  const policy = await getPolicy(experiment.experimentId, options.policyId);
  const specs = resolveScenarioSet(options.runType, options.episodeCount);
  const logger = options.logger ?? new Logger();
  const env = new VoiceAgentEnv(options.anthropic, { forceAnswered: options.forceAnswered ?? shouldForceAnswered(options.runType) });
  const agent = new LLMAgent(options.anthropic, { policyId: policy.policyId, prompt: policy.prompt });
  const results = [];

  for (let i = 0; i < specs.length; i++) {
    results.push(await runEpisode(env, agent, specs[i], i, logger));
  }
  logger.runSummary(results);

  const manifest: RunManifest = {
    runId: nextRunId(options.runType),
    experimentId: experiment.experimentId,
    policyId: policy.policyId,
    createdAt: new Date().toISOString(),
    runType: options.runType,
    scenarioSet: scenarioSetName(options.runType),
    episodeCount: specs.length,
    seed: options.seed ?? null,
    promptHash: policy.promptHash,
    gitCommit: await safeGitCommit(),
    environmentVersion: ENVIRONMENT_VERSION,
    updaterContext: options.updaterContext ?? null,
    notes: options.notes ?? null,
  };

  const artifacts = await persistRunArtifacts({ manifest, results });
  return { policy, artifacts };
}

export async function runExperimentStep(input: {
  anthropic: Anthropic;
  experimentId: string;
  updaterMode: UpdaterMode;
  suites?: RunType[];
  manualPrompt?: string;
  manualPromptFile?: string;
  notes?: string | null;
}): Promise<{
  baseRuns: ScenarioRunResult[];
  candidateRuns: ScenarioRunResult[];
  candidatePolicyId: string;
  promoted: boolean;
  comparisons: RunComparison[];
}> {
  const experiment = await getExperiment(input.experimentId);
  const basePolicyId = experiment.currentPolicyId;
  const suites = input.suites ?? ['golden', 'stress', 'random'];

  const baseRuns: ScenarioRunResult[] = [];
  for (const suite of suites) {
    baseRuns.push(await runScenarioSet({
      anthropic: input.anthropic,
      experimentId: experiment.experimentId,
      policyId: basePolicyId,
      runType: suite,
      episodeCount: suite === 'random' ? 6 : undefined,
      notes: 'Base policy evaluation for experiment step.',
    }));
  }

  const currentPolicy = await getPolicy(experiment.experimentId, basePolicyId);
  const recentSummaries = baseRuns.map((run) => run.artifacts.summary);
  const recentTrajectories = baseRuns.flatMap((run) => run.artifacts.trajectories);
  const promptUpdate = input.updaterMode === 'llm'
    ? await createLlmPromptUpdate({
        anthropic: input.anthropic,
        currentPrompt: currentPolicy.prompt,
        summaries: recentSummaries,
        trajectories: recentTrajectories,
      })
    : await createManualPromptUpdate({
        prompt: await resolveManualPrompt(input),
        notes: input.notes ?? 'Manual experiment step prompt update.',
      });

  const candidatePolicy = await createPolicyVersion({
    experimentId: experiment.experimentId,
    parentPolicyId: basePolicyId,
    prompt: promptUpdate.prompt,
    label: `Candidate from ${basePolicyId}`,
    updater: promptUpdate.updater,
    changeSummary: promptUpdate.changeSummary,
    sourceRunId: baseRuns[0]?.artifacts.manifest.runId ?? null,
    sourcePolicyId: basePolicyId,
    notes: promptUpdate.notes,
  });

  const candidateRuns: ScenarioRunResult[] = [];
  for (const suite of suites) {
    candidateRuns.push(await runScenarioSet({
      anthropic: input.anthropic,
      experimentId: experiment.experimentId,
      policyId: candidatePolicy.policyId,
      runType: suite,
      episodeCount: suite === 'random' ? 6 : undefined,
      notes: 'Candidate policy evaluation for experiment step.',
      updaterContext: {
        sourceRunId: baseRuns[0]?.artifacts.manifest.runId,
        sourcePolicyId: basePolicyId,
      },
    }));
  }

  const comparisons = buildSuiteComparisons(baseRuns.map((run) => run.artifacts.summary), candidateRuns.map((run) => run.artifacts.summary));
  for (const comparison of comparisons) {
    const fileName = `compare-${comparison.basePolicyId}-${comparison.candidatePolicyId}-${comparison.baseRunId.split('-').pop()}.json`;
    await store.writeComparison(experiment.experimentId, fileName, comparison);
  }

  const promoted = shouldPromoteCandidate(comparisons);
  if (promoted) {
    await setCurrentPolicy(experiment.experimentId, candidatePolicy.policyId);
    await setBestPolicy(experiment.experimentId, candidatePolicy.policyId);
  }

  return {
    baseRuns,
    candidateRuns,
    candidatePolicyId: candidatePolicy.policyId,
    promoted,
    comparisons,
  };
}

export async function runExperimentLoop(input: {
  anthropic: Anthropic;
  experimentId: string;
  iterations: number;
  updaterMode: UpdaterMode;
  suites?: RunType[];
  manualPrompt?: string;
  manualPromptFile?: string;
}): Promise<Array<Awaited<ReturnType<typeof runExperimentStep>>>> {
  const results = [];
  for (let i = 0; i < input.iterations; i++) {
    results.push(await runExperimentStep({
      anthropic: input.anthropic,
      experimentId: input.experimentId,
      updaterMode: input.updaterMode,
      suites: input.suites,
      manualPrompt: input.manualPrompt,
      manualPromptFile: input.manualPromptFile,
      notes: `Experiment loop iteration ${i + 1}`,
    }));
  }
  return results;
}

function resolveScenarioSet(runType: RunType, episodeCount = 6): ScenarioSpec[] {
  if (runType === 'golden') return GOLDEN_TASKS;
  if (runType === 'stress') return STRESS_TASKS;

  const taskTypes: TaskType[] = ['SIMPLE_LOOKUP', 'DISAMBIGUATION', 'RESOLVE_THEN_RETRIEVE'];
  return Array.from({ length: episodeCount }, (_, index) =>
    generateTask({ type: taskTypes[index % taskTypes.length] })
  );
}

function shouldForceAnswered(runType: RunType): boolean {
  return runType === 'golden' || runType === 'stress';
}

function scenarioSetName(runType: RunType): string {
  switch (runType) {
    case 'golden':
      return 'golden-v1';
    case 'stress':
      return 'stress-v1';
    case 'random':
      return 'random-v1';
    case 'train':
      return 'train-v1';
  }
}

function buildSuiteComparisons(baseSummaries: RunSummary[], candidateSummaries: RunSummary[]): RunComparison[] {
  const comparisons: RunComparison[] = [];
  for (const base of baseSummaries) {
    const candidate = candidateSummaries.find((entry) => entry.runType === base.runType);
    if (!candidate) continue;
    comparisons.push(compareRuns({ baseRun: base, candidateRun: candidate }));
  }
  return comparisons;
}

function shouldPromoteCandidate(comparisons: RunComparison[]): boolean {
  const golden = comparisons.find((comparison) => comparison.baseRunId.includes('golden'));
  if (golden?.recommendation === 'hold') return false;
  const nonGolden = comparisons.filter((comparison) => !comparison.baseRunId.includes('golden'));
  return nonGolden.some((comparison) => comparison.improvements.length > 0);
}

async function resolveManualPrompt(input: {
  experimentId: string;
  manualPrompt?: string;
  manualPromptFile?: string;
}): Promise<string> {
  if (input.manualPrompt && input.manualPrompt.trim().length > 0) {
    return input.manualPrompt;
  }
  if (input.manualPromptFile) {
    const { readFile } = await import('node:fs/promises');
    return readFile(input.manualPromptFile, 'utf8');
  }
  const experiment = await getExperiment(input.experimentId);
  const currentPolicy = await getPolicy(experiment.experimentId, experiment.currentPolicyId);
  return currentPolicy.prompt;
}

async function safeGitCommit(): Promise<string | null> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const result = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() });
    return result.stdout.trim();
  } catch {
    return null;
  }
}
