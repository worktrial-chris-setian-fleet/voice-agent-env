import type { QueryableField } from '../crm/types.js';

/** CRM lookup tools that search for candidate accounts or contacts. */
export type LookupToolName = 'lookup_account' | 'search_contacts';

/** One resolution clue passed from the environment into the voice-agent session. */
export interface VoiceAgentResolutionClue {
  /** CRM field the voice agent may use to narrow candidates. */
  field: QueryableField;
  /** Ground-truth clue value the voice agent is expected to surface. */
  value: string;
  /** Human-readable label for logs and semantic events. */
  label: string;
}

/** Per-episode voice-agent operating mode configured by the environment. */
export type VoiceAgentSessionConfig =
  | {
      /** Standard lookup behavior with no special multistep gating. */
      mode: 'default';
    }
  | {
      /** Multistep mode where account resolution must happen before final retrieval. */
      mode: 'resolve_then_retrieve';
      /** Clues the voice agent may use during the resolution phase. */
      resolutionClues: VoiceAgentResolutionClue[];
    };

/** Low-level trace of CRM tool outcomes produced during one voice-agent turn. */
export type VoiceAgentToolEvent =
  | {
      /** A lookup tool returned one or more candidate matches. */
      type: 'lookup_result';
      /** Which lookup tool produced the result. */
      tool: LookupToolName;
      /** Query string supplied to the lookup tool. */
      query: string;
      /** Number of raw matches returned. */
      matchCount: number;
      /** Unique account IDs present in the lookup results. */
      accountIds: string[];
    }
  | {
      /** A lookup tool returned no usable matches. */
      type: 'lookup_failed';
      /** Which lookup tool failed to find a match. */
      tool: LookupToolName;
      /** Query string that failed. */
      query: string;
    }
  | {
      /** A CRM field was retrieved for a specific account. */
      type: 'field_retrieved';
      /** Account ID used for the retrieval. */
      accountId: string;
      /** Company name associated with that account. */
      companyName: string;
      /** CRM field that was retrieved. */
      field: QueryableField;
      /** Exact CRM value returned by the tool. */
      value: string;
    };

/** Higher-level environment-facing events derived from raw tool activity. */
export type VoiceAgentSemanticEvent =
  | {
      /** The voice agent could not find a candidate using a lookup tool. */
      type: 'lookup_failed';
      /** Which lookup tool failed. */
      tool: LookupToolName;
      /** Query string that failed. */
      query: string;
    }
  | {
      /** One required resolution clue was confirmed for a specific account. */
      type: 'resolution_clue_confirmed';
      /** The clue that was confirmed. */
      clue: VoiceAgentResolutionClue;
      /** Account ID that matched the clue. */
      accountId: string;
      /** Company name for the matching account. */
      companyName: string;
    }
  | {
      /** The voice agent has resolved which account the caller means. */
      type: 'account_resolved';
      /** Resolved account ID. */
      accountId: string;
      /** Resolved company name. */
      companyName: string;
    }
  | {
      /** The voice agent has asked the caller for the next retrieval step. */
      type: 'follow_up_requested';
      /** Account ID the follow-up refers to. */
      accountId: string;
      /** Company name the follow-up refers to. */
      companyName: string;
    }
  | {
      /** The requested or observed CRM field value was returned to the caller. */
      type: 'field_returned';
      /** Account ID the field belongs to. */
      accountId: string;
      /** Company name the field belongs to. */
      companyName: string;
      /** Returned CRM field name. */
      field: QueryableField;
      /** Exact value returned for that field. */
      value: string;
    };

/** Full result of one voice-agent response turn. */
export interface VoiceAgentTurnResult {
  /** Natural-language text spoken back to the caller. */
  text: string;
  /** High-level semantic events for environment scoring and observability. */
  semanticEvents: VoiceAgentSemanticEvent[];
  /** Low-level raw tool trace retained for debugging and replay. */
  toolEvents: VoiceAgentToolEvent[];
}
