export interface AgentAction {
  toolName: string;
  arguments: Record<string, string>;
}

export interface Agent {
  act(state: import('../env/types.js').EpisodeState): Promise<AgentAction>;
  reset(task: import('../env/types.js').Task): void;
}
