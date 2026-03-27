import { findByContactName, findByName, getFieldValue } from '../crm/store.js';
import type { Account, QueryableField } from '../crm/types.js';
import type { CallerBehaviorEvaluation, ScenarioSpec } from './types.js';

const FIELD_PATTERNS: Record<QueryableField, RegExp[]> = {
  contract_value: [/\bcontract value\b/i, /\bvalue\b/i, /\bcontract\b/i],
  contract_renewal_date: [/\bcontract renewal date\b/i, /\brenewal date\b/i, /\brenewal\b/i],
  deal_stage: [/\bdeal stage\b/i, /\bstage\b/i],
  account_status: [/\baccount status\b/i, /\bstatus\b/i],
  last_activity: [/\blast activity\b/i, /\brecent activity\b/i, /\bactivity\b/i],
};

const COMPANY_PATTERNS = [
  /\bwhich company\b/i,
  /\bwhat company\b/i,
  /\bwhich account\b/i,
  /\bwhat account\b/i,
  /\bwhich .* account\b/i,
];

export function evaluateCallerDisambiguationTurn(input: {
  spec: ScenarioSpec;
  utterance: string;
  ambiguityActive: boolean;
  askedDisambiguationKeys: Set<string>;
}): CallerBehaviorEvaluation {
  const { spec, utterance, ambiguityActive, askedDisambiguationKeys } = input;
  const candidateAccounts = getCandidateAccounts(spec);
  const referencedFields = extractReferencedFields(utterance);
  const asksForCompany = COMPANY_PATTERNS.some((pattern) => pattern.test(utterance));
  const discriminatingFields = referencedFields.filter((field) =>
    field !== spec.brief.targetField && isDiscriminatingField(candidateAccounts, field)
  );
  const disambiguationKeys = Array.from(new Set([
    ...discriminatingFields.map((field) => `field:${field}`),
    ...(asksForCompany && candidateAccounts.length > 1 ? ['company'] : []),
  ]));

  if (!isAmbiguousTask(spec)) {
    return emptyEvaluation(false);
  }

  if (!ambiguityActive) {
    return emptyEvaluation(true, candidateAccounts.length, referencedFields, asksForCompany, discriminatingFields, disambiguationKeys);
  }

  const asksTargetField = referencedFields.includes(spec.brief.targetField);
  if (asksTargetField && disambiguationKeys.length === 0) {
    return {
      applicable: true,
      ambiguityActive: true,
      label: 'PREMATURE_TARGET_REQUEST',
      reason: 'asked for the target field before narrowing the account',
      referencedFields,
      asksForCompany,
      discriminatingFields,
      disambiguationKeys,
      candidateCount: candidateAccounts.length,
    };
  }

  if (disambiguationKeys.length > 0) {
    const redundant = disambiguationKeys.every((key) => askedDisambiguationKeys.has(key));
    return {
      applicable: true,
      ambiguityActive: true,
      label: redundant ? 'REDUNDANT_DISAMBIGUATION' : 'GOOD_DISAMBIGUATION_QUESTION',
      reason: redundant
        ? 'repeated a clarification dimension that was already used'
        : buildGoodQuestionReason(discriminatingFields, asksForCompany),
      referencedFields,
      asksForCompany,
      discriminatingFields,
      disambiguationKeys,
      candidateCount: candidateAccounts.length,
    };
  }

  return {
    applicable: true,
    ambiguityActive: true,
    label: null,
    reason: null,
    referencedFields,
    asksForCompany,
    discriminatingFields,
    disambiguationKeys,
    candidateCount: candidateAccounts.length,
  };
}

function isAmbiguousTask(spec: ScenarioSpec): boolean {
  return spec.brief.type === 'DISAMBIGUATION' || spec.brief.type === 'RESOLVE_THEN_RETRIEVE';
}

function emptyEvaluation(
  applicable: boolean,
  candidateCount = 0,
  referencedFields: QueryableField[] = [],
  asksForCompany = false,
  discriminatingFields: QueryableField[] = [],
  disambiguationKeys: string[] = [],
): CallerBehaviorEvaluation {
  return {
    applicable,
    ambiguityActive: false,
    label: null,
    reason: null,
    referencedFields,
    asksForCompany,
    discriminatingFields,
    disambiguationKeys,
    candidateCount,
  };
}

function getCandidateAccounts(spec: ScenarioSpec): Account[] {
  if (spec.brief.type === 'DISAMBIGUATION') {
    return findByContactName(spec.ambiguousName ?? spec.callTarget ?? '');
  }
  if (spec.brief.type === 'RESOLVE_THEN_RETRIEVE') {
    return findByName(spec.callTarget ?? '');
  }
  return [];
}

function extractReferencedFields(utterance: string): QueryableField[] {
  const fields: QueryableField[] = [];
  for (const [field, patterns] of Object.entries(FIELD_PATTERNS) as Array<[QueryableField, RegExp[]]>) {
    if (patterns.some((pattern) => pattern.test(utterance))) {
      fields.push(field);
    }
  }
  return fields;
}

function isDiscriminatingField(accounts: Account[], field: QueryableField): boolean {
  if (accounts.length <= 1) return false;
  const distinctValues = new Set(accounts.map((account) => normalizeValue(getFieldValue(account, field))));
  return distinctValues.size > 1;
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function buildGoodQuestionReason(discriminatingFields: QueryableField[], asksForCompany: boolean): string {
  if (discriminatingFields.length > 0) {
    return `asked about a distinguishing field: ${discriminatingFields.join(', ')}`;
  }
  if (asksForCompany) {
    return 'asked which company/account matched the ambiguous request';
  }
  return 'asked a useful disambiguation question';
}
