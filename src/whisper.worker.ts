import { env, pipeline } from '@huggingface/transformers';
import { audioWindows, isSilent, offsetSegments, SAMPLE_RATE } from './audio';
import type { Segment } from './types';

const MODEL = 'Xenova/whisper-tiny';
const LANGUAGE_NAMES: Record<string, string> = { zh: 'chinese', en: 'english', ja: 'japanese', ko: 'korean', fr: 'french', de: 'german', es: 'spanish', ru: 'russian' };
let busy = false;

self.onmessage = async (event: MessageEvent<{ audio: Float32Array; language: string; assetBase: string }>) => {
  if (busy) return;
  busy = true;
  const sendProgress = (progress: number, message: string) => self.postMessage({ type: 'progress', progress, message });
  try {
    const { audio, language, assetBase } = event.data;
    const base = new URL(assetBase);
    const modelPath = new URL('models/', base).href;
    const wasmPath = new URL('ort/', base).href;
    // Bundled native apps never fall back to a model hub or CDN.
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = modelPath;
    env.useBrowserCache = false;
    env.useFSCache = false;
    const wasm = env.backends.onnx.wasm;
    if (!wasm) throw new Error('WASM 运行时未打包');
    wasm.wasmPaths = wasmPath;
    wasm.numThreads = 1;
    wasm.proxy = false;
    const localFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), base);
      if (!url.href.startsWith(modelPath) && !url.href.startsWith(wasmPath)) {
        return Promise.reject(new Error('隐私保护：离线转写禁止外部网络请求。'));
      }
      return localFetch(input, init);
    };
    let maxProgress = 3;
    const recognizer = await pipeline('automatic-speech-recognition', MODEL, {
      device: 'wasm', dtype: 'q8', local_files_only: true,
      progress_callback: (info) => {
        if (info.status === 'progress') {
          maxProgress = Math.max(maxProgress, Math.min(18, 3 + info.progress * 0.15));
          sendProgress(maxProgress, '正在读取内置模型（不会连接互联网）');
        }
      },
    });
    const windows = audioWindows(audio);
    const segments: Segment[] = [];
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i];
      sendProgress(20 + 78 * window.start / audio.length, `正在离线转写 ${i + 1} / ${windows.length} 段`);
      const samples = audio.subarray(window.start, window.end);
      if (isSilent(samples)) continue;
      const result = await recognizer(samples, {
        return_timestamps: true, task: 'transcribe',
        ...(language && language !== 'auto' ? { language: LANGUAGE_NAMES[language] ?? language } : {}),
      });
      const output = Array.isArray(result) ? result[0] : result;
      segments.push(...offsetSegments(output, window.start / SAMPLE_RATE, samples.length / SAMPLE_RATE, `segment-${i}`));
    }
    await recognizer.dispose();
    self.postMessage({ type: 'complete', segments });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: 'error', message: `离线转写失败：${detail}。请确认使用包含模型的完整安装包；开发环境先运行 npm run model:prepare。` });
  }
};

