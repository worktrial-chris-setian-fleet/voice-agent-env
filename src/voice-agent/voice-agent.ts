import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const VOICE_AGENT_SYSTEM_PROMPT = `You are a CRM helpline representative. Callers phone in to ask about account information.

Your job:
1. When a caller asks about an account, use lookup_account or search_contacts to find it.
2. If multiple accounts match, ask the caller to clarify which company they mean.
3. Once you have the right account ID, use get_account_field to retrieve the specific data.
4. Give clear, direct answers. Never guess or make up data — always use your tools.
5. Keep responses concise — one or two sentences is ideal.
6. IMPORTANT: Report data values exactly as they appear in the CRM — do not reformat dates, numbers, or other values.`;

export class VoiceAgent {
  private anthropic: Anthropic;
  private crmClient: Client;
  private history: Anthropic.MessageParam[] = [];
  private cachedTools: Anthropic.Tool[] | null = null;

  constructor(anthropic: Anthropic, crmClient: Client) {
    this.anthropic = anthropic;
    this.crmClient = crmClient;
  }

  reset(): void {
    this.history = [];
    this.cachedTools = null;
  }

  async handleUtterance(callerUtterance: string): Promise<string> {
    // Fetch CRM tools on first use per episode
    if (this.cachedTools === null) {
      const toolsResult = await this.crmClient.listTools();
      this.cachedTools = toolsResult.tools.map(t => ({
        name: t.name,
        description: t.description ?? '',
        input_schema: {
          ...t.inputSchema,
          type: 'object' as const,
        },
      }));
    }

    this.history.push({ role: 'user', content: callerUtterance });

    // Agentic tool loop: run until end_turn
    while (true) {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: VOICE_AGENT_SYSTEM_PROMPT,
        messages: this.history,
        tools: this.cachedTools,
      });

      this.history.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
        return textBlock ? textBlock.text : '(no response)';
      }

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
        );

        const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
          toolUseBlocks.map(async (block) => {
            const result = await this.crmClient.callTool({
              name: block.name,
              arguments: block.input as Record<string, string>,
            });
            const text = (result.content as Array<{ type: string; text: string }>)
              .filter(c => c.type === 'text')
              .map(c => c.text)
              .join('\n');
            return {
              type: 'tool_result' as const,
              tool_use_id: block.id,
              content: text,
            };
          })
        );

        this.history.push({ role: 'user', content: toolResults });
      }
    }
  }
}
