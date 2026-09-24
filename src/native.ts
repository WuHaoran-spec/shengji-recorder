import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeRecording {
  /** App-private original MP4 or M4A file. */
  path: string;
  /** App-private 16 kHz mono PCM WAV, generated locally by Android. */
  audioPath: string;
  /** Original AAC audio, extracted from MP4 without recompression. */
  compressedAudioPath?: string;
  duration: number;
  mimeType: 'video/mp4' | 'audio/mp4';
  /** Present only when the original recording survived but WAV conversion failed. */
  warning?: string;
}

export interface NativeRecorderPlugin {
  start(options: { mode: 'screen' | 'audio'; microphone: true }): Promise<void>;
  stop(): Promise<NativeRecording>;
  status(): Promise<{ recording: boolean; processing: boolean; duration: number }>;
  addListener(event: 'recordingStopped', listener: (recording: NativeRecording) => void): Promise<PluginListenerHandle>;
  addListener(event: 'recordingError', listener: (error: { message: string }) => void): Promise<PluginListenerHandle>;
}

export const NativeRecorder = registerPlugin<NativeRecorderPlugin>('NativeRecorder');
export const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export const nativeFileUrl = (path: string) => Capacitor.convertFileSrc(path);

export async function readNativeRecording(path: string): Promise<Blob> {
  const response = await fetch(nativeFileUrl(path));
  if (!response.ok) throw new Error(`无法读取本机录音（${response.status}）`);
  return response.blob();
}
