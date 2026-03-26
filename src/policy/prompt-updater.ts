import Anthropic from '@anthropic-ai/sdk';
import type { RunSummary, StoredEpisodeTrajectory, UpdaterMode } from './types.js';

export interface PromptUpdateResult {
  prompt: string;
  changeSummary: string[];
  notes: string;
  updater: UpdaterMode;
}

export async function createManualPromptUpdate(input: {
  prompt: string;
  notes?: string;
  changeSummary?: string[];
}): Promise<PromptUpdateResult> {
  return {
    prompt: input.prompt,
    changeSummary: input.changeSummary ?? ['Manual prompt revision'],
    notes: input.notes ?? 'Prompt provided manually.',
    updater: 'manual',
  };
}

export async function createLlmPromptUpdate(input: {
  anthropic: Anthropic;
  currentPrompt: string;
  summaries: RunSummary[];
  trajectories: StoredEpisodeTrajectory[];
}): Promise<PromptUpdateResult> {
  const failureSamples = input.trajectories
    .filter((trajectory) => !trajectory.success)
    .slice(0, 5)
    .map((trajectory) => ({
      scenarioType: trajectory.scenarioType,
      failureReason: trajectory.failureReason ?? 'unknown',
      hadInvalidAction: trajectory.hadInvalidAction,
      prematureSubmit: trajectory.prematureSubmit,
      conversationTail: trajectory.conversationHistory.slice(-6),
    }));

  const summaryText = JSON.stringify({
    summaries: input.summaries,
    failureSamples,
  }, null, 2);

  const response = await input.anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1800,
    system: `You improve the caller-agent policy prompt for a CRM calling environment.

Return valid JSON with this exact shape:
{
  "prompt": "full updated prompt template",
  "changeSummary": ["short bullet", "short bullet"],
  "notes": "one paragraph rationale"
}

Rules:
- Return a full replacement prompt template, not a diff.
- Preserve the placeholders {{TASK_DESCRIPTION}} and {{TARGET_FIELD}} exactly.
- Optimize only the caller policy, not the environment.
- Keep the prompt concise and action-oriented.
- Focus on reducing invalid actions, premature submits, and multistep failures without regressing golden behavior.`,
    messages: [
      {
        role: 'user',
        content: `Current prompt template:\n${input.currentPrompt}\n\nRecent evaluation evidence:\n${summaryText}`,
      },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  const parsed = parsePromptUpdatePayload(text);
  return {
    prompt: parsed.prompt,
    changeSummary: parsed.changeSummary ?? ['LLM-generated prompt revision'],
    notes: parsed.notes ?? 'Prompt updated from evaluation artifacts.',
    updater: 'llm',
  };
}

interface PromptUpdatePayload {
  prompt: string;
  changeSummary?: string[];
  notes?: string;
}

export function parsePromptUpdatePayload(rawText: string): PromptUpdatePayload {
  const direct = tryParseJson(rawText);
  if (isPromptUpdatePayload(direct)) return direct;

  const unfenced = stripCodeFence(rawText);
  const unfencedParsed = tryParseJson(unfenced);
  if (isPromptUpdatePayload(unfencedParsed)) return unfencedParsed;

  const objectCandidate = extractFirstJsonObject(rawText);
  const objectParsed = tryParseJson(objectCandidate);
  if (isPromptUpdatePayload(objectParsed)) return objectParsed;

  const objectCandidateUnfenced = extractFirstJsonObject(unfenced);
  const objectParsedUnfenced = tryParseJson(objectCandidateUnfenced);
  if (isPromptUpdatePayload(objectParsedUnfenced)) return objectParsedUnfenced;

  throw new Error('Prompt updater returned non-JSON output. Expected an object with { prompt, changeSummary?, notes? }.');
}

function tryParseJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (!match) return trimmed;
  return match[1] ?? trimmed;
}

function extractFirstJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) return text;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return text;
}

function isPromptUpdatePayload(value: unknown): value is PromptUpdatePayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  if (typeof payload['prompt'] !== 'string') return false;
  if (payload['changeSummary'] !== undefined && !Array.isArray(payload['changeSummary'])) return false;
  if (Array.isArray(payload['changeSummary']) && !payload['changeSummary'].every((entry) => typeof entry === 'string')) return false;
  if (payload['notes'] !== undefined && typeof payload['notes'] !== 'string') return false;
  return true;
}
