import { slugify, timestampId } from './ids.js';
import * as store from './store.js';
import { ensureBaselineFromCurrentPrompt } from './policy-service.js';
import type { Experiment } from './types.js';

export async function initExperiment(input: { label: string; notes?: string | null }): Promise<Experiment> {
  await ensureBaselineFromCurrentPrompt();
  await store.ensureArtifactsLayout();
  const experimentId = `exp-${timestampId()}-${slugify(input.label)}`;
  const experiment: Experiment = {
    experimentId,
    createdAt: new Date().toISOString(),
    label: input.label,
    rootPolicyId: 'baseline',
    currentPolicyId: 'baseline',
    bestPolicyId: 'baseline',
    status: 'active',
    notes: input.notes ?? null,
  };
  await store.writeExperiment(experiment);
  return experiment;
}

export async function getExperiment(experimentId: string): Promise<Experiment> {
  const experiment = await store.readExperiment(experimentId);
  if (!experiment) {
    throw new Error(`Experiment not found: ${experimentId}`);
  }
  return experiment;
}

export async function setCurrentPolicy(experimentId: string, policyId: string): Promise<Experiment> {
  const experiment = await getExperiment(experimentId);
  const updated: Experiment = { ...experiment, currentPolicyId: policyId };
  await store.writeExperiment(updated);
  await store.writePointer(experimentId, 'latest', policyId);
  return updated;
}

export async function setBestPolicy(experimentId: string, policyId: string): Promise<Experiment> {
  const experiment = await getExperiment(experimentId);
  const updated: Experiment = { ...experiment, bestPolicyId: policyId };
  await store.writeExperiment(updated);
  await store.writePointer(experimentId, 'best', policyId);
  return updated;
}

export async function createScratchExperiment(): Promise<Experiment> {
  const label = `scratch-${new Date().toISOString().slice(0, 10)}`;
  const existing = await store.getLatestExperimentByPrefix(label);
  if (existing) return existing;
  return initExperiment({ label, notes: 'Auto-created scratch experiment for one-off runs.' });
}
