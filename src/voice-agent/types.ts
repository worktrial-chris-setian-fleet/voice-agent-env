import type { QueryableField } from '../crm/types.js';

export type LookupToolName = 'lookup_account' | 'search_contacts';

export interface VoiceAgentResolutionClue {
  field: QueryableField;
  value: string;
  label: string;
}

export type VoiceAgentSessionConfig =
  | {
      mode: 'default';
    }
  | {
      mode: 'resolve_then_retrieve';
      resolutionClues: VoiceAgentResolutionClue[];
    };

export type VoiceAgentEvent =
  | {
      type: 'lookup_result';
      tool: LookupToolName;
      query: string;
      matchCount: number;
      accountIds: string[];
    }
  | {
      type: 'lookup_failed';
      tool: LookupToolName;
      query: string;
    }
  | {
      type: 'field_retrieved';
      accountId: string;
      companyName: string;
      field: QueryableField;
      value: string;
    };

export interface VoiceAgentTurnResult {
  text: string;
  events: VoiceAgentEvent[];
}
