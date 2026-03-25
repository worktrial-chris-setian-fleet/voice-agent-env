/** Call lifecycle states used by the environment to validate actions and transitions. */
export type CallState =
  | 'IDLE' | 'DIALING' | 'ANSWERED' | 'ANSWERING_MACHINE'
  | 'WRONG_NUMBER' | 'NO_ANSWER' | 'CONVERSATION' | 'ENDED';

/** One utterance in the caller <-> voice-agent transcript. */
export interface DialogueTurn {
  /** Which side of the simulated call produced this utterance. */
  speaker: 'CALLER' | 'VOICE_AGENT';
  /** Raw natural-language content for this turn. */
  utterance: string;
}
