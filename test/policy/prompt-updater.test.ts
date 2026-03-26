import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePromptUpdatePayload } from '../../src/policy/prompt-updater.js';

test('parsePromptUpdatePayload parses raw JSON', () => {
  const payload = parsePromptUpdatePayload(JSON.stringify({
    prompt: 'Hello {{TASK_DESCRIPTION}} {{TARGET_FIELD}}',
    changeSummary: ['one'],
    notes: 'note',
  }));

  assert.equal(payload.prompt, 'Hello {{TASK_DESCRIPTION}} {{TARGET_FIELD}}');
  assert.deepEqual(payload.changeSummary, ['one']);
  assert.equal(payload.notes, 'note');
});

test('parsePromptUpdatePayload parses fenced JSON', () => {
  const payload = parsePromptUpdatePayload(
    '```json\n{"prompt":"P {{TASK_DESCRIPTION}} {{TARGET_FIELD}}","changeSummary":["a"]}\n```'
  );

  assert.equal(payload.prompt, 'P {{TASK_DESCRIPTION}} {{TARGET_FIELD}}');
  assert.deepEqual(payload.changeSummary, ['a']);
});

test('parsePromptUpdatePayload parses JSON embedded in prose', () => {
  const payload = parsePromptUpdatePayload(
    'Here is your result:\n{"prompt":"Q {{TASK_DESCRIPTION}} {{TARGET_FIELD}}","notes":"ok"}\nThanks.'
  );

  assert.equal(payload.prompt, 'Q {{TASK_DESCRIPTION}} {{TARGET_FIELD}}');
  assert.equal(payload.notes, 'ok');
});
