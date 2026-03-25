import { getAllAccounts, findByContactName, findByName } from '../crm/store.js';
import type { ScenarioSpec, TaskType, Difficulty, CallerPersona, QueryStyle } from './types.js';
import type { QueryableField } from '../crm/types.js';
import {
  buildDisambiguationScenario,
  buildResolveThenRetrieveScenario,
  buildSimpleLookupScenario,
  hasContract,
} from './scenarios/index.js';

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

export function generateTask(options: TaskOptions = {}): ScenarioSpec {
  const type: TaskType    = options.type       ?? pick(['SIMPLE_LOOKUP', 'DISAMBIGUATION', 'RESOLVE_THEN_RETRIEVE']);
  const difficulty        = options.difficulty ?? pick((['easy', 'easy', 'medium', 'hard'] as Difficulty[]));
  const callerPersona     = options.callerPersona ?? pick(CALLER_PERSONAS);
  const queryStyle        = options.queryStyle    ?? pick(QUERY_STYLES);

  if (type === 'SIMPLE_LOOKUP') {
    const accounts = getAllAccounts().filter(hasContract);
    const account = pick(accounts);
    const field = pick(QUERYABLE_FIELDS);
    return buildSimpleLookupScenario({
      account,
      field,
      difficulty,
      callerPersona,
      queryStyle,
    });
  } else if (type === 'DISAMBIGUATION') {
    const ambiguousName = 'Sarah';
    const matchingAccounts = findByContactName(ambiguousName);
    const account = pick(matchingAccounts);
    const field = pick(QUERYABLE_FIELDS);
    return buildDisambiguationScenario({
      account,
      field,
      ambiguousName,
      difficulty,
      callerPersona,
      queryStyle,
    });
  } else {
    const template = pick(RESOLVE_THEN_RETRIEVE_TEMPLATES);
    const account = findByName(template.targetCompany)[0]!;
    return buildResolveThenRetrieveScenario({
      account,
      callTarget: template.callTarget,
      targetField: template.targetField,
      clueFields: template.clueFields,
      difficulty,
      callerPersona,
      queryStyle,
    });
  }
}
