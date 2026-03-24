export type CallState =
  | 'IDLE' | 'DIALING' | 'ANSWERED' | 'ANSWERING_MACHINE'
  | 'WRONG_NUMBER' | 'NO_ANSWER' | 'CONVERSATION' | 'ENDED';

export interface DialogueTurn {
  speaker: 'CALLER' | 'VOICE_AGENT';
  utterance: string;
}
