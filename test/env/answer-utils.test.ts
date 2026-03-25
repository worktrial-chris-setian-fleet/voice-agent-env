import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answersMatch,
  fieldsMatch,
  makeClueKey,
  normalizeAnswer,
  normalizeFieldName,
  submissionMatchesTarget,
} from '../../src/env/answer-utils.js';

test('normalizeFieldName handles spacing and hyphen variants', () => {
  assert.equal(normalizeFieldName('Contract Renewal-Date'), 'contract_renewal_date');
  assert.equal(normalizeFieldName(' last   activity '), 'last_activity');
});

test('normalizeAnswer folds case and repeated whitespace', () => {
  assert.equal(normalizeAnswer('  Closed   Won  '), 'closed won');
});

test('answersMatch supports normalized numeric strings', () => {
  assert.equal(answersMatch(normalizeAnswer('3.00'), normalizeAnswer('3')), true);
});

test('submissionMatchesTarget requires both field and value to match', () => {
  assert.equal(
    submissionMatchesTarget('account status', 'at risk', 'account_status', 'at risk'),
    true
  );
  assert.equal(
    submissionMatchesTarget('deal_stage', 'at risk', 'account_status', 'at risk'),
    false
  );
});

test('makeClueKey is stable across field formatting differences', () => {
  assert.equal(
    makeClueKey('account_status', 'active'),
    makeClueKey('account status', 'ACTIVE')
  );
  assert.equal(fieldsMatch('last activity', 'last_activity'), true);
});
