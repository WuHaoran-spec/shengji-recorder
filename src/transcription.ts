import type { Segment } from './types';

export type { Segment } from './types';
import { decodeAudio, isSilent } from './audio';
export { SAMPLE_RATE, MAX_DURATION_SECONDS, decodeAudio, decodeWav, resampleMono, audioWindows, isSilent, offsetSegments } from './audio';

export interface TranscriptionOptions {
  language: string;
  onProgress: (progress: number, message: string) => void;
  signal?: AbortSignal;
}

const abortError = () => new DOMException('转写已取消', 'AbortError');
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }

/** Everything stays on this device. A fresh worker releases model memory after each job. */
export async function transcribe(audio: Blob, options: TranscriptionOptions): Promise<Segment[]> {
  const { signal, onProgress } = options;
  checkAbort(signal);
  onProgress(0, '正在读取音频');
  const samples = await decodeAudio(audio, signal);
  checkAbort(signal);
  if (isSilent(samples)) { onProgress(100, '未检测到语音'); return []; }
  onProgress(3, '正在载入内置离线模型');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(abortError()); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'progress') onProgress(message.progress, message.message);
      else if (message.type === 'complete') { cleanup(); onProgress(100, '转写完成'); resolve(message.segments); }
      else if (message.type === 'error') { cleanup(); reject(new Error(message.message)); }
    };
    worker.onerror = (event) => { cleanup(); reject(new Error(`离线转写组件启动失败：${event.message || '请重新打开应用'}`)); };
    const assetBase = new URL(import.meta.env.BASE_URL, document.baseURI).href;
    worker.postMessage({ audio: samples, language: options.language, assetBase }, [samples.buffer]);
  });
}

