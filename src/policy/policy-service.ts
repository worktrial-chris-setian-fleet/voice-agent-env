import { DEFAULT_CALLER_POLICY_PROMPT } from './default-policy.js';
import { hashPrompt } from './hash.js';
import { nextPolicyId } from './ids.js';
import * as store from './store.js';
import type { BaselinePolicy, PolicyContext, PolicyVersion, UpdaterMode } from './types.js';

export async function ensureBaselineFromCurrentPrompt(): Promise<BaselinePolicy> {
  const existing = await store.readBaseline();
  if (existing) {
    return existing;
  }

  const baseline: BaselinePolicy = {
    policyId: 'baseline',
    createdAt: new Date().toISOString(),
    label: 'Initial caller prompt',
    prompt: DEFAULT_CALLER_POLICY_PROMPT,
    promptHash: hashPrompt(DEFAULT_CALLER_POLICY_PROMPT),
    notes: 'Extracted from the repository caller prompt template.',
  };
  await store.writeBaseline(baseline);
  return baseline;
}

export async function createPolicyVersion(input: {
  experimentId: string;
  parentPolicyId: string;
  prompt: string;
  label: string;
  updater: UpdaterMode;
  changeSummary: string[];
  sourceRunId?: string | null;
  sourcePolicyId?: string | null;
  notes?: string | null;
  status?: PolicyVersion['status'];
}): Promise<PolicyVersion> {
  await ensureBaselineFromCurrentPrompt();
  const existingPolicyIds = await store.listPolicyIds(input.experimentId);
  const policyId = nextPolicyId(existingPolicyIds);
  const policy: PolicyVersion = {
    policyId,
    experimentId: input.experimentId,
    parentPolicyId: input.parentPolicyId,
    createdAt: new Date().toISOString(),
    label: input.label,
    status: input.status ?? 'candidate',
    prompt: input.prompt,
    promptHash: hashPrompt(input.prompt),
    changeSummary: input.changeSummary,
    sourceRunId: input.sourceRunId ?? null,
    sourcePolicyId: input.sourcePolicyId ?? null,
    updater: input.updater,
    notes: input.notes ?? null,
  };
  await store.writePolicy(policy);
  await store.writePointer(input.experimentId, 'latest', policy.policyId);
  return policy;
}

export async function getPolicy(experimentId: string, policyId: string): Promise<PolicyContext> {
  if (policyId === 'baseline') {
    const baseline = await ensureBaselineFromCurrentPrompt();
    return {
      policyId: baseline.policyId,
      prompt: baseline.prompt,
      promptHash: baseline.promptHash,
    };
  }

  const policy = await store.readPolicy(experimentId, policyId);
  if (!policy) {
    throw new Error(`Policy not found: ${policyId} in experiment ${experimentId}`);
  }
  return {
    policyId: policy.policyId,
    prompt: policy.prompt,
    promptHash: policy.promptHash,
  };
}

export async function getLatestPolicy(experimentId: string): Promise<PolicyContext> {
  const pointer = await store.readPointer(experimentId, 'latest');
  if (!pointer) {
    return getPolicy(experimentId, 'baseline');
  }
  return getPolicy(experimentId, pointer.policyId);
}

export async function getBestPolicy(experimentId: string): Promise<PolicyContext> {
  const pointer = await store.readPointer(experimentId, 'best');
  if (!pointer) {
    return getPolicy(experimentId, 'baseline');
  }
  return getPolicy(experimentId, pointer.policyId);
}
