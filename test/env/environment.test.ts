import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceAgentEnv } from '../../src/env/environment.js';
import { GOLDEN_TASKS } from '../../src/env/golden-tasks.js';
import type { VoiceAgentTurnResult } from '../../src/voice-agent/types.js';

function createEnv(): VoiceAgentEnv {
  return new VoiceAgentEnv({} as never, { forceAnswered: true });
}

function installStubVoiceAgent(env: VoiceAgentEnv, turns: VoiceAgentTurnResult[]): void {
  const stub = {
    reset() {},
    async handleUtterance(): Promise<VoiceAgentTurnResult> {
      const next = turns.shift();
      if (!next) throw new Error('No stub voice-agent turn configured');
      return next;
    },
  };

  (env as unknown as { voiceAgent: typeof stub }).voiceAgent = stub;
}

test('invalid speak before connection is a penalized no-op', async () => {
  const env = createEnv();
  await env.reset(GOLDEN_TASKS[0]!);

  const result = await env.step({ type: 'speak', utterance: 'hello?' });

  assert.equal(result.invalidActionReason, 'CANNOT_SPEAK_WITHOUT_CONNECTION');
  assert.equal(result.reward, -3);
  assert.deepEqual(result.rewardEvents, ['TURN_PENALTY', 'INVALID_ACTION']);
  assert.equal(result.done, false);
  assert.equal(result.observation.callState, 'IDLE');
  assert.equal(result.observation.turnCount, 1);
});

test('invalid submit before connection is rejected without consuming a turn', async () => {
  const env = createEnv();
  await env.reset(GOLDEN_TASKS[0]!);

  const result = await env.step({ type: 'submit_answer', field: 'contract_value', value: '$120,000' });

  assert.equal(result.invalidActionReason, 'CANNOT_SUBMIT_WITHOUT_CONNECTION');
  assert.equal(result.reward, -2);
  assert.deepEqual(result.rewardEvents, ['INVALID_ACTION']);
  assert.equal(result.done, false);
  assert.equal(result.observation.callState, 'IDLE');
  assert.equal(result.observation.turnCount, 0);
});

test('invalid initiate_call during conversation is a penalized no-op', async () => {
  const env = createEnv();
  const spec = GOLDEN_TASKS[0]!;
  await env.reset(spec);

  const connect = await env.step({ type: 'initiate_call', target: 'Acme Corp' });
  assert.equal(connect.observation.callState, 'CONVERSATION');

  const invalidRetry = await env.step({ type: 'initiate_call', target: 'Globex Corporation' });

  assert.equal(invalidRetry.invalidActionReason, 'CANNOT_INITIATE_DURING_CONVERSATION');
  assert.equal(invalidRetry.reward, -3);
  assert.deepEqual(invalidRetry.rewardEvents, ['TURN_PENALTY', 'INVALID_ACTION']);
  assert.equal(invalidRetry.observation.callState, 'CONVERSATION');
  assert.equal(invalidRetry.observation.turnCount, 2);
});

test('resolve-then-retrieve progress advances across resolution and follow-up turns', async () => {
  const env = createEnv();
  const spec = GOLDEN_TASKS.find((task) => task.brief.type === 'RESOLVE_THEN_RETRIEVE');
  assert.ok(spec);

  await env.reset(spec);
  await env.step({ type: 'initiate_call', target: spec.callTarget ?? 'Technologies' });

  installStubVoiceAgent(env, [
    {
      text: 'Only Umbrella Technologies matches the active account-status clue. What would you like to know about it?',
      semanticEvents: [
        {
          type: 'resolution_clue_confirmed',
          clue: spec.resolutionClues![0]!,
          accountId: spec.targetAccountId,
          companyName: 'Umbrella Technologies',
        },
        {
          type: 'account_resolved',
          accountId: spec.targetAccountId,
          companyName: 'Umbrella Technologies',
        },
        {
          type: 'follow_up_requested',
          accountId: spec.targetAccountId,
          companyName: 'Umbrella Technologies',
        },
      ],
      toolEvents: [],
    },
    {
      text: 'The contract value for Umbrella Technologies is $340,000.',
      semanticEvents: [
        {
          type: 'field_returned',
          accountId: spec.targetAccountId,
          companyName: 'Umbrella Technologies',
          field: spec.brief.targetField,
          value: spec.targetValue,
        },
      ],
      toolEvents: [],
    },
  ]);

  const resolutionStep = await env.step({ type: 'speak', utterance: 'Which active Technologies account is the right one?' });
  assert.equal(resolutionStep.progress.phase, 'AWAITING_FOLLOW_UP');
  assert.deepEqual(resolutionStep.progressUpdate.newlyConfirmedClues, [spec.resolutionClues![0]!.label]);
  assert.equal(resolutionStep.progressUpdate.resolvedCompanyNameThisTurn, 'Umbrella Technologies');
  assert.equal(resolutionStep.progress.targetFieldObserved, false);
  assert.equal(resolutionStep.reward, 0);

  const retrievalStep = await env.step({ type: 'speak', utterance: 'Great, what is the contract value?' });
  assert.equal(retrievalStep.progress.phase, 'RETRIEVED');
  assert.equal(retrievalStep.progress.targetFieldObserved, true);
  assert.equal(retrievalStep.progressUpdate.targetFieldObservedThisTurn, true);
  assert.equal(retrievalStep.progress.resolvedCompanyName, 'Umbrella Technologies');
  assert.equal(retrievalStep.reward, 0);
});

test('caller-side evaluator marks a useful resolving question as good', async () => {
  const env = createEnv();
  const spec = GOLDEN_TASKS.find((task) => task.brief.type === 'RESOLVE_THEN_RETRIEVE');
  assert.ok(spec);

  await env.reset(spec);
  await env.step({ type: 'initiate_call', target: spec.callTarget ?? 'Technologies' });

  installStubVoiceAgent(env, [{
    text: 'I can help narrow that down.',
    semanticEvents: [],
    toolEvents: [],
  }]);

  const result = await env.step({ type: 'speak', utterance: 'Which account has active status?' });

  assert.equal(result.callerBehaviorEvaluation?.label, 'GOOD_DISAMBIGUATION_QUESTION');
  assert.equal(result.callerBehaviorEvaluation?.reason, 'asked about a distinguishing field: account_status');
  assert.equal(env.getCallerBehaviorMetrics().goodDisambiguationQuestions, 1);
  assert.equal(env.getCallerBehaviorMetrics().ambiguousTurns, 1);
});

test('caller-side evaluator marks a premature target-field request during ambiguity', async () => {
  const env = createEnv();
  const spec = GOLDEN_TASKS.find((task) =>
    task.brief.type === 'DISAMBIGUATION' && task.brief.targetField === 'last_activity'
  );
  assert.ok(spec);

  await env.reset(spec);
  await env.step({ type: 'initiate_call', target: spec.ambiguousName ?? 'Sarah' });

  installStubVoiceAgent(env, [{
    text: 'Which Sarah do you mean?',
    semanticEvents: [],
    toolEvents: [],
  }]);

  const result = await env.step({ type: 'speak', utterance: 'What is the last activity for Sarah?' });

  assert.equal(result.callerBehaviorEvaluation?.label, 'PREMATURE_TARGET_REQUEST');
  assert.equal(env.getCallerBehaviorMetrics().prematureTargetRequests, 1);
  assert.equal(env.getCallerBehaviorMetrics().ambiguousTurns, 1);
});

test('caller-side evaluator marks repeated clarification fields as redundant', async () => {
  const env = createEnv();
  const spec = GOLDEN_TASKS.find((task) => task.brief.type === 'RESOLVE_THEN_RETRIEVE');
  assert.ok(spec);

  await env.reset(spec);
  await env.step({ type: 'initiate_call', target: spec.callTarget ?? 'Technologies' });

  installStubVoiceAgent(env, [
    {
      text: 'Can you clarify further?',
      semanticEvents: [],
      toolEvents: [],
    },
    {
      text: 'Still not enough detail.',
      semanticEvents: [],
      toolEvents: [],
    },
  ]);

  const first = await env.step({ type: 'speak', utterance: 'Which account has active status?' });
  const second = await env.step({ type: 'speak', utterance: 'I mean the account with active status.' });

  assert.equal(first.callerBehaviorEvaluation?.label, 'GOOD_DISAMBIGUATION_QUESTION');
  assert.equal(second.callerBehaviorEvaluation?.label, 'REDUNDANT_DISAMBIGUATION');
  assert.equal(env.getCallerBehaviorMetrics().goodDisambiguationQuestions, 1);
  assert.equal(env.getCallerBehaviorMetrics().redundantClarifications, 1);
  assert.equal(env.getCallerBehaviorMetrics().ambiguousTurns, 2);
});
