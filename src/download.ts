import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
export function safeFilename(name: string) { return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 100) || '声记'; }
export async function downloadBlob(blob: Blob, name: string) {
  const filename = safeFilename(name);
  if (Capacitor.isNativePlatform()) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('无法读取导出文件'));
      reader.readAsDataURL(blob);
    });
    const { uri } = await Filesystem.writeFile({ path: `exports/${filename}`, data, directory: Directory.Cache, recursive: true });
    await Share.share({ title: filename, files: [uri], dialogTitle: '保存或分享文件' });
  } else {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
export function mediaExtension(mimeType: string) { return mimeType.includes('mp4') ? (mimeType.startsWith('video') ? 'mp4' : 'm4a') : mimeType.includes('wav') ? 'wav' : mimeType.includes('mpeg') ? 'mp3' : 'webm'; }
