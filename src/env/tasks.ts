import { getAllAccounts, getFieldValue, findByContactName } from '../crm/store.js';
import type { Task, TaskType, Difficulty, CallerPersona, QueryStyle } from './types.js';
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
  persona: CallerPersona;
  style: QueryStyle;
}): string {
  const { type, field, contactFullName, ambiguousName, persona, style } = params;
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
  } else {
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
  }

  return `${task} ${PERSONA_SUFFIX[persona]}`;
}

export function generateTask(options: TaskOptions = {}): Task {
  const type: TaskType    = options.type       ?? pick(['SIMPLE_LOOKUP', 'DISAMBIGUATION']);
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
  } else {
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
  }
}
