import type { CaptureMode } from './types';
export interface CaptureResult { media: Blob; audio: Blob; duration: number; mimeType: string }
export interface ActiveCapture { stop(): Promise<CaptureResult>; stream: MediaStream }
export function chooseMime(video: boolean) {
  const candidates = video ? ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}
export async function startCapture(mode: CaptureMode, microphone: boolean, onEnded: () => void, onError: (message: string) => void): Promise<ActiveCapture> {
  if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('此设备不支持网页录制，请使用声记安装包。');
  const acquired: MediaStream[] = [];
  let context: AudioContext | undefined;
  let stopping: Promise<CaptureResult> | undefined;
  let finished = false;
  const cleanup = () => { acquired.forEach(s => s.getTracks().forEach(t => t.stop())); void context?.close(); };
  try {
    const screen = mode === 'screen' ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 24 }, audio: true }) : undefined;
    if (screen) acquired.push(screen);
    const mic = (mode === 'audio' || microphone) ? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }) : undefined;
    if (mic) acquired.push(mic);
    const sources = acquired.filter(s => s.getAudioTracks().length);
    if (!sources.length) throw new Error('没有可录制的声音。请打开麦克风，或在屏幕共享时勾选共享音频。');
    context = new AudioContext();
    await context.resume();
    const mix = context.createMediaStreamDestination();
    sources.forEach(source => context!.createMediaStreamSource(new MediaStream(source.getAudioTracks())).connect(mix));
    acquired.push(mix.stream);
    const combined = new MediaStream([...(screen?.getVideoTracks() || []), ...mix.stream.getAudioTracks()]);
    const videoMime = chooseMime(mode === 'screen'), audioMime = chooseMime(false);
    const recorder = new MediaRecorder(combined, { ...(videoMime ? { mimeType: videoMime } : {}), videoBitsPerSecond: 1_500_000 });
    const audioRecorder = mode === 'screen' ? new MediaRecorder(mix.stream, audioMime ? { mimeType: audioMime } : {}) : recorder;
    const mediaChunks: Blob[] = [], audioChunks: Blob[] = [];
    let bytes = 0, limitNotified = false;
    const collect = (target: Blob[], event: BlobEvent) => {
      if (event.data.size) { target.push(event.data); bytes += event.data.size; }
      if (bytes > 200 * 1024 * 1024 && !limitNotified) { limitNotified = true; onError('本次录制已达到 200 MB，正在自动保存。'); onEnded(); }
    };
    recorder.ondataavailable = e => collect(mediaChunks, e);
    if (audioRecorder !== recorder) audioRecorder.ondataavailable = e => collect(audioChunks, e);
    const begun = performance.now();
    const waitStop = (r: MediaRecorder) => new Promise<void>((resolve, reject) => {
      if (r.state === 'inactive') return resolve();
      r.addEventListener('stop', () => resolve(), { once: true });
      r.addEventListener('error', () => reject(new Error('录制异常中止，请检查设备权限和剩余空间。')), { once: true });
      r.stop();
    });
    recorder.onerror = () => { onError('录制设备发生错误，正在保存已录制的内容。'); onEnded(); };
    if (audioRecorder !== recorder) audioRecorder.onerror = recorder.onerror;
    recorder.start(1000);
    if (audioRecorder !== recorder) audioRecorder.start(1000);
    screen?.getVideoTracks().forEach(track => track.addEventListener('ended', () => { if (!finished) onEnded(); }, { once: true }));
    return {
      stream: combined,
      stop() {
        if (stopping) return stopping;
        finished = true;
        stopping = (async () => {
          try {
            await Promise.all([...new Set([recorder, audioRecorder])].map(waitStop));
            const media = new Blob(mediaChunks, { type: recorder.mimeType || videoMime });
            const audio = audioRecorder === recorder ? media : new Blob(audioChunks, { type: audioRecorder.mimeType || audioMime });
            if (!media.size || !audio.size) throw new Error('录制时间太短，没有生成音频。请再试一次。');
            return { media, audio, mimeType: media.type, duration: (performance.now() - begun) / 1000 };
          } finally { cleanup(); }
        })();
        return stopping;
      }
    };
  } catch (error) { cleanup(); throw error; }
}
