import { describe, expect, it } from 'vitest';
import { audioWindows, decodeAudio, decodeWav, isSilent, offsetSegments, resampleMono, SAMPLE_RATE } from '../src/audio';
import { exportDocx, exportTxt, formatTimestamp } from '../src/export';

function pcmWav(samples: number[], channels = 1, rate = 16000): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + samples.length * 2), data = new DataView(bytes);
  const text = (start: number, value: string) => [...value].forEach((c, i) => data.setUint8(start + i, c.charCodeAt(0)));
  text(0, 'RIFF'); data.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, channels, true);
  data.setUint32(24, rate, true); data.setUint32(28, rate * channels * 2, true); data.setUint16(32, channels * 2, true); data.setUint16(34, 16, true);
  text(36, 'data'); data.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) => data.setInt16(44 + i * 2, value, true));
  return bytes;
}

describe('local audio preparation', () => {
  it('decodes signed PCM WAV and mixes stereo channels without clipping', () => {
    const result = decodeWav(pcmWav([32767, -32768, 16384, 16384], 2))!;
    expect(result.sampleRate).toBe(16000);
    expect(result.samples[0]).toBeCloseTo(0, 4);
    expect(result.samples[1]).toBe(0.5);
  });
  it('rejects truncated WAV instead of reading beyond its buffer', () => {
    const data = pcmWav([1, 2, 3]);
    expect(() => decodeWav(data.slice(0, -1))).toThrow('不完整');
  });
  it('decodes WAV without an AudioContext and honors abort before reading', async () => {
    const blob = new Blob([pcmWav([0, 16384, -16384])]);
    expect([...await decodeAudio(blob)]).toEqual([0, 0.5, -0.5]);
    await expect(decodeAudio(blob, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('downsamples using all source samples and preserves duration', () => {
    const result = resampleMono(new Float32Array([1, -1, 1, -1, 1, -1]), 48000);
    expect(result.length).toBe(2);
    expect(result[0]).toBeCloseTo(1 / 3);
    expect(result[1]).toBeCloseTo(-1 / 3);
  });
  it('covers long recordings exactly, with no skipped or duplicated samples', () => {
    const samples = new Float32Array(SAMPLE_RATE * 63).fill(0.1);
    samples.fill(0, SAMPLE_RATE * 26, SAMPLE_RATE * 27);
    const windows = audioWindows(samples);
    expect(windows[0].start).toBe(0);
    expect(windows[0].end / SAMPLE_RATE).toBeGreaterThan(26);
    expect(windows[0].end / SAMPLE_RATE).toBeLessThan(27);
    expect(windows.at(-1)?.end).toBe(samples.length);
    windows.forEach((window, i) => { expect(window.end - window.start).toBeLessThanOrEqual(SAMPLE_RATE * 30); if (i) expect(window.start).toBe(windows[i - 1].end); });
  });
  it('skips digital silence but retains quiet speech', () => {
    expect(isSilent(new Float32Array(32000))).toBe(true);
    expect(isSilent(new Float32Array(32000).fill(0.001))).toBe(false);
  });
});

describe('transcript timing and document export', () => {
  it('offsets later windows and repairs missing or out-of-range timestamps', () => {
    const result = offsetSegments({ text: '', chunks: [
      { text: ' 第一段 ', timestamp: [0, 3] }, { text: '第二段', timestamp: [2, null] },
    ] }, 30, 8, 'later');
    expect(result).toEqual([
      { id: 'later-0', start: 30, end: 33, text: '第一段' },
      { id: 'later-1', start: 33, end: 38, text: '第二段' },
    ]);
    expect(offsetSegments({ text: 'single' }, 60, 5)[0]).toMatchObject({ start: 60, end: 65 });
  });
  it('formats hours without wrapping and exports human-readable Chinese text', async () => {
    expect(formatTimestamp(3661)).toBe('01:01:01');
    const session = { title: '会议记录', createdAt: '2026-09-25T02:00:00Z', duration: 5, segments: [{ id: '1', start: 1, end: 5, text: '这是逐字稿。' }] };
    const text = await exportTxt(session).text();
    expect(text).toContain('[00:00:01–00:00:05] 这是逐字稿。');
    expect(await exportTxt(session, { includeTimestamps: false }).text()).not.toContain('[00:00:01');
    const word = await exportDocx(session);
    expect(word.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const bytes = new Uint8Array(await word.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);
    // ZIP central-directory names prove this is an OOXML package, not renamed plain text.
    const packageText = new TextDecoder().decode(bytes);
    expect(packageText).toContain('word/document.xml');
    expect(packageText).toContain('[Content_Types].xml');
  });
});
