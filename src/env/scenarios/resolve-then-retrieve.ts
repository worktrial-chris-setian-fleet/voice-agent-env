import { getFieldValue } from '../../crm/store.js';
import type { Account, QueryableField } from '../../crm/types.js';
import type { CallerPersona, Difficulty, QueryStyle, ScenarioSpec } from '../types.js';
import { buildCallerBrief, buildResolutionClues } from './shared.js';

interface ResolveThenRetrieveScenarioOptions {
  account: Account;
  callTarget: string;
  targetField: QueryableField;
  clueFields: QueryableField[];
  difficulty: Difficulty;
  callerPersona: CallerPersona;
  queryStyle: QueryStyle;
  instructionsOverride?: string;
}

export function buildResolveThenRetrieveScenario(
  options: ResolveThenRetrieveScenarioOptions
): ScenarioSpec {
  const {
    account,
    callTarget,
    targetField,
    clueFields,
    difficulty,
    callerPersona,
    queryStyle,
    instructionsOverride,
  } = options;
  const resolutionClues = buildResolutionClues(account, clueFields);

  return {
    brief: buildCallerBrief({
      type: 'RESOLVE_THEN_RETRIEVE',
      field: targetField,
      callTarget,
      resolutionClues,
      persona: callerPersona,
      style: queryStyle,
      instructionsOverride,
    }),
    targetAccountId: account.id,
    targetValue: getFieldValue(account, targetField),
    callTarget,
    resolutionClues,
    difficulty,
    callerPersona,
    queryStyle,
  };
}
