import type { RewardEvent } from './types.js';

export const REWARD: Record<RewardEvent, number> = {
  CORRECT_ANSWER: 10,
  WRONG_ANSWER: -5,
  CALL_ENDED_NO_ANSWER: -3,
  ANSWERING_MACHINE: -2,
  WRONG_NUMBER: -2,
  INVALID_ACTION: -2,
  GOOD_DISAMBIGUATION_QUESTION: 1,
  PREMATURE_TARGET_REQUEST: -1,
  REDUNDANT_DISAMBIGUATION: -1,
  TURN_PENALTY: -1, // base value; applied to spoken turns and retry dial attempts
};

/**
 * Escalating turn penalty. Penalized turns 1–4 cost -1, 5–7 cost -2, 8+ cost -3.
 * @param penaltyTurnNumber 1-indexed count of penalized actions. The first dial attempt is free.
 */
export function turnPenalty(penaltyTurnNumber: number): number {
  if (penaltyTurnNumber <= 4) return -1;
  if (penaltyTurnNumber <= 7) return -2;
  return -3;
}

export function computeReward(events: RewardEvent[]): number {
  return events.reduce((sum, e) => sum + REWARD[e], 0);
}
