import { findByName, getFieldValue } from '../crm/store.js';
import type { Task } from './types.js';

/**
 * Five static scenarios that form the canonical regression suite.
 *
 * Rules for this set:
 *  - All tasks use difficulty 'easy' (exact names) so results are stable.
 *  - Each task targets a different field to catch field-specific regressions.
 *  - Persona and style vary across tasks to exercise the LLM caller's range.
 *  - Run with `npm run golden` (forces ANSWERED so there are no random failures).
 */
function buildGoldenTasks(): Task[] {
  const acme     = findByName('Acme Corp')[0]!;
  const globex   = findByName('Globex Corporation')[0]!;
  const umbrella = findByName('Umbrella Technologies')[0]!;
  const initech  = findByName('Initech Solutions')[0]!;
  const soylent  = findByName('Soylent Corp')[0]!;

  return [
    // ── 1. SIMPLE_LOOKUP — numeric field ─────────────────────────────────────
    {
      type: 'SIMPLE_LOOKUP',
      description: 'Find the contract value for "Acme Corp". Be concise and professional.',
      targetAccountId: acme.id,
      targetField: 'contract_value',
      targetValue: getFieldValue(acme, 'contract_value'),
      difficulty: 'easy',
      callerPersona: 'professional',
      queryStyle: 'direct',
    },

    // ── 2. SIMPLE_LOOKUP — date field ─────────────────────────────────────────
    {
      type: 'SIMPLE_LOOKUP',
      description: 'Give Globex Corporation a quick call and ask about their contract renewal date. Keep it casual and friendly.',
      targetAccountId: globex.id,
      targetField: 'contract_renewal_date',
      targetValue: getFieldValue(globex, 'contract_renewal_date'),
      difficulty: 'easy',
      callerPersona: 'casual',
      queryStyle: 'conversational',
    },

    // ── 3. SIMPLE_LOOKUP — string enum field ──────────────────────────────────
    {
      type: 'SIMPLE_LOOKUP',
      description: 'Find the deal stage for "Umbrella Technologies". Be direct and efficient — no small talk, just the data.',
      targetAccountId: umbrella.id,
      targetField: 'deal_stage',
      targetValue: getFieldValue(umbrella, 'deal_stage'),
      difficulty: 'easy',
      callerPersona: 'assertive',
      queryStyle: 'direct',
    },

    // ── 4. DISAMBIGUATION — must narrow down from 5 Sarahs ────────────────────
    {
      type: 'DISAMBIGUATION',
      description: 'Find the account status for the account managed by "Sarah Johnson". You do not know the company — call using "Sarah" and disambiguate. Be concise and professional.',
      targetAccountId: initech.id,
      targetField: 'account_status',
      targetValue: getFieldValue(initech, 'account_status'),
      ambiguousName: 'Sarah',
      difficulty: 'easy',
      callerPersona: 'professional',
      queryStyle: 'direct',
    },

    // ── 5. DISAMBIGUATION — verify style ─────────────────────────────────────
    {
      type: 'DISAMBIGUATION',
      description: 'Confirm the last activity date for Sarah Waugh\'s account. You don\'t know the company — start by calling "Sarah" and narrow it down. Keep it casual and friendly.',
      targetAccountId: soylent.id,
      targetField: 'last_activity',
      targetValue: getFieldValue(soylent, 'last_activity'),
      ambiguousName: 'Sarah',
      difficulty: 'easy',
      callerPersona: 'casual',
      queryStyle: 'verify',
    },
  ];
}

export const GOLDEN_TASKS: Task[] = buildGoldenTasks();
