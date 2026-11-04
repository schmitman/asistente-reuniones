export interface DomChatMessage {
  id: string;
  sender: string;
  text: string;
}

export interface DomCaption {
  speaker: string;
  text: string;
}

export interface AudioChunk {
  /** PCM16 mono 16 kHz de las voces remotas. */
  pcm: Int16Array;
  /** Cuántas pistas de audio remotas hay enganchadas. */
  tracks: number;
}

export interface MeetController {
  join(url: string): Promise<void>;
  postMessage(text: string): Promise<void>;
  scrapeChat(): Promise<DomChatMessage[]>;
  scrapeCaption(): Promise<DomCaption | null>;
  close(): Promise<void>;
  /** Opcional: false si el bot ya no está en la llamada (lo sacaron o terminó). */
  inCall?(): Promise<boolean>;
  /** Opcional: audio de la reunión. Si no existe, el runtime usa solo subtítulos. */
  onAudio?(listener: ((chunk: AudioChunk) => void) | null): void;
}
