import { AlignmentType, Document, Footer, HeadingLevel, PageNumber, Packer, Paragraph, TextRun } from 'docx';
import type { Segment } from './types';

export interface TranscriptDocument {
  title: string;
  createdAt: string | number | Date;
  duration: number;
  segments: Segment[];
}
export interface ExportOptions { includeTimestamps?: boolean }

export function formatTimestamp(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 3600).toString().padStart(2, '0')}:${Math.floor(value / 60 % 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}
function dateText(value: TranscriptDocument['createdAt']): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知时间' : date.toLocaleString('zh-CN', { hour12: false });
}

export async function exportDocx(session: TranscriptDocument, options: ExportOptions = {}): Promise<Blob> {
  const timestamps = options.includeTimestamps !== false;
  const document = new Document({
    creator: '声记 ShengJi', title: session.title, description: '在本机离线识别生成的逐字稿',
    styles: {
      default: { document: { run: { font: { ascii: 'Calibri', eastAsia: 'Microsoft YaHei' }, size: 22 }, paragraph: { spacing: { after: 160, line: 320 } } } },
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: '声记 · ', color: '64748B', size: 18 }), new TextRun({ children: [PageNumber.CURRENT], color: '64748B', size: 18 })] })] }) },
      children: [
        new Paragraph({ text: session.title || '录音逐字稿', heading: HeadingLevel.TITLE }),
        new Paragraph({ children: [new TextRun({ text: `${dateText(session.createdAt)}  |  时长 ${formatTimestamp(session.duration)}`, color: '64748B', size: 20 })] }),
        new Paragraph({ children: [new TextRun({ text: '本稿由本地语音模型生成，请结合原始录音核对。', italics: true, color: '64748B', size: 18 })] }),
        ...session.segments.map((segment) => new Paragraph({ children: [
          ...(timestamps ? [new TextRun({ text: `[${formatTimestamp(segment.start)}–${formatTimestamp(segment.end)}]  `, color: '64748B', size: 18 })] : []),
          new TextRun({ text: segment.text }),
        ] })),
        ...(session.segments.length ? [] : [new Paragraph({ text: '未检测到可转写的语音。' })]),
      ],
    }],
  });
  return Packer.toBlob(document);
}

export function exportTxt(session: TranscriptDocument, options: ExportOptions = {}): Blob {
  const lines = [session.title || '录音逐字稿', `${dateText(session.createdAt)} | 时长 ${formatTimestamp(session.duration)}`, '本稿由本地语音模型生成，请结合原始录音核对。', '', ...session.segments.map(segment => `${options.includeTimestamps === false ? '' : `[${formatTimestamp(segment.start)}–${formatTimestamp(segment.end)}] `}${segment.text}`)];
  return new Blob(['\uFEFF', lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
}
