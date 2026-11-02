export interface PanelChatLine {
  ts: string;
  sender: string;
  text: string;
  addressed: boolean;
  reply: string | null;
}

export interface PanelTranscriptLine {
  ts: string;
  speaker: string;
  text: string;
  source: string;
}

export interface PanelSuggestion {
  ts: string;
  kind: string;
  text: string;
}

export interface PanelSnapshot {
  status: 'idle' | 'joining' | 'live' | 'error' | 'left';
  meetingUrl: string | null;
  meetingId: string | null;
  displayName: string;
  detailLevel: string;
  candidateCount: number;
  lastError: string | null;
  consentPosted: boolean;
  chat: PanelChatLine[];
  transcript: PanelTranscriptLine[];
  suggestions: PanelSuggestion[];
  suggestionNote: string;
}

export const SUGGESTION_NOTE =
  'Todavía no hay sugerencias proactivas. En la etapa 3 van a aparecer acá, y no se publican en el chat de la reunión.';
