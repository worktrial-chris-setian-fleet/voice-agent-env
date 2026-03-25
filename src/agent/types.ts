import type { CallerBrief, EpisodeObservation } from '../env/types.js';

/** One structured action chosen by the caller agent. */
export interface AgentAction {
  /** Name of the environment-exposed tool/action to invoke next. */
  toolName: string;
  /** String arguments for that action, suitable for LLM tool calling. */
  arguments: Record<string, string>;
}

/**
 * Caller-agent contract.
 * Implementations receive only caller-visible environment data and return the next action.
 */
export interface Agent {
  /** Choose the next action from the current caller-visible observation. */
  act(observation: EpisodeObservation): Promise<AgentAction>;
  /** Reset any internal policy state for a new episode using the caller brief. */
  reset(brief: CallerBrief): void;
}
