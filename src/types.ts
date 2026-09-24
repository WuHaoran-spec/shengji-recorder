export interface Segment { id: string; start: number; end: number; text: string }
export interface Recording {
  id: string; title: string; createdAt: string; duration: number;
  mode: 'audio' | 'screen' | 'import'; mimeType: string;
  media: Blob; audio: Blob; segments: Segment[];
  status: 'pending' | 'done' | 'error'; error?: string;
}
export type CaptureMode = 'audio' | 'screen';
