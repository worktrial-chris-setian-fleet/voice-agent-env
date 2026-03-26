import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  BaselinePolicy,
  Experiment,
  PointerFile,
  PolicyVersion,
  RunComparison,
  RunManifest,
  RunSummary,
  StoredEpisodeTrajectory,
} from './types.js';

const ARTIFACTS_DIR = path.join(process.cwd(), 'artifacts');
const BASELINE_DIR = path.join(ARTIFACTS_DIR, 'baseline');
const EXPERIMENTS_DIR = path.join(ARTIFACTS_DIR, 'experiments');

export function getArtifactsDir(): string {
  return ARTIFACTS_DIR;
}

export function getBaselinePath(): string {
  return path.join(BASELINE_DIR, 'baseline.json');
}

export function getExperimentsDir(): string {
  return EXPERIMENTS_DIR;
}

export function getExperimentDir(experimentId: string): string {
  return path.join(EXPERIMENTS_DIR, experimentId);
}

export function getExperimentFile(experimentId: string): string {
  return path.join(getExperimentDir(experimentId), 'experiment.json');
}

export function getPoliciesDir(experimentId: string): string {
  return path.join(getExperimentDir(experimentId), 'policies');
}

export function getPolicyFile(experimentId: string, policyId: string): string {
  return path.join(getPoliciesDir(experimentId), `${policyId}.json`);
}

export function getPointerFile(experimentId: string, pointer: 'latest' | 'best'): string {
  return path.join(getPoliciesDir(experimentId), `${pointer}.json`);
}

export function getRunsDir(experimentId: string): string {
  return path.join(getExperimentDir(experimentId), 'runs');
}

export function getRunDir(experimentId: string, runId: string): string {
  return path.join(getRunsDir(experimentId), runId);
}

export function getRunManifestFile(experimentId: string, runId: string): string {
  return path.join(getRunDir(experimentId, runId), 'manifest.json');
}

export function getRunSummaryFile(experimentId: string, runId: string): string {
  return path.join(getRunDir(experimentId, runId), 'summary.json');
}

export function getRunTrajectoriesFile(experimentId: string, runId: string): string {
  return path.join(getRunDir(experimentId, runId), 'trajectories.jsonl');
}

export function getComparisonsDir(experimentId: string): string {
  return path.join(getExperimentDir(experimentId), 'comparisons');
}

export function getComparisonFile(experimentId: string, fileName: string): string {
  return path.join(getComparisonsDir(experimentId), fileName);
}

export async function ensureArtifactsLayout(): Promise<void> {
  await mkdir(BASELINE_DIR, { recursive: true });
  await mkdir(EXPERIMENTS_DIR, { recursive: true });
}

export async function ensureExperimentLayout(experimentId: string): Promise<void> {
  await mkdir(getPoliciesDir(experimentId), { recursive: true });
  await mkdir(getRunsDir(experimentId), { recursive: true });
  await mkdir(getComparisonsDir(experimentId), { recursive: true });
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'a' });
}

export async function readBaseline(): Promise<BaselinePolicy | null> {
  return readJsonFile<BaselinePolicy>(getBaselinePath());
}

export async function writeBaseline(policy: BaselinePolicy): Promise<void> {
  await writeJsonFile(getBaselinePath(), policy);
}

export async function readExperiment(experimentId: string): Promise<Experiment | null> {
  return readJsonFile<Experiment>(getExperimentFile(experimentId));
}

export async function writeExperiment(experiment: Experiment): Promise<void> {
  await ensureExperimentLayout(experiment.experimentId);
  await writeJsonFile(getExperimentFile(experiment.experimentId), experiment);
}

export async function readPolicy(experimentId: string, policyId: string): Promise<PolicyVersion | null> {
  return readJsonFile<PolicyVersion>(getPolicyFile(experimentId, policyId));
}

export async function writePolicy(policy: PolicyVersion): Promise<void> {
  await ensureExperimentLayout(policy.experimentId);
  await writeJsonFile(getPolicyFile(policy.experimentId, policy.policyId), policy);
}

export async function writePointer(experimentId: string, pointer: 'latest' | 'best', policyId: string): Promise<void> {
  const payload: PointerFile = { policyId, updatedAt: new Date().toISOString() };
  await writeJsonFile(getPointerFile(experimentId, pointer), payload);
}

export async function readPointer(experimentId: string, pointer: 'latest' | 'best'): Promise<PointerFile | null> {
  return readJsonFile<PointerFile>(getPointerFile(experimentId, pointer));
}

export async function writeRunManifest(manifest: RunManifest): Promise<void> {
  await writeJsonFile(getRunManifestFile(manifest.experimentId, manifest.runId), manifest);
}

export async function writeRunSummary(summary: RunSummary): Promise<void> {
  await writeJsonFile(getRunSummaryFile(summary.experimentId, summary.runId), summary);
}

export async function readRunSummary(experimentId: string, runId: string): Promise<RunSummary | null> {
  return readJsonFile<RunSummary>(getRunSummaryFile(experimentId, runId));
}

export async function appendTrajectory(experimentId: string, runId: string, trajectory: StoredEpisodeTrajectory): Promise<void> {
  await appendJsonLine(getRunTrajectoriesFile(experimentId, runId), trajectory);
}

export async function writeComparison(experimentId: string, fileName: string, comparison: RunComparison): Promise<void> {
  await writeJsonFile(getComparisonFile(experimentId, fileName), comparison);
}

export async function listExperimentIds(): Promise<string[]> {
  await ensureArtifactsLayout();
  const entries = await readdir(EXPERIMENTS_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export async function findExperimentByLabel(label: string): Promise<Experiment | null> {
  const ids = await listExperimentIds();
  for (const experimentId of ids) {
    const experiment = await readExperiment(experimentId);
    if (experiment?.label === label) return experiment;
  }
  return null;
}

export async function listPolicyIds(experimentId: string): Promise<string[]> {
  try {
    const entries = await readdir(getPoliciesDir(experimentId), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'latest.json' && entry.name !== 'best.json')
      .map((entry) => entry.name.replace(/\.json$/, ''))
      .sort();
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return [];
    throw error;
  }
}

export async function getLatestExperimentByPrefix(prefix: string): Promise<Experiment | null> {
  const ids = await listExperimentIds();
  const matches: Array<{ experiment: Experiment; mtimeMs: number }> = [];
  for (const experimentId of ids) {
    const experiment = await readExperiment(experimentId);
    if (!experiment || !experiment.label.startsWith(prefix)) continue;
    const info = await stat(getExperimentFile(experimentId));
    matches.push({ experiment, mtimeMs: info.mtimeMs });
  }
  matches.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return matches[0]?.experiment ?? null;
}
