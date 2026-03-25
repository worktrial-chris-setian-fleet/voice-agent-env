import { findByName, getFieldValue } from '../crm/store.js';
import type { ScenarioSpec } from './types.js';
import {
  buildDisambiguationScenario,
  buildResolveThenRetrieveScenario,
  buildSimpleLookupScenario,
} from './scenarios/index.js';

/**
 * Five static scenarios that form the canonical regression suite.
 *
 * Rules for this set:
 *  - All tasks use difficulty 'easy' (exact names) so results are stable.
 *  - Each task targets a different field to catch field-specific regressions.
 *  - Persona and style vary across tasks to exercise the LLM caller's range.
 *  - Includes one deterministic multistep resolve-then-retrieve scenario.
 *  - Run with `npm run golden` (forces ANSWERED so there are no random failures).
 */
function buildGoldenTasks(): ScenarioSpec[] {
  const acme     = findByName('Acme Corp')[0]!;
  const globex   = findByName('Globex Corporation')[0]!;
  const umbrella = findByName('Umbrella Technologies')[0]!;
  const initech  = findByName('Initech Solutions')[0]!;
  const soylent  = findByName('Soylent Corp')[0]!;

  return [
    // ── 1. SIMPLE_LOOKUP — numeric field ─────────────────────────────────────
    buildSimpleLookupScenario({
      account: acme,
      field: 'contract_value',
      difficulty: 'easy',
      callerPersona: 'professional',
      queryStyle: 'direct',
    }),

    // ── 2. SIMPLE_LOOKUP — date field ─────────────────────────────────────────
    buildSimpleLookupScenario({
      account: globex,
      field: 'contract_renewal_date',
      difficulty: 'easy',
      callerPersona: 'casual',
      queryStyle: 'conversational',
    }),

    // ── 3. SIMPLE_LOOKUP — string enum field ──────────────────────────────────
    buildSimpleLookupScenario({
      account: umbrella,
      field: 'deal_stage',
      difficulty: 'easy',
      callerPersona: 'assertive',
      queryStyle: 'direct',
    }),

    // ── 4. DISAMBIGUATION — must narrow down from 5 Sarahs ────────────────────
    buildDisambiguationScenario({
      account: initech,
      field: 'account_status',
      ambiguousName: 'Sarah',
      difficulty: 'easy',
      callerPersona: 'professional',
      queryStyle: 'direct',
    }),

    // ── 5. DISAMBIGUATION — verify style ─────────────────────────────────────
    buildDisambiguationScenario({
      account: soylent,
      field: 'last_activity',
      ambiguousName: 'Sarah',
      difficulty: 'easy',
      callerPersona: 'casual',
      queryStyle: 'verify',
    }),

    // ── 6. RESOLVE_THEN_RETRIEVE — resolve "Technologies" by status, then retrieve ──
    buildResolveThenRetrieveScenario({
      account: umbrella,
      callTarget: 'Technologies',
      targetField: 'contract_value',
      clueFields: ['account_status'],
      difficulty: 'easy',
      callerPersona: 'professional',
      queryStyle: 'verify',
    }),
  ];
}

export const GOLDEN_TASKS: ScenarioSpec[] = buildGoldenTasks();
