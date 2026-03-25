import { findByName } from '../crm/store.js';
import type { ScenarioSpec } from './types.js';
import {
  buildDisambiguationScenario,
  buildResolveThenRetrieveScenario,
  buildSimpleLookupScenario,
} from './scenarios/index.js';

/**
 * Eight adversarial scenarios designed to expose known failure modes.
 *
 * Unlike the golden suite (which must always pass), stress tasks are expected
 * to fail. The signal is the reward score, not pass/fail — a prompt improvement
 * should move scores upward across generations.
 * Each scenario targets one failure mode so score changes can be attributed.
 *
 * Run with: npm run stress
 */
function buildStressTasks(): ScenarioSpec[] {
  const acme     = findByName('Acme Corp')[0]!;
  const globex   = findByName('Globex Corporation')[0]!;
  const umbrella = findByName('Umbrella Technologies')[0]!;
  const oscorp   = findByName('Oscorp Industries')[0]!;
  const lacroix  = findByName('Lacroix Capital')[0]!;

  return [
    // ── S1: Deep disambiguation — role hint the voice agent cannot resolve ────
    // Failure mode: disambiguation loop / turn burn
    // Agent has "Sarah" + "Managing Director" — voice agent has no role lookup tool.
    // Uncertain persona maximises hedging. Expect 4–6 turns and a low/negative reward.
    buildDisambiguationScenario({
      account: lacroix,
      field: 'contract_value',
      ambiguousName: 'Sarah',
      difficulty: 'easy',
      callerPersona: 'uncertain',
      queryStyle: 'conversational',
      instructionsOverride:
        'You need to find the contract value for a contact named Sarah — you only know her first name ' +
        'and that she holds a Managing Director role. ' +
        'Call using "Sarah" and figure out which account she manages. ' +
        'You are not sure of all the details — ask clarifying questions as needed.',
    }),

    // ── S2: Disambiguation under assertive pressure — CTO hint, unresolvable ──
    // Failure mode: premature submission under turn pressure
    // Assertive persona pushes toward committing before disambiguation resolves.
    // Same dead-end as S1 but agent is more likely to guess early and wrong.
    buildDisambiguationScenario({
      account: globex,
      field: 'last_activity',
      ambiguousName: 'Sarah',
      difficulty: 'easy',
      callerPersona: 'assertive',
      queryStyle: 'direct',
      instructionsOverride:
        'Find the last activity date for a contact named Sarah — you only have her first name ' +
        'and know she\'s in a technical leadership role (CTO or similar). ' +
        'Call using "Sarah". Be direct and efficient — no small talk, just the data.',
    }),

    // ── S3: Two-match company ambiguity — 50/50 guess ────────────────────────
    // Failure mode: agent must pick between two companies with no basis for the choice
    // "Technologies" matches Umbrella Technologies ($340k) AND InGen Technologies ($60k).
    // Description withholds the specific company — agent dials ambiguously and must pick.
    buildSimpleLookupScenario({
      account: umbrella,
      field: 'contract_value',
      difficulty: 'hard',
      callerPersona: 'professional',
      queryStyle: 'direct',
      instructionsOverride:
        'A company with "Technologies" in its name is in your portfolio — you don\'t know the exact name. ' +
        'Dial using "Technologies" and find their contract value. Be concise and professional.',
    }),

    // ── S4: Three-match company ambiguity — 1-in-3 guess ─────────────────────
    // Failure mode: agent must pick between three companies, each with a different value
    // "Corp" substring matches Acme Corp ($120k), Soylent Corp ($92k), Oscorp Industries ($160k).
    // Agent has no basis to prefer one — wrong guess triggers WRONG_ANSWER.
    buildSimpleLookupScenario({
      account: oscorp,
      field: 'contract_value',
      difficulty: 'hard',
      callerPersona: 'assertive',
      queryStyle: 'direct',
      instructionsOverride:
        'One of your "Corp" accounts needs a follow-up — you don\'t know which one exactly. ' +
        'Dial using "Corp" and find their contract value. Be direct and efficient — no small talk.',
    }),

    // ── S5: Two-Sarah negotiation ambiguity — chain to renewal date ───────────
    // Failure mode: two Sarahs share the same deal stage; agent must pick and chain to a second field
    // Both Sarah Johnson (Initech, renewal: 2026-07-30) and Sarah Nakamura (Lacroix, renewal: 2027-01-15)
    // are in "negotiation" — wrong pick fails because renewal dates differ.
    buildDisambiguationScenario({
      account: lacroix,
      field: 'contract_renewal_date',
      ambiguousName: 'Sarah',
      difficulty: 'easy',
      callerPersona: 'uncertain',
      queryStyle: 'conversational',
      instructionsOverride:
        'Find the Sarah contact whose company is currently in the "negotiation" deal stage. ' +
        'Then get her contract renewal date. Call using "Sarah". ' +
        'You are not sure of all the details — ask clarifying questions as needed.',
    }),

    // ── S6: No-clue disambiguation — hardest path ────────────────────────────
    // Failure mode: no disambiguating information at all → loop, dump, or wrong guess
    // Agent has only "Sarah" — no last name, no role, no company hint.
    // 1-in-5 chance of a lucky correct guess; most runs end in wrong answer or end_call.
    buildDisambiguationScenario({
      account: acme,
      field: 'last_activity',
      ambiguousName: 'Sarah',
      difficulty: 'easy',
      callerPersona: 'uncertain',
      queryStyle: 'conversational',
      instructionsOverride:
        'You think you need to check the last activity date for a contact named Sarah, ' +
        'but you\'re not entirely sure of the details — you don\'t know her last name or company. ' +
        'Call using "Sarah" and try to figure it out. Keep it casual and friendly.',
    }),

    // ── S7: Resolve-then-retrieve — company fragment with one clue ────────────
    // Failure mode: agent resolves the right company but stops before retrieving the target field
    buildResolveThenRetrieveScenario({
      account: umbrella,
      callTarget: 'Technologies',
      targetField: 'contract_renewal_date',
      clueFields: ['account_status'],
      difficulty: 'easy',
      callerPersona: 'professional',
      queryStyle: 'direct',
      instructionsOverride:
        'A company with "Technologies" in its name is currently active in your portfolio. ' +
        'Call using "Technologies", work out which company that is, then get its contract renewal date. ' +
        'Be concise and professional.',
    }),

    // ── S8: Resolve-then-retrieve — two clues required before final field ─────
    // Failure mode: agent confirms one clue but fails to chain through to the target field
    buildResolveThenRetrieveScenario({
      account: lacroix,
      callTarget: 'Sarah',
      targetField: 'last_activity',
      clueFields: ['deal_stage', 'account_status'],
      difficulty: 'easy',
      callerPersona: 'uncertain',
      queryStyle: 'conversational',
      instructionsOverride:
        'Call using "Sarah". Determine which Sarah is associated with the account that is in the negotiation deal stage ' +
        'and currently active, then get the last activity date. ' +
        'You are not sure of all the details — ask clarifying questions as needed.',
    }),
  ];
}

export const STRESS_TASKS: ScenarioSpec[] = buildStressTasks();

/** Human-readable label for each stress scenario, indexed to match STRESS_TASKS order. */
export const STRESS_LABELS: string[] = [
  'S1: 5-Sarah, role hint voice agent cannot resolve',
  'S2: 5-Sarah, assertive — premature commit risk',
  'S3: "Technologies" → 2-company ambiguity (50/50 guess)',
  'S4: "Corp" → 3-company ambiguity (1-in-3 guess)',
  'S5: Two-Sarah negotiation — chain to renewal date',
  'S6: No-clue Sarah — no last name, no role, no company',
  'S7: Resolve "Technologies" by active status, then retrieve',
  'S8: Resolve "Sarah" by negotiation + active, then retrieve',
];
