import { getFieldValue } from '../../crm/store.js';
import type { Account, QueryableField } from '../../crm/types.js';
import type { CallerPersona, Difficulty, QueryStyle, ScenarioSpec } from '../types.js';
import { buildCallerBrief } from './shared.js';

interface DisambiguationScenarioOptions {
  account: Account;
  field: QueryableField;
  ambiguousName: string;
  difficulty: Difficulty;
  callerPersona: CallerPersona;
  queryStyle: QueryStyle;
  instructionsOverride?: string;
}

export function buildDisambiguationScenario(options: DisambiguationScenarioOptions): ScenarioSpec {
  const { account, field, ambiguousName, difficulty, callerPersona, queryStyle, instructionsOverride } = options;
  const contactFullName = account.contacts.find((contact) =>
    contact.name.toLowerCase().includes(ambiguousName.toLowerCase())
  )?.name ?? ambiguousName;

  return {
    brief: buildCallerBrief({
      type: 'DISAMBIGUATION',
      field,
      callTarget: ambiguousName,
      contactFullName,
      ambiguousName,
      persona: callerPersona,
      style: queryStyle,
      instructionsOverride,
    }),
    targetAccountId: account.id,
    targetValue: getFieldValue(account, field),
    ambiguousName,
    difficulty,
    callerPersona,
    queryStyle,
  };
}
