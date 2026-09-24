import type { Segment } from './types';

export const SAMPLE_RATE = 16_000;
export const MAX_DURATION_SECONDS = 30 * 60;

const abortError = () => new DOMException('转写已取消', 'AbortError');
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }

/** Decode ordinary PCM/IEEE float WAV without browser codec dependencies. */
export function decodeWav(data: ArrayBuffer): { samples: Float32Array; sampleRate: number } | null {
  const view = new DataView(data);
  const text = (offset: number, size: number) => String.fromCharCode(...new Uint8Array(data, offset, size));
  if (data.byteLength < 12 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') return null;
  let channels = 0, sampleRate = 0, bits = 0, format = 0, blockAlign = 0;
  let dataOffset = 0, dataLength = 0;
  for (let offset = 12; offset + 8 <= data.byteLength;) {
    const kind = text(offset, 4), size = view.getUint32(offset + 4, true), start = offset + 8;
    if (start + size > data.byteLength) throw new Error('WAV 音频不完整，请重新录制或导入。');
    if (kind === 'fmt ' && size >= 16) {
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      blockAlign = view.getUint16(start + 12, true);
      bits = view.getUint16(start + 14, true);
      if (format === 0xfffe && size >= 40) format = view.getUint16(start + 24, true);
    } else if (kind === 'data' && !dataOffset) { dataOffset = start; dataLength = size; }
    offset = start + size + (size % 2);
  }
  if (![1, 3].includes(format) || !channels || !sampleRate || !dataOffset) return null;
  if ((format === 1 && ![8, 16, 24, 32].includes(bits)) || (format === 3 && ![32, 64].includes(bits))) return null;
  if (channels > 32 || sampleRate < 1000 || sampleRate > 384000 || blockAlign !== channels * bits / 8) throw new Error('WAV 格式参数无效。');
  const frames = Math.floor(dataLength / blockAlign);
  if (frames / sampleRate > MAX_DURATION_SECONDS) throw new Error('单次音频最长支持 30 分钟，请拆分后导入。');
  const samples = new Float32Array(frames);
  const bytes = bits / 8;
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const offset = dataOffset + i * blockAlign + c * bytes;
      let value: number;
      if (format === 3) value = bits === 32 ? view.getFloat32(offset, true) : view.getFloat64(offset, true);
      else if (bits === 8) value = (view.getUint8(offset) - 128) / 128;
      else if (bits === 16) value = view.getInt16(offset, true) / 32768;
      else if (bits === 24) {
        const n = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16);
        value = n / 8388608;
      } else value = view.getInt32(offset, true) / 2147483648;
      sum += Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    }
    samples[i] = sum / channels;
  }
  return { samples, sampleRate };
}

/** Area-average downsampling; linear interpolation when upsampling. */
export function resampleMono(samples: Float32Array, from: number, to = SAMPLE_RATE): Float32Array {
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to) || to <= 0) throw new Error('无效采样率');
  if (from === to || samples.length === 0) return samples;
  const ratio = from / to;
  const result = new Float32Array(Math.ceil(samples.length / ratio));
  for (let i = 0; i < result.length; i++) {
    const start = i * ratio;
    if (ratio < 1) {
      const left = Math.floor(start), fraction = start - left;
      result[i] = samples[left] * (1 - fraction) + samples[Math.min(left + 1, samples.length - 1)] * fraction;
    } else {
      const end = Math.min((i + 1) * ratio, samples.length);
      let sum = 0;
      for (let j = Math.floor(start); j < Math.ceil(end); j++) sum += samples[j] * (Math.min(j + 1, end) - Math.max(j, start));
      result[i] = sum / (end - start);
    }
  }
  return result;
}

export async function decodeAudio(audio: Blob, signal?: AbortSignal): Promise<Float32Array> {
  checkAbort(signal);
  if (!audio.size) throw new Error('音频为空，请先录制或导入音频。');
  const data = await audio.arrayBuffer();
  checkAbort(signal);
  const wav = decodeWav(data);
  if (wav) return resampleMono(wav.samples, wav.sampleRate);
  if (typeof AudioContext === 'undefined') throw new Error('此设备不支持音频解码，请导入 PCM WAV 格式。');
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const decoded = await context.decodeAudioData(data);
    checkAbort(signal);
    if (decoded.duration > MAX_DURATION_SECONDS) throw new Error('单次音频最长支持 30 分钟，请拆分后导入。');
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const channel = decoded.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / decoded.numberOfChannels;
    }
    return resampleMono(mono, decoded.sampleRate);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'EncodingError') throw new Error('无法解码此音频，请使用 WAV、MP3、M4A 或 WebM 音频。');
    throw error;
  } finally { await context.close(); }
}

export interface AudioWindow { start: number; end: number }
/** Up to 30 seconds per inference, cutting near quiet gaps when possible. */
export function audioWindows(samples: Float32Array, sampleRate = SAMPLE_RATE): AudioWindow[] {
  const result: AudioWindow[] = [];
  const maximum = sampleRate * 30;
  const block = Math.max(1, Math.round(sampleRate * 0.1));
  for (let start = 0; start < samples.length;) {
    let end = Math.min(start + maximum, samples.length);
    if (end < samples.length) {
      let bestEnergy = Infinity, best = end;
      for (let at = start + sampleRate * 24; at + block <= end; at += block) {
        let energy = 0;
        for (let i = at; i < at + block; i++) energy += samples[i] * samples[i];
        if (energy <= bestEnergy) { bestEnergy = energy; best = at + Math.floor(block / 2); }
      }
      // Keep full windows for continuous speech; only move boundaries into quiet gaps.
      if (bestEnergy / block < 0.000025) end = best;
    }
    result.push({ start, end }); start = end;
  }
  return result;
}

export function isSilent(samples: Float32Array): boolean {
  if (!samples.length) return true;
  let energy = 0;
  for (const value of samples) energy += value * value;
  return energy / samples.length < 1e-8;
}

export interface ModelTranscript { text: string; chunks?: { text: string; timestamp: [number | null, number | null] }[] }
export function offsetSegments(output: ModelTranscript, offset: number, duration: number, idPrefix = 'segment'): Segment[] {
  const chunks = output.chunks?.length ? output.chunks : [{ text: output.text, timestamp: [0, duration] as [number, number] }];
  let previousEnd = 0;
  return chunks.flatMap((chunk, index) => {
    const text = chunk.text.trim();
    if (!text) return [];
    const rawStart = chunk.timestamp[0], rawEnd = chunk.timestamp[1];
    const start = Math.max(previousEnd, Math.min(duration, typeof rawStart === 'number' && Number.isFinite(rawStart) ? rawStart : previousEnd));
    const end = Math.max(start, Math.min(duration, typeof rawEnd === 'number' && Number.isFinite(rawEnd) ? rawEnd : duration));
    previousEnd = end;
    return [{ id: `${idPrefix}-${index}`, start: offset + start, end: offset + end, text }];
  });
}


