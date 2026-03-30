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
  assert.deepEqual(resolutionStep.rewardEvents, ['TURN_PENALTY', 'GOOD_DISAMBIGUATION_QUESTION']);

  const retrievalStep = await env.step({ type: 'speak', utterance: 'Great, what is the contract value?' });
  assert.equal(retrievalStep.progress.phase, 'RETRIEVED');
  assert.equal(retrievalStep.progress.targetFieldObserved, true);
  assert.equal(retrievalStep.progressUpdate.targetFieldObservedThisTurn, true);
  assert.equal(retrievalStep.progress.resolvedCompanyName, 'Umbrella Technologies');
  assert.equal(retrievalStep.reward, -1);
  assert.deepEqual(retrievalStep.rewardEvents, ['TURN_PENALTY']);
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
  assert.equal(result.reward, 0);
  assert.deepEqual(result.rewardEvents, ['TURN_PENALTY', 'GOOD_DISAMBIGUATION_QUESTION']);
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
  assert.equal(result.reward, -2);
  assert.deepEqual(result.rewardEvents, ['TURN_PENALTY', 'PREMATURE_TARGET_REQUEST']);
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
  assert.equal(second.reward, -2);
  assert.deepEqual(second.rewardEvents, ['TURN_PENALTY', 'REDUNDANT_DISAMBIGUATION']);
  assert.equal(env.getCallerBehaviorMetrics().goodDisambiguationQuestions, 1);
  assert.equal(env.getCallerBehaviorMetrics().redundantClarifications, 1);
  assert.equal(env.getCallerBehaviorMetrics().ambiguousTurns, 2);
});

test('voice-agent resolution events do not create intermediate reward without a good caller question', async () => {
  const env = createEnv();
  const spec = GOLDEN_TASKS.find((task) => task.brief.type === 'RESOLVE_THEN_RETRIEVE');
  assert.ok(spec);

  await env.reset(spec);
  await env.step({ type: 'initiate_call', target: spec.callTarget ?? 'Technologies' });

  installStubVoiceAgent(env, [{
    text: 'I found Umbrella Technologies. What would you like to know?',
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
  }]);

  const result = await env.step({ type: 'speak', utterance: 'Can you help me with this account?' });

  assert.equal(result.callerBehaviorEvaluation?.label, null);
  assert.equal(result.reward, -1);
  assert.deepEqual(result.rewardEvents, ['TURN_PENALTY']);
});

test('target-field follow-up is not penalized after a disambiguation task is resolved', async () => {
  const env = createEnv();
  const spec = GOLDEN_TASKS.find((task) =>
    task.brief.type === 'DISAMBIGUATION' && task.brief.targetField === 'last_activity'
  );
  assert.ok(spec);

  await env.reset(spec);
  await env.step({ type: 'initiate_call', target: spec.ambiguousName ?? 'Sarah' });

  installStubVoiceAgent(env, [
    {
      text: 'The right account is Soylent Corp under Sarah Waugh. What would you like to know?',
      semanticEvents: [
        {
          type: 'account_resolved',
          accountId: spec.targetAccountId,
          companyName: 'Soylent Corp',
        },
      ],
      toolEvents: [],
    },
    {
      text: 'The last activity is 2026-01-14.',
      semanticEvents: [
        {
          type: 'field_returned',
          accountId: spec.targetAccountId,
          companyName: 'Soylent Corp',
          field: spec.brief.targetField,
          value: spec.targetValue,
        },
      ],
      toolEvents: [],
    },
  ]);

  const resolutionStep = await env.step({ type: 'speak', utterance: 'Which company is the right Sarah account?' });
  const retrievalStep = await env.step({ type: 'speak', utterance: 'What is the last activity for Soylent Corp?' });

  assert.equal(resolutionStep.callerBehaviorEvaluation?.label, 'GOOD_DISAMBIGUATION_QUESTION');
  assert.equal(retrievalStep.callerBehaviorEvaluation?.label, null);
  assert.equal(retrievalStep.reward, -1);
  assert.deepEqual(retrievalStep.rewardEvents, ['TURN_PENALTY']);
  assert.equal(env.getCallerBehaviorMetrics().turnsToResolution, 1);
});

test('disambiguation stays unresolved when the voice agent only inspects candidate fields', async () => {
  const env = createEnv();
  const spec = GOLDEN_TASKS.find((task) =>
    task.brief.type === 'DISAMBIGUATION' && task.brief.targetField === 'last_activity'
  );
  assert.ok(spec);

  await env.reset(spec);
  await env.step({ type: 'initiate_call', target: spec.ambiguousName ?? 'Sarah' });

  installStubVoiceAgent(env, [
    {
      text: 'I checked the candidate Sarah accounts, but I still need you to confirm which company you mean.',
      semanticEvents: [
        {
          type: 'field_returned',
          accountId: spec.targetAccountId,
          companyName: 'Soylent Corp',
          field: 'deal_stage',
          value: 'renewal',
        },
      ],
      toolEvents: [],
    },
    {
      text: 'The right Sarah is at Soylent Corp. What would you like to know?',
      semanticEvents: [
        {
          type: 'account_resolved',
          accountId: spec.targetAccountId,
          companyName: 'Soylent Corp',
        },
      ],
      toolEvents: [],
    },
  ]);

  const inspectionStep = await env.step({ type: 'speak', utterance: 'Can you compare the Sarah accounts by deal stage?' });
  assert.equal(inspectionStep.progress.resolvedCompanyName, null);
  assert.equal(inspectionStep.progressUpdate.resolvedCompanyNameThisTurn, null);
  assert.equal(env.getCallerBehaviorMetrics().ambiguousTurns, 1);
  assert.equal(env.getCallerBehaviorMetrics().turnsToResolution, null);

  const resolvedStep = await env.step({ type: 'speak', utterance: 'Which company is the right Sarah account?' });
  assert.equal(resolvedStep.progress.resolvedCompanyName, 'Soylent Corp');
  assert.equal(resolvedStep.progressUpdate.resolvedCompanyNameThisTurn, 'Soylent Corp');
  assert.equal(env.getCallerBehaviorMetrics().ambiguousTurns, 2);
  assert.equal(env.getCallerBehaviorMetrics().turnsToResolution, 2);
});
