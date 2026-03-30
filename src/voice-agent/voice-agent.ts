import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { findById } from '../crm/store.js';
import type { QueryableField } from '../crm/types.js';
import { makeClueKey, normalizeAnswer, normalizeFieldName } from '../env/answer-utils.js';
import type {
  VoiceAgentResolutionClue,
  VoiceAgentSemanticEvent,
  VoiceAgentSessionConfig,
  VoiceAgentToolEvent,
  VoiceAgentTurnResult,
} from './types.js';

const VOICE_AGENT_SYSTEM_PROMPT = `You are a CRM helpline representative. Callers phone in to ask about account information.

Your job:
1. When a caller asks about an account, use lookup_account or search_contacts to find it.
2. If multiple accounts match, ask the caller to clarify which company they mean.
3. If the caller gives only a partial identity plus a distinguishing clue, use CRM fields to narrow the candidates.
4. When a request involves both identifying the right account and retrieving another field, resolve which account matches first before giving the final field value.
5. Once you have the right account ID, use get_account_field to retrieve the specific data.
6. Give clear, direct answers. Never guess or make up data — always use your tools.
7. Keep responses concise — one or two sentences is ideal.
8. IMPORTANT: Report data values exactly as they appear in the CRM — do not reformat dates, numbers, or other values.`;

type MultistepPhase = 'disabled' | 'resolving' | 'awaiting_follow_up' | 'retrieval_open';

export class VoiceAgent {
  private anthropic: Anthropic;
  private crmClient: Client;
  private history: Anthropic.MessageParam[] = [];
  private cachedTools: Anthropic.Tool[] | null = null;
  private sessionConfig: VoiceAgentSessionConfig = { mode: 'default' };
  private multistepPhase: MultistepPhase = 'disabled';
  private matchedCluesByAccount = new Map<string, { companyName: string; clueKeys: Set<string> }>();
  private resolvedAccountId: string | null = null;
  private resolvedCompanyName: string | null = null;

  constructor(anthropic: Anthropic, crmClient: Client) {
    this.anthropic = anthropic;
    this.crmClient = crmClient;
  }

  reset(config: VoiceAgentSessionConfig = { mode: 'default' }): void {
    this.history = [];
    this.cachedTools = null;
    this.sessionConfig = config;
    this.multistepPhase = config.mode === 'resolve_then_retrieve' ? 'resolving' : 'disabled';
    this.matchedCluesByAccount = new Map();
    this.resolvedAccountId = null;
    this.resolvedCompanyName = null;
  }

  async handleUtterance(callerUtterance: string): Promise<VoiceAgentTurnResult> {
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

    const allowNonClueRetrievalThisTurn = this.multistepPhase === 'awaiting_follow_up';
    if (allowNonClueRetrievalThisTurn) {
      this.multistepPhase = 'retrieval_open';
    }

    this.history.push({ role: 'user', content: callerUtterance });
    const semanticEvents: VoiceAgentSemanticEvent[] = [];
    const toolEvents: VoiceAgentToolEvent[] = [];

    // Agentic tool loop: run until end_turn
    while (true) {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: this.buildSystemPrompt(allowNonClueRetrievalThisTurn),
        messages: this.history,
        tools: this.cachedTools,
      });

      this.history.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
        return {
          text: textBlock ? textBlock.text : '(no response)',
          semanticEvents,
          toolEvents,
        };
      }

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
        );

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUseBlocks) {
          const blockedText = this.getBlockedToolResult(block, allowNonClueRetrievalThisTurn);
          if (blockedText !== null) {
            toolResults.push({
              type: 'tool_result' as const,
              tool_use_id: block.id,
              content: blockedText,
            });
            continue;
          }

          const result = await this.crmClient.callTool({
            name: block.name,
            arguments: block.input as Record<string, string>,
          });
          const text = (result.content as Array<{ type: string; text: string }>)
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
          const newToolEvents = extractToolEvents(block.name, block.input as Record<string, string>, text);
          toolEvents.push(...newToolEvents);
          const newSemanticEvents = this.deriveSemanticEvents(newToolEvents);
          semanticEvents.push(...newSemanticEvents);
          toolResults.push({
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: text,
          });
        }

        this.history.push({ role: 'user', content: toolResults });
      }
    }
  }

  private buildSystemPrompt(allowNonClueRetrievalThisTurn: boolean): string {
    if (this.sessionConfig.mode !== 'resolve_then_retrieve') {
      return VOICE_AGENT_SYSTEM_PROMPT;
    }

    const clueSummary = this.sessionConfig.resolutionClues
      .map(clue => `${clue.field}=${clue.value}`)
      .join(', ');

    if (allowNonClueRetrievalThisTurn && this.resolvedAccountId && this.resolvedCompanyName) {
      return `${VOICE_AGENT_SYSTEM_PROMPT}

This call is in RESOLVE_THEN_RETRIEVE mode.
- You have already resolved the matching account to "${this.resolvedCompanyName}" (account ID ${this.resolvedAccountId}) using the caller's clues: ${clueSummary}.
- The caller has now taken the required follow-up turn.
- You may now retrieve the next requested non-clue field for that resolved account.
- If the caller is still vague, briefly remind them which account was identified and ask what field they need.`;
    }

    return `${VOICE_AGENT_SYSTEM_PROMPT}

This call is in RESOLVE_THEN_RETRIEVE mode.
- First identify which account matches the caller's clues: ${clueSummary}.
- During this resolution phase, only retrieve clue fields that help identify the right account.
- Do not provide non-clue account fields during this same caller turn, even if the caller asked for them.
- Once the clues point to a single account, tell the caller which account you found and invite a natural follow-up question about what they need next.`;
  }

  private getBlockedToolResult(
    block: Anthropic.ToolUseBlock,
    allowNonClueRetrievalThisTurn: boolean
  ): string | null {
    if (this.sessionConfig.mode !== 'resolve_then_retrieve' || allowNonClueRetrievalThisTurn) {
      return null;
    }

    if (block.name !== 'get_account_field') {
      return null;
    }

    const field = normalizeFieldName(String((block.input as Record<string, unknown>)['field'] ?? ''));
    const allowedFields = new Set(
      this.sessionConfig.resolutionClues.map(clue => normalizeFieldName(clue.field))
    );

    if (allowedFields.has(field)) {
      return null;
    }

    return 'Resolution first: identify the matching account using the caller\'s clues, tell the caller which account you found, and ask a natural follow-up question before retrieving other account fields.';
  }

  private deriveSemanticEvents(toolEvents: VoiceAgentToolEvent[]): VoiceAgentSemanticEvent[] {
    const semanticEvents: VoiceAgentSemanticEvent[] = [];

    for (const event of toolEvents) {
      if (event.type === 'lookup_result' && event.accountIds.length === 1) {
        const account = findById(event.accountIds[0]!);
        if (account) {
          semanticEvents.push({
            type: 'account_resolved',
            accountId: account.id,
            companyName: account.company_name,
          });
        }
      }

      if (event.type === 'lookup_failed') {
        semanticEvents.push({
          type: 'lookup_failed',
          tool: event.tool,
          query: event.query,
        });
        continue;
      }

      if (event.type !== 'field_retrieved') {
        continue;
      }

      semanticEvents.push({
        type: 'field_returned',
        accountId: event.accountId,
        companyName: event.companyName,
        field: event.field,
        value: event.value,
      });

      if (
        this.resolvedAccountId !== event.accountId &&
        (this.sessionConfig.mode !== 'resolve_then_retrieve' || this.multistepPhase !== 'resolving')
      ) {
        semanticEvents.push({
          type: 'account_resolved',
          accountId: event.accountId,
          companyName: event.companyName,
        });
      }

      if (this.sessionConfig.mode !== 'resolve_then_retrieve' || this.multistepPhase !== 'resolving') {
        continue;
      }

      const matchedClue = this.sessionConfig.resolutionClues.find((clue) =>
        normalizeFieldName(clue.field) === normalizeFieldName(event.field) &&
        normalizeAnswer(clue.value) === normalizeAnswer(event.value)
      );

      if (!matchedClue) {
        continue;
      }

      semanticEvents.push({
        type: 'resolution_clue_confirmed',
        clue: matchedClue,
        accountId: event.accountId,
        companyName: event.companyName,
      });

      const clueKey = makeClueKey(matchedClue.field, matchedClue.value);
      const existing = this.matchedCluesByAccount.get(event.accountId) ?? {
        companyName: event.companyName,
        clueKeys: new Set<string>(),
      };
      existing.companyName = event.companyName;
      existing.clueKeys.add(clueKey);
      this.matchedCluesByAccount.set(event.accountId, existing);

      if (
        existing.clueKeys.size === this.sessionConfig.resolutionClues.length &&
        this.resolvedAccountId !== event.accountId
      ) {
        this.resolvedAccountId = event.accountId;
        this.resolvedCompanyName = event.companyName;
        this.multistepPhase = 'awaiting_follow_up';
        semanticEvents.push({
          type: 'account_resolved',
          accountId: event.accountId,
          companyName: event.companyName,
        });
        semanticEvents.push({
          type: 'follow_up_requested',
          accountId: event.accountId,
          companyName: event.companyName,
        });
      }
    }

    return semanticEvents;
  }
}

function extractToolEvents(
  toolName: string,
  input: Record<string, string>,
  text: string
): VoiceAgentToolEvent[] {
  if (toolName === 'lookup_account' || toolName === 'search_contacts') {
    const query = input['name'] ?? '';
    const parsed = parseJson<Array<{ id?: string; account_id?: string }>>(text);
    if (!parsed || parsed.length === 0) {
      return [{ type: 'lookup_failed', tool: toolName, query }];
    }

    const accountIds = [...new Set(
      parsed
        .map(item => item.id ?? item.account_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )];

    return [{
      type: 'lookup_result',
      tool: toolName,
      query,
      matchCount: parsed.length,
      accountIds,
    }];
  }

  if (toolName === 'get_account_field') {
    const parsed = parseJson<{ company_name?: string; field?: string; value?: string }>(text);
    const accountId = input['account_id'];
    const field = input['field'];

    if (
      parsed &&
      typeof parsed.company_name === 'string' &&
      typeof parsed.value === 'string' &&
      typeof accountId === 'string' &&
      typeof field === 'string'
    ) {
      return [{
        type: 'field_retrieved',
        accountId,
        companyName: parsed.company_name,
        field: field as QueryableField,
        value: parsed.value,
      }];
    }
  }

  return [];
}

function parseJson<T>(text: string): T | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}
