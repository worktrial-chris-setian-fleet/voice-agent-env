import { findByName, getFieldValue } from '../crm/store.js';
import type { Task } from './types.js';

/**
 * Eight static scenarios designed to expose known failure modes.
 *
 * Unlike the golden suite (which must always pass), stress tasks are expected
 * to sometimes fail. The signal is the reward score, not pass/fail.
 * Each scenario targets one failure mode so score changes can be attributed.
 *
 * Run with: npm run stress
 */
function buildStressTasks(): Task[] {
  const acme       = findByName('Acme Corp')[0]!;
  const globex     = findByName('Globex Corporation')[0]!;
  const umbrella   = findByName('Umbrella Technologies')[0]!;
  const oscorp     = findByName('Oscorp Industries')[0]!;
  const bluth      = findByName('Bluth Company')[0]!;
  const lacroix    = findByName('Lacroix Capital')[0]!;

  return [
    // ── S1: Deep disambiguation — first name only, uncertain persona ──────────
    // Failure mode: disambiguation loop / extra turns
    // Agent has only "Sarah" and the role hint. Must navigate 5 matches.
    // Uncertain persona maximises hedging and extra turns.
    {
      type: 'DISAMBIGUATION',
      description:
        'You need to find the contract value for a contact named Sarah — you only know her first name ' +
        'and that she holds a Managing Director role. ' +
        'Call using "Sarah" and figure out which account she manages. ' +
        'You are not sure of all the details — ask clarifying questions as needed.',
      targetAccountId: lacroix.id,
      targetField: 'contract_value',
      targetValue: getFieldValue(lacroix, 'contract_value'),
      ambiguousName: 'Sarah',
      difficulty: 'easy',
      callerPersona: 'uncertain',
      queryStyle: 'conversational',
    },

    // ── S2: Disambiguation under assertive pressure — first name only ─────────
    // Failure mode: premature submission before disambiguation resolves
    // Agent has only "Sarah" and knows she's in a CTO-level role.
    // Assertive persona pushes toward committing early — risks wrong account.
    {
      type: 'DISAMBIGUATION',
      description:
        'Find the last activity date for a contact named Sarah — you only have her first name ' +
        'and know she\'s in a technical leadership role (CTO or similar). ' +
        'Call using "Sarah". Be direct and efficient — no small talk, just the data.',
      targetAccountId: globex.id,
      targetField: 'last_activity',
      targetValue: getFieldValue(globex, 'last_activity'),
      ambiguousName: 'Sarah',
      difficulty: 'easy',
      callerPersona: 'assertive',
      queryStyle: 'direct',
    },

    // ── S3: Two-match company disambiguation — "Technologies" ────────────────
    // Failure mode: agent guesses the wrong company (50/50)
    // "Technologies" matches Umbrella Technologies ($340k) AND InGen Technologies ($60k).
    // Description withholds the specific company name — agent must dial ambiguously and pick.
    {
      type: 'SIMPLE_LOOKUP',
      description:
        'A company with "Technologies" in its name is in your portfolio — you don\'t know the exact name. ' +
        'Dial using "Technologies" and find their contract value. Be concise and professional.',
      targetAccountId: umbrella.id,
      targetField: 'contract_value',
      targetValue: getFieldValue(umbrella, 'contract_value'), // $340,000 — InGen is $60,000
      difficulty: 'hard',
      callerPersona: 'professional',
      queryStyle: 'direct',
    },

    // ── S4: Three-match company disambiguation — "Corp" ───────────────────────
    // Failure mode: agent guesses the wrong company (1 in 3)
    // "Corp" substring matches Acme Corp, Soylent Corp, AND Oscorp Industries.
    // All three have different contract values — only one is the target.
    {
      type: 'SIMPLE_LOOKUP',
      description:
        'One of your "Corp" accounts needs a follow-up — you don\'t know which one exactly. ' +
        'Dial using "Corp" and find their contract value. Be direct and efficient — no small talk.',
      targetAccountId: oscorp.id,
      targetField: 'contract_value',
      targetValue: getFieldValue(oscorp, 'contract_value'), // $160,000 — Acme=$120k, Soylent=$92k
      difficulty: 'hard',
      callerPersona: 'assertive',
      queryStyle: 'direct',
    },

    // ── S5: Primed wrong expectation — verify with incorrect prior ────────────
    // Failure mode: agent submits the expected value ($200k) instead of the actual ($250k)
    // "Verify" framing primes the agent to confirm a specific number that is wrong.
    {
      type: 'SIMPLE_LOOKUP',
      description:
        'Double-check that Globex Corporation\'s contract value is still $200,000. ' +
        'Call to confirm what\'s currently on file.',
      targetAccountId: globex.id,
      targetField: 'contract_value',
      targetValue: getFieldValue(globex, 'contract_value'), // $250,000 — not $200,000
      difficulty: 'easy',
      callerPersona: 'professional',
      queryStyle: 'verify',
    },

    // ── S6: Two-Sarah negotiation ambiguity → chain to renewal date ───────────
    // Failure mode: two Sarahs are in negotiation (Johnson/Initech + Nakamura/Lacroix); agent picks wrong one
    // Requires multi-step: first identify which Sarahs are in negotiation, then get renewal date
    // 50/50 guess if agent can't distinguish further — renewal dates differ so wrong guess fails
    {
      type: 'DISAMBIGUATION',
      description:
        'Find the Sarah contact whose company is currently in the "negotiation" deal stage. ' +
        'Then get her contract renewal date. Call using "Sarah". ' +
        'You are not sure of all the details — ask clarifying questions as needed.',
      targetAccountId: lacroix.id,
      targetField: 'contract_renewal_date',
      targetValue: getFieldValue(lacroix, 'contract_renewal_date'), // 2027-01-15 — Initech is 2026-07-30
      ambiguousName: 'Sarah',
      difficulty: 'easy',
      callerPersona: 'uncertain',
      queryStyle: 'conversational',
    },

    // ── S7: Uncertain persona, first name only, no role hint ─────────────────
    // Failure mode: uncertain framing + no disambiguating clue → loop or wrong answer
    // Hardest disambiguation: agent has only "Sarah" — no last name, no role, no company.
    // Must reason from whatever the voice agent returns. Often fails or over-turns.
    {
      type: 'DISAMBIGUATION',
      description:
        'You think you need to check the last activity date for a contact named Sarah, ' +
        'but you\'re not entirely sure of the details — you don\'t know her last name or company. ' +
        'Call using "Sarah" and try to figure it out. Keep it casual and friendly.',
      targetAccountId: acme.id,
      targetField: 'last_activity',
      targetValue: getFieldValue(acme, 'last_activity'),
      ambiguousName: 'Sarah',
      difficulty: 'easy',
      callerPersona: 'uncertain',
      queryStyle: 'conversational',
    },

    // ── S8: Churned account — expectation mismatch ───────────────────────────
    // Failure mode: "verify still active" primes agent to expect "active";
    // voice agent returns "churned" — agent may reject the answer, loop, or submit correctly
    {
      type: 'SIMPLE_LOOKUP',
      description:
        'Call Bluth Company to verify their account is still active — report the current account status. ' +
        'Be concise and professional.',
      targetAccountId: bluth.id,
      targetField: 'account_status',
      targetValue: getFieldValue(bluth, 'account_status'), // "churned" — not "active"
      difficulty: 'easy',
      callerPersona: 'professional',
      queryStyle: 'verify',
    },
  ];
}

export const STRESS_TASKS: Task[] = buildStressTasks();

/** Human-readable label for each stress scenario, indexed to match STRESS_TASKS order. */
export const STRESS_LABELS: string[] = [
  'S1: 5-Sarah, role hint voice agent cannot resolve',
  'S2: 5-Sarah, assertive — premature commit risk',
  'S3: "Technologies" → 2-company ambiguity (50/50 guess)',
  'S4: "Corp" → 3-company ambiguity (1-in-3 guess)',
  'S5: Verify with wrong prior ($200k vs actual $250k)',
  'S6: Two-Sarah negotiation — chain to renewal date',
  'S7: No-clue Sarah — no last name, no role, no company',
  'S8: Churned account — "verify active" expectation mismatch',
];
