import type { RewardEvent } from './types.js';

export const REWARD: Record<RewardEvent, number> = {
  CORRECT_ANSWER: 10,
  WRONG_ANSWER: -5,
  CALL_ENDED_NO_ANSWER: -3,
  ANSWERING_MACHINE: -2,
  WRONG_NUMBER: -2,
  TURN_PENALTY: -1, // base value; actual penalty scales with turnPenalty()
};

/**
 * Escalating turn penalty. Turns 1–4 cost -1, turns 5–7 cost -2, turns 8+ cost -3.
 * @param penaltyTurnNumber 1-indexed count of all penalized actions (initiate_call + speak).
 */
export function turnPenalty(penaltyTurnNumber: number): number {
  if (penaltyTurnNumber <= 4) return -1;
  if (penaltyTurnNumber <= 7) return -2;
  return -3;
}

export function computeReward(events: RewardEvent[]): number {
  return events.reduce((sum, e) => sum + REWARD[e], 0);
}
