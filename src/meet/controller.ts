export interface DomChatMessage {
  id: string;
  sender: string;
  text: string;
}

export interface DomCaption {
  speaker: string;
  text: string;
}

export interface MeetController {
  join(url: string): Promise<void>;
  postMessage(text: string): Promise<void>;
  scrapeChat(): Promise<DomChatMessage[]>;
  scrapeCaption(): Promise<DomCaption | null>;
  close(): Promise<void>;
}
