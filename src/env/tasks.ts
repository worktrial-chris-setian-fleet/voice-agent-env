import { getAllAccounts, getFieldValue, findByContactName, findByName } from '../crm/store.js';
import type { ResolutionClue, Task, TaskType, Difficulty, CallerPersona, QueryStyle } from './types.js';
import type { QueryableField } from '../crm/types.js';
import type { Account } from '../crm/types.js';

export interface TaskOptions {
  type?: TaskType;
  difficulty?: Difficulty;
  callerPersona?: CallerPersona;
  queryStyle?: QueryStyle;
}

const QUERYABLE_FIELDS: QueryableField[] = [
  'contract_value', 'contract_renewal_date', 'deal_stage', 'account_status', 'last_activity',
];

const CALLER_PERSONAS: CallerPersona[] = ['professional', 'casual', 'assertive', 'uncertain'];
const QUERY_STYLES: QueryStyle[] = ['direct', 'conversational', 'verify'];

const PERSONA_SUFFIX: Record<CallerPersona, string> = {
  professional: 'Be concise and professional.',
  casual:       'Keep it casual and friendly.',
  assertive:    'Be direct and efficient — no small talk, just the data.',
  uncertain:    'You are not sure of all the details — ask clarifying questions as needed.',
};

interface ResolveThenRetrieveTemplate {
  callTarget: string;
  targetCompany: string;
  targetField: QueryableField;
  clueFields: QueryableField[];
}

const RESOLVE_THEN_RETRIEVE_TEMPLATES: ResolveThenRetrieveTemplate[] = [
  {
    callTarget: 'Sarah',
    targetCompany: 'Initech Solutions',
    targetField: 'contract_renewal_date',
    clueFields: ['account_status'],
  },
  {
    callTarget: 'Technologies',
    targetCompany: 'Umbrella Technologies',
    targetField: 'contract_value',
    clueFields: ['account_status'],
  },
  {
    callTarget: 'Sarah',
    targetCompany: 'Lacroix Capital',
    targetField: 'last_activity',
    clueFields: ['deal_stage', 'account_status'],
  },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function hasContract(account: Account): boolean {
  return account.contract_value > 0;
}

// Returns the call target based on difficulty:
// easy   → exact company name
// medium → first word of company name (partial match)
// hard   → same as medium (SIMPLE_LOOKUP has no harder variant)
function callTarget(companyName: string, difficulty: Difficulty): string {
  if (difficulty === 'easy') return companyName;
  return companyName.split(' ')[0];
}

function buildDescription(params: {
  type: TaskType;
  field: QueryableField;
  callTarget: string;
  contactFullName?: string;
  ambiguousName?: string;
  resolutionClues?: ResolutionClue[];
  persona: CallerPersona;
  style: QueryStyle;
}): string {
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
    // DISAMBIGUATION
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

export function generateTask(options: TaskOptions = {}): Task {
  const type: TaskType    = options.type       ?? pick(['SIMPLE_LOOKUP', 'DISAMBIGUATION', 'RESOLVE_THEN_RETRIEVE']);
  const difficulty        = options.difficulty ?? pick((['easy', 'easy', 'medium', 'hard'] as Difficulty[]));
  const callerPersona     = options.callerPersona ?? pick(CALLER_PERSONAS);
  const queryStyle        = options.queryStyle    ?? pick(QUERY_STYLES);

  if (type === 'SIMPLE_LOOKUP') {
    const accounts = getAllAccounts().filter(hasContract);
    const account = pick(accounts);
    const field = pick(QUERYABLE_FIELDS);
    const value = getFieldValue(account, field);
    const target = callTarget(account.company_name, difficulty);

    return {
      type,
      description: buildDescription({ type, field, callTarget: target, persona: callerPersona, style: queryStyle }),
      targetAccountId: account.id,
      targetField: field,
      targetValue: value,
      difficulty,
      callerPersona,
      queryStyle,
    };
  } else if (type === 'DISAMBIGUATION') {
    const ambiguousName = 'Sarah';
    const matchingAccounts = findByContactName(ambiguousName);
    const account = pick(matchingAccounts);
    const field = pick(QUERYABLE_FIELDS);
    const value = getFieldValue(account, field);
    const contactFullName = account.contacts.find(c =>
      c.name.toLowerCase().includes(ambiguousName.toLowerCase())
    )?.name ?? ambiguousName;

    return {
      type,
      description: buildDescription({
        type, field,
        callTarget: ambiguousName,
        contactFullName,
        ambiguousName,
        persona: callerPersona,
        style: queryStyle,
      }),
      targetAccountId: account.id,
      targetField: field,
      targetValue: value,
      ambiguousName,
      difficulty,
      callerPersona,
      queryStyle,
    };
  } else {
    const template = pick(RESOLVE_THEN_RETRIEVE_TEMPLATES);
    const account = findByName(template.targetCompany)[0]!;
    const resolutionClues = buildResolutionClues(account, template.clueFields);
    const value = getFieldValue(account, template.targetField);

    return {
      type,
      description: buildDescription({
        type,
        field: template.targetField,
        callTarget: template.callTarget,
        resolutionClues,
        persona: callerPersona,
        style: queryStyle,
      }),
      targetAccountId: account.id,
      targetField: template.targetField,
      targetValue: value,
      callTarget: template.callTarget,
      resolutionClues,
      difficulty,
      callerPersona,
      queryStyle,
    };
  }
}

function buildResolutionClues(account: Account, clueFields: QueryableField[]): ResolutionClue[] {
  return clueFields.map((field) => {
    const value = getFieldValue(account, field);
    return {
      field,
      value,
      label: `${field.replace(/_/g, ' ')} = ${value}`,
    };
  });
}

function formatResolutionClues(clues: ResolutionClue[]): string {
  if (clues.length === 0) return 'with no additional clues';
  const parts = clues.map(clue => `${clue.field.replace(/_/g, ' ')} "${clue.value}"`);
  if (parts.length === 1) return `with ${parts[0]}`;
  return `with ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
