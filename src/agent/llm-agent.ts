import Anthropic from '@anthropic-ai/sdk';
import type { Agent, AgentAction } from './types.js';
import type { CallerBrief, EpisodeObservation } from '../env/types.js';

const CALLER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'initiate_call',
    description: 'Dial a company or contact name to reach their CRM helpline. The call may or may not be answered.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Company name or contact name to call' },
      },
      required: ['target'],
    },
  },
  {
    name: 'speak',
    description: 'Send an utterance to the voice agent on the other end of the call. Use natural language to ask questions.',
    input_schema: {
      type: 'object',
      properties: {
        utterance: { type: 'string', description: 'What you want to say to the voice agent' },
      },
      required: ['utterance'],
    },
  },
  {
    name: 'submit_answer',
    description: 'Submit your final answer once you have retrieved the requested information. This ends the episode.',
    input_schema: {
      type: 'object',
      properties: {
        field: { type: 'string', description: 'The field name you retrieved (e.g. contract_value)' },
        value: { type: 'string', description: 'The value you retrieved from the voice agent' },
      },
      required: ['field', 'value'],
    },
  },
  {
    name: 'end_call',
    description: 'Hang up without submitting an answer. Use only if you cannot retrieve the information.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

const SYSTEM_PROMPT_TEMPLATE = `You are calling a CRM helpline to retrieve a specific piece of information.
You speak with a voice agent who has access to the CRM database.

TASK: {TASK_DESCRIPTION}
EXACT FIELD TOKEN TO SUBMIT: {TARGET_FIELD}

INSTRUCTIONS:
- Start by calling initiate_call with the company name or contact name from your task.
- If the call fails (answering machine, wrong number), retry with initiate_call.
- Use speak to ask questions in natural language. If the task gives only a partial identity plus a clue, first identify the correct account and then ask for the final field.
- When you have the answer, call submit_answer with field="{TARGET_FIELD}" exactly. Do not invent variants or aliases.
- Use end_call only if you truly cannot get the information.
- Each speak turn costs 1 point, so be efficient.`;

export class LLMAgent implements Agent {
  private anthropic: Anthropic;
  private messageHistory: Anthropic.MessageParam[] = [];
  private systemPrompt = '';
  private pendingToolUseId: string | null = null;
  private pendingToolResultIndex: number | null = null;

  constructor(anthropic: Anthropic) {
    this.anthropic = anthropic;
  }

  reset(brief: CallerBrief): void {
    this.messageHistory = [];
    this.pendingToolUseId = null;
    this.pendingToolResultIndex = null;
    this.systemPrompt = SYSTEM_PROMPT_TEMPLATE
      .replace('{TASK_DESCRIPTION}', brief.instructions)
      .replaceAll('{TARGET_FIELD}', brief.targetField);
  }

  async act(observation: EpisodeObservation): Promise<AgentAction> {
    if (observation.turnCount >= 20) {
      return { toolName: 'end_call', arguments: {} };
    }

    // Fill in the deferred tool result from the previous turn
    if (this.pendingToolUseId !== null && this.pendingToolResultIndex !== null) {
      const msg = this.messageHistory[this.pendingToolResultIndex];
      if (msg && Array.isArray(msg.content)) {
        const block = msg.content[0];
        if (block && block.type === 'tool_result') {
          block.content = observation.lastResponse;
        }
      }
      this.pendingToolUseId = null;
      this.pendingToolResultIndex = null;
    } else {
      // First call: push the initial user message describing the task
      const recentHistory = observation.conversationHistory.slice(-3);
      const historyText = recentHistory.length > 0
        ? recentHistory.map(turn => `${turn.speaker}: ${turn.utterance}`).join('\n')
        : '(no conversation yet)';

      const userMessage = `Current State:
- Call State: ${observation.callState}
- Turn Count: ${observation.turnCount}
- Last Response: ${observation.lastResponse}

Recent Conversation:
${historyText}

Take your next action.`;

      this.messageHistory.push({ role: 'user', content: userMessage });
    }

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: this.systemPrompt,
      messages: this.messageHistory,
      tools: CALLER_TOOLS,
    });

    if (response.stop_reason === 'tool_use') {
      const toolUseBlock = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      if (!toolUseBlock) {
        return { toolName: 'end_call', arguments: {} };
      }

      this.messageHistory.push({ role: 'assistant', content: response.content });

      // Placeholder tool result — filled with actual response on next act()
      const toolResultMsg: Anthropic.MessageParam = {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseBlock.id,
            content: '(result pending)',
          },
        ],
      };
      this.pendingToolResultIndex = this.messageHistory.length;
      this.messageHistory.push(toolResultMsg);
      this.pendingToolUseId = toolUseBlock.id;

      return {
        toolName: toolUseBlock.name,
        arguments: (toolUseBlock.input as Record<string, string>) ?? {},
      };
    }

    return { toolName: 'end_call', arguments: {} };
  }
}
