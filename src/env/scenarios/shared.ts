import { getFieldValue } from '../../crm/store.js';
import type { Account, QueryableField } from '../../crm/types.js';
import type {
  CallerBrief,
  CallerPersona,
  Difficulty,
  QueryStyle,
  ResolutionClue,
  ScenarioSpec,
  TaskType,
} from '../types.js';
import type { VoiceAgentSessionConfig } from '../../voice-agent/types.js';

const PERSONA_SUFFIX: Record<CallerPersona, string> = {
  professional: 'Be concise and professional.',
  casual: 'Keep it casual and friendly.',
  assertive: 'Be direct and efficient — no small talk, just the data.',
  uncertain: 'You are not sure of all the details — ask clarifying questions as needed.',
};

interface BriefDescriptionParams {
  type: TaskType;
  field: QueryableField;
  callTarget: string;
  contactFullName?: string;
  ambiguousName?: string;
  resolutionClues?: ResolutionClue[];
  persona: CallerPersona;
  style: QueryStyle;
}

interface BuildCallerBriefParams extends BriefDescriptionParams {
  instructionsOverride?: string;
}

export function hasContract(account: Account): boolean {
  return account.contract_value > 0;
}

export function callTargetForDifficulty(companyName: string, difficulty: Difficulty): string {
  if (difficulty === 'easy') return companyName;
  return companyName.split(' ')[0];
}

export function buildCallerBrief(params: BuildCallerBriefParams): CallerBrief {
  return {
    type: params.type,
    instructions: params.instructionsOverride ?? buildDescription(params),
    targetField: params.field,
  };
}

export function buildResolutionClues(account: Account, clueFields: QueryableField[]): ResolutionClue[] {
  return clueFields.map((field) => {
    const value = getFieldValue(account, field);
    return {
      field,
      value,
      label: `${field.replace(/_/g, ' ')} = ${value}`,
    };
  });
}

export function buildVoiceAgentSessionConfig(spec: ScenarioSpec): VoiceAgentSessionConfig {
  if (!hasResolutionClues(spec)) {
    return { mode: 'default' };
  }

  return {
    mode: 'resolve_then_retrieve',
    resolutionClues: spec.resolutionClues.map((clue) => ({
      field: clue.field,
      value: clue.value,
      label: clue.label,
    })),
  };
}

export function hasResolutionClues(spec: ScenarioSpec): spec is ScenarioSpec & { resolutionClues: ResolutionClue[] } {
  return Boolean(spec.resolutionClues && spec.resolutionClues.length > 0);
}

function buildDescription(params: BriefDescriptionParams): string {
  const { type, field, contactFullName, ambiguousName, resolutionClues, persona, style } = params;
  const fieldLabel = field.replace(/_/g, ' ');
  const target = params.callTarget;

  let task: string;

  if (type === 'SIMPLE_LOOKUP') {
    switch (style) {
      case 'direct':
        task = `Find the ${fieldLabel} for "${target}".`;
        break;
      case 'conversational':
        task = `Give ${target} a quick call and ask about their ${fieldLabel}.`;
        break;
      case 'verify':
        task = `Verify the ${fieldLabel} currently on file for ${target} — call to confirm.`;
        break;
    }
  } else if (type === 'DISAMBIGUATION') {
    switch (style) {
      case 'direct':
        task = `Find the ${fieldLabel} for the account managed by "${contactFullName}". You do not know the company — call using "${ambiguousName}" and disambiguate.`;
        break;
      case 'conversational':
        task = `You need to reach the account where ${contactFullName} is the contact. You don't know the company name — call in asking for "${ambiguousName}" and work out which account.`;
        break;
      case 'verify':
        task = `Confirm the ${fieldLabel} for ${contactFullName}'s account. You don't know the company — start by calling "${ambiguousName}" and narrow it down.`;
        break;
    }
  } else {
    const clueText = formatResolutionClues(resolutionClues ?? []);
    switch (style) {
      case 'direct':
        task = `Find the ${fieldLabel} for the account matching "${target}" ${clueText}. First determine which account matches, then retrieve the ${fieldLabel}.`;
        break;
      case 'conversational':
        task = `Call using "${target}". Work out which account matches ${clueText}, then ask for the ${fieldLabel}.`;
        break;
      case 'verify':
        task = `Verify the ${fieldLabel} for the account matching "${target}" ${clueText}. First identify the correct account, then confirm the ${fieldLabel}.`;
        break;
    }
  }

  return `${task} ${PERSONA_SUFFIX[persona]}`;
}

function formatResolutionClues(clues: ResolutionClue[]): string {
  if (clues.length === 0) return 'with no additional clues';
  const parts = clues.map((clue) => `${clue.field.replace(/_/g, ' ')} "${clue.value}"`);
  if (parts.length === 1) return `with ${parts[0]}`;
  return `with ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
