import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createScratchExperiment, getExperiment, initExperiment } from '../policy/experiment-service.js';
import { ensureBaselineFromCurrentPrompt, getBestPolicy, getLatestPolicy, getPolicy } from '../policy/policy-service.js';

export function createAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export async function resolveExperimentId(explicitExperimentId?: string): Promise<string> {
  if (explicitExperimentId) {
    const experiment = await getExperiment(explicitExperimentId);
    return experiment.experimentId;
  }
  const experiment = await createScratchExperiment();
  return experiment.experimentId;
}

export async function resolvePolicyId(input: { experimentId: string; explicitPolicyId?: string }): Promise<string> {
  if (input.explicitPolicyId) {
    return input.explicitPolicyId;
  }
  const experiment = await getExperiment(input.experimentId);
  return experiment.currentPolicyId;
}

export async function printExperiment(experimentId: string): Promise<void> {
  const experiment = await getExperiment(experimentId);
  const latest = await getLatestPolicy(experimentId);
  const best = await getBestPolicy(experimentId);
  console.log(JSON.stringify({ experiment, latestPolicyId: latest.policyId, bestPolicyId: best.policyId }, null, 2));
}

export async function printPolicy(policyRef: string, experimentId?: string): Promise<void> {
  await ensureBaselineFromCurrentPrompt();
  if (policyRef === 'baseline') {
    console.log(JSON.stringify(await getPolicy(experimentId ?? 'baseline-scope', 'baseline'), null, 2));
    return;
  }
  if (!experimentId) {
    throw new Error('An --experiment is required for non-baseline policies.');
  }
  console.log(JSON.stringify(await getPolicy(experimentId, policyRef), null, 2));
}

export async function initExperimentFromCli(label?: string, notes?: string): Promise<void> {
  const experiment = await initExperiment({
    label: label ?? `experiment-${new Date().toISOString().slice(0, 10)}`,
    notes: notes ?? null,
  });
  console.log(JSON.stringify(experiment, null, 2));
}
