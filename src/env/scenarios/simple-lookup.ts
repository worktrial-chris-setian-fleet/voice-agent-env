import { getFieldValue } from '../../crm/store.js';
import type { Account, QueryableField } from '../../crm/types.js';
import type { CallerPersona, Difficulty, QueryStyle, ScenarioSpec } from '../types.js';
import { buildCallerBrief, callTargetForDifficulty } from './shared.js';

interface SimpleLookupScenarioOptions {
  account: Account;
  field: QueryableField;
  difficulty: Difficulty;
  callerPersona: CallerPersona;
  queryStyle: QueryStyle;
  instructionsOverride?: string;
}

export function buildSimpleLookupScenario(options: SimpleLookupScenarioOptions): ScenarioSpec {
  const { account, field, difficulty, callerPersona, queryStyle, instructionsOverride } = options;
  const callTarget = callTargetForDifficulty(account.company_name, difficulty);

  return {
    brief: buildCallerBrief({
      type: 'SIMPLE_LOOKUP',
      field,
      callTarget,
      persona: callerPersona,
      style: queryStyle,
      instructionsOverride,
    }),
    targetAccountId: account.id,
    targetValue: getFieldValue(account, field),
    difficulty,
    callerPersona,
    queryStyle,
  };
}
