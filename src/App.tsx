import { useEffect, useRef, useState } from 'react';
import { AudioLines, Mic, Monitor, Square, Plus, Upload, FileText, Download, Trash2, X, ShieldCheck, FolderOpen, LoaderCircle, ChevronRight, Languages, Check, Settings2, CircleHelp, HardDrive, Search } from 'lucide-react';
import { startCapture, type ActiveCapture, type CaptureResult } from './capture';
import { listRecordings, saveRecording, deleteRecording } from './storage';
import { NativeRecorder, isNativeAndroid, readNativeRecording, type NativeRecording } from './native';
import { transcribe } from './transcription';
import { exportDocx, exportTxt } from './export';
import { downloadBlob, mediaExtension } from './download';
import type { CaptureMode, Recording } from './types';

const time = (seconds: number) => { const s = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const date = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const errorText = (error: unknown) => error instanceof Error ? (error.name === 'NotAllowedError' ? '录制授权已取消，或设备权限未开启。请允许屏幕共享和麦克风权限后重试。' : error.message) : String(error);
const android = isNativeAndroid();

export default function App() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const recordingsRef = useRef(recordings); recordingsRef.current = recordings;
  const [selectedId, setSelectedId] = useState<string>();
  const [mode, setMode] = useState<CaptureMode>('audio');
  const [microphone, setMicrophone] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'stopping'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [title, setTitle] = useState('');
  const titleRef = useRef(title); titleRef.current = title;
  const [language, setLanguage] = useState('zh');
  const [autoTranscribe, setAutoTranscribe] = useState(true);
  const [progress, setProgress] = useState({ id: '', value: 0, message: '' });
  const [notice, setNotice] = useState('');
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<{ id: string; name: string; thumbnail: string }[] | null>(null);
  const [deleteId, setDeleteId] = useState<string>();
  const [modelReady, setModelReady] = useState<boolean | null>(null);
  const [exporting, setExporting] = useState(false);
  const [mediaUrl, setMediaUrl] = useState('');
  const [draft, setDraft] = useState('');
  const capture = useRef<ActiveCapture | null>(null);
  const abort = useRef<AbortController | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const nativeResultRef = useRef<(result: NativeRecording) => Promise<void>>(async () => {});
  const nativeSeen = useRef(new Set<string>());
  const activeMode = useRef<CaptureMode>('audio');
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = recordings.find(r => r.id === selectedId);
  const busy = !!progress.id;
  const recording = phase !== 'idle';
  const filtered = recordings.filter(r => r.title.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    listRecordings().then(setRecordings).catch(() => setNotice('无法读取本地资料库。请检查设备存储权限或剩余空间。'));
    fetch(new URL('offline-manifest.json', document.baseURI)).then(r => setModelReady(r.ok && r.headers.get('content-type')?.includes('json') === true)).catch(() => setModelReady(false));
  }, []);
  useEffect(() => {
    if (!selected?.media) { setMediaUrl(''); return; }
    const url = URL.createObjectURL(selected.media); setMediaUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selected?.id, selected?.media]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const begun = Date.now();
    const timer = setInterval(() => { const value = (Date.now() - begun) / 1000; setElapsed(value); if (value >= 1800) { setNotice('已达到单次 30 分钟上限，正在保存录制。'); stopRef.current(); } }, 250);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (recording || busy) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [recording, busy]);
  useEffect(() => {
    if (!android) return;
    const stopped = NativeRecorder.addListener('recordingStopped', result => { void nativeResultRef.current(result); });
    const failed = NativeRecorder.addListener('recordingError', e => { setNotice(e.message); setPhase('idle'); });
    return () => { void stopped.then(h => h.remove()); void failed.then(h => h.remove()); };
  }, []);

  async function persist(next: Recording) {
    setRecordings(list => list.some(r => r.id === next.id) ? list.map(r => r.id === next.id ? next : r) : [next, ...list]);
    try { await saveRecording(next); } catch { setNotice('设备空间不足或本地保存失败。当前内容仍在界面中，请立即导出录制文件和逐字稿。'); }
  }
  async function runTranscription(item: Recording) {
    if (abort.current) return;
    const controller = new AbortController(); abort.current = controller;
    setProgress({ id: item.id, value: 0, message: '准备离线识别…' });
    try {
      const segments = await transcribe(item.audio, { language, signal: controller.signal, onProgress: (value, message) => setProgress({ id: item.id, value, message }) });
      const current = recordingsRef.current.find(r => r.id === item.id) || item;
      await persist({ ...current, segments, status: 'done', error: undefined });
      if (!segments.length) setNotice('未识别到语音。原始录制已保留，可以试听后再次转写。');
      else setNotice('离线逐字稿已生成，建议听回原音校对人名、数字和专业术语。');
    } catch (error) {
      if (controller.signal.aborted) setNotice('转写已取消，原始录制已保留。');
      else { const message = errorText(error); await persist({ ...(recordingsRef.current.find(r => r.id === item.id) || item), status: 'error', error: message }); setNotice(message); }
    } finally { abort.current = null; setProgress({ id: '', value: 0, message: '' }); }
  }
  async function finish(result: CaptureResult, recordedMode: Recording['mode']) {
    setPhase('idle'); capture.current = null;
    const item: Recording = { ...result, id: crypto.randomUUID(), createdAt: new Date().toISOString(), title: titleRef.current.trim() || `${recordedMode === 'screen' ? '屏幕录制' : recordedMode === 'import' ? '导入音频' : '语音记录'} ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, mode: recordedMode, segments: [], status: 'pending' };
    await persist(item); setSelectedId(item.id); setTitle('');
    if (autoTranscribe) await runTranscription(item);
    else setNotice('录制已保存在本机，点击「生成逐字稿」即可离线识别。');
  }
  async function consumeNative(result: NativeRecording) {
    if (nativeSeen.current.has(result.path)) return;
    nativeSeen.current.add(result.path); setPhase('stopping');
    try {
      const [media, audio] = await Promise.all([readNativeRecording(result.path), readNativeRecording(result.audioPath)]);
      if (result.warning) setNotice(result.warning);
      await finish({ media: new Blob([media], { type: result.mimeType }), audio, mimeType: result.mimeType, duration: result.duration }, activeMode.current);
    } catch (error) { setPhase('idle'); setNotice(errorText(error)); }
  }
  nativeResultRef.current = consumeNative;
  async function stop() {
    if (phase !== 'recording') return;
    setPhase('stopping');
    try {
      if (android) await consumeNative(await NativeRecorder.stop());
      else if (capture.current) await finish(await capture.current.stop(), activeMode.current);
    } catch (error) { setNotice(errorText(error)); setPhase('idle'); capture.current = null; }
  }
  stopRef.current = () => { void stop(); };
  async function begin(sourceId?: string) {
    if (recording || busy) return;
    setNotice(''); setPhase('starting'); setSelectedId(undefined); setElapsed(0); activeMode.current = mode;
    try {
      if (android) await NativeRecorder.start({ mode, microphone: true });
      else {
        if (sourceId) await window.desktopBridge!.selectSource(sourceId);
        capture.current = await startCapture(mode, microphone, () => stopRef.current(), setNotice);
      }
      setPhase('recording');
    } catch (error) { setPhase('idle'); setNotice(errorText(error)); }
  }
  async function requestStart() {
    if (mode === 'screen' && window.desktopBridge && !android) {
      try { setSources(await window.desktopBridge.listSources()); } catch (error) { setNotice(errorText(error)); }
    } else await begin();
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 150 * 1024 * 1024) { setNotice('导入文件不能超过 150 MB。请先将较长音频拆分成不超过 30 分钟的片段。'); return; }
    if (!file.size) { setNotice('所选文件为空。'); return; }
    titleRef.current = file.name.replace(/\.[^.]+$/, '');
    setPhase('stopping');
    let duration = 0;
    try {
      const url = URL.createObjectURL(file);
      try { duration = await new Promise<number>(resolve => { const media = document.createElement('audio'); const timeout = setTimeout(() => resolve(0), 3000); media.onloadedmetadata = () => { clearTimeout(timeout); resolve(Number.isFinite(media.duration) ? media.duration : 0); }; media.onerror = () => { clearTimeout(timeout); resolve(0); }; media.src = url; }); } finally { URL.revokeObjectURL(url); }
      if (duration > 1800) throw new Error('导入音频不能超过 30 分钟，请先拆分后再导入。');
      await finish({ media: file, audio: file, mimeType: file.type || 'audio/wav', duration }, 'import');
    } catch (error) { setPhase('idle'); setNotice(errorText(error)); }
  }
  function updateSelected(patch: Partial<Recording>) { if (selected) setRecordings(list => list.map(r => r.id === selected.id ? { ...r, ...patch } : r)); }
  async function saveSelected() { const item = recordingsRef.current.find(r => r.id === selectedId); if (item) await persist(item); }
  async function doExport(kind: 'docx' | 'txt' | 'media') {
    if (!selected) return;
    setExporting(true);
    try {
      const blob = kind === 'docx' ? await exportDocx(selected) : kind === 'txt' ? exportTxt(selected) : selected.media;
      await downloadBlob(blob, `${selected.title}.${kind === 'media' ? mediaExtension(selected.mimeType) : kind}`);
    } catch (error) { setNotice(errorText(error)); } finally { setExporting(false); }
  }
  async function remove() {
    if (!deleteId) return;
    try { await deleteRecording(deleteId); setRecordings(list => list.filter(r => r.id !== deleteId)); if (selectedId === deleteId) setSelectedId(undefined); setDeleteId(undefined); }
    catch { setNotice('删除失败，请重试。'); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><AudioLines size={27}/></div><div><strong>声记</strong><span>SHENGJI</span></div><span className="version">0.1</span></div>
      <button className={`nav-item ${!selectedId ? 'active' : ''}`} onClick={() => { setSelectedId(undefined); setQuery(''); }}><Plus size={19}/>新建录制<kbd>＋</kbd></button>
      <div className="library-heading"><span>本机资料库</span><span>{recordings.length}</span></div>
      <label className="search"><Search size={16}/><input aria-label="搜索录制" placeholder="搜索记录" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <div className="recording-list">
        {!filtered.length ? <div className="library-empty"><FolderOpen size={30}/><span>{query ? '没有匹配的记录' : '第一份记录，从这里开始'}</span><small>录制内容会保存在这台设备</small></div> : filtered.map(item => <button key={item.id} className={`recording-item ${selectedId === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}><span className="recording-type">{item.mode === 'screen' ? <Monitor size={18}/> : <Mic size={18}/>}</span><span className="recording-meta"><strong>{item.title}</strong><small>{date(item.createdAt)} · {time(item.duration)}</small></span>{progress.id === item.id ? <LoaderCircle size={14} className="spin"/> : item.status === 'done' ? <Check size={14} className="muted"/> : <span className="pending-dot"/>}</button>)}
      </div>
      <div className="sidebar-bottom"><button onClick={() => setHelp(true)}><CircleHelp size={18}/>使用指南</button><div className="privacy-note"><ShieldCheck size={19}/><div><strong>只在你的设备上</strong><span>离线识别 · 无需账号</span></div></div></div>
    </aside>

    <main>
      <header className="topbar"><div><span className="breadcrumb">工作台</span><ChevronRight size={15}/><strong>{selected ? '录制详情' : '新建录制'}</strong></div><span className="local-badge"><HardDrive size={14}/>{android ? 'Android 本机' : window.desktopBridge ? 'Windows 本机' : '本机模式'}</span></header>
      <div className="workspace">
        <section className="page-heading"><div><div className="eyebrow">{selected ? 'YOUR RECORDING' : 'CAPTURE YOUR MOMENT'}</div><h1>{selected ? '每一句，都有迹可循。' : '让声音，成为文字。'}</h1><p>{selected ? '听回录制，校对文字，再保存为文档。' : '录音或录屏，在设备上生成逐字稿。'}</p></div><button className="button subtle" onClick={() => setSettings(true)}><Settings2 size={17}/>转写设置</button></section>
        {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={17}/></button></div>}

        {!selected && <section className="capture-card">
          <div className="capture-top"><div className="mode-switch"><button className={mode === 'audio' ? 'chosen' : ''} disabled={recording || busy} onClick={() => setMode('audio')}><Mic size={18}/>录音</button><button className={mode === 'screen' ? 'chosen' : ''} disabled={recording || busy} onClick={() => setMode('screen')}><Monitor size={18}/>录屏 + 声音</button></div><span className="small-muted">最长 30 分钟 / 次</span></div>
          <input className="title-input" aria-label="录制标题" placeholder="为这次录制起个名字（可选）" value={title} disabled={recording} onChange={e => setTitle(e.target.value)}/>
          <div className={`recorder-stage ${phase === 'recording' ? 'is-recording' : ''}`}>
            <div className="waveform" aria-hidden="true">{Array.from({ length: 53 }, (_, i) => <span key={i} style={{ height: `${8 + Math.abs(Math.sin(i * 1.53) * Math.cos(i * .33)) * 49}px`, animationDelay: `${i * .039}s` }}/>)}</div>
            <div className="timer">{time(elapsed)}</div>
            <div className="stage-label">{phase === 'recording' ? '正在录制 · 结束后自动保存' : phase === 'starting' ? '等待系统授权…' : phase === 'stopping' ? '正在保存录制…' : mode === 'screen' ? '选择屏幕，留下画面和声音' : '准备好，就按下录制'}</div>
            <button className={`record-button ${recording ? 'stop-button' : ''}`} disabled={busy || phase === 'starting' || phase === 'stopping'} onClick={() => phase === 'recording' ? void stop() : void requestStart()}>{phase === 'starting' || phase === 'stopping' ? <LoaderCircle className="spin" size={20}/> : phase === 'recording' ? <Square size={17} fill="currentColor"/> : <span className="record-dot"/>}{phase === 'recording' ? '结束录制' : phase === 'stopping' ? '保存中' : '开始录制'}</button>
          </div>
          <div className="capture-bottom"><span><Mic size={15}/>{mode === 'screen' && !android ? <label><input type="checkbox" checked={microphone} disabled={recording || busy} onChange={e => setMicrophone(e.target.checked)}/>同时录制麦克风</label> : '麦克风已选用'}</span><span><Languages size={15}/>{language === 'zh' ? '中文识别' : language === 'en' ? '英语识别' : '自动检测语言'}</span><span><ShieldCheck size={15}/>本地离线转写</span></div>
          {mode === 'screen' && <p className="capture-tip">{android ? 'Android 录屏包含麦克风声音，不包含其他 App 内部音频。系统会请求录屏权限。' : '选择要录制的屏幕或窗口。系统声音的捕获取决于系统与共享来源。'}</p>}
        </section>}

        {selected && <section className="detail-card"><div className="detail-header"><div className="detail-icon">{selected.mode === 'screen' ? <Monitor size={22}/> : <Mic size={22}/>}</div><div className="detail-info"><input aria-label="修改录制标题" value={selected.title} onChange={e => updateSelected({ title: e.target.value })} onBlur={() => void saveSelected()}/><span>{date(selected.createdAt)} · {time(selected.duration)} · {(selected.media.size / 1024 / 1024).toFixed(1)} MB</span></div><button className="icon-button" aria-label="删除此录制" disabled={busy || recording} onClick={() => setDeleteId(selected.id)}><Trash2 size={18}/></button></div>{selected.mimeType.startsWith('video') ? <video controls src={mediaUrl} className="video-player"/> : <audio controls src={mediaUrl} className="audio-player"/>}<button className="button subtle compact" disabled={exporting} onClick={() => void doExport('media')}><Download size={15}/>导出原始录制</button></section>}

        {!selected && <button className="import-panel" disabled={recording || busy} onClick={() => fileInput.current?.click()}><div className="import-icon"><Upload size={21}/></div><div><strong>已有录音？直接导入</strong><span>支持 WAV、MP3、M4A、WebM 等设备可解码格式，最大 150 MB</span></div><ChevronRight size={20}/></button>}
        <input ref={fileInput} className="hidden" type="file" accept="audio/*,video/mp4,video/webm" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }}/>

        <section className="transcript-card"><div className="section-title"><div><FileText size={20}/><h2>逐字稿</h2>{selected?.segments.length ? <span className="count-badge">{selected.segments.length} 段</span> : null}</div><div className="export-actions">{selected && !busy && <button className="button subtle compact" disabled={recording} onClick={() => void runTranscription(selected)}><AudioLines size={15}/>{selected.segments.length ? '重新转写' : '生成逐字稿'}</button>}<button className="button export" disabled={!selected?.segments.length || exporting} onClick={() => void doExport('docx')}><Download size={16}/>{exporting ? '正在导出' : '导出 Word'}</button></div></div>
          {busy && <div className="progress-panel" aria-live="polite"><div><LoaderCircle size={19} className="spin"/><strong>{progress.message}</strong><span>{Math.round(progress.value)}%</span></div><progress value={progress.value} max="100"/><p>音频正在本机处理。请保持应用打开，较慢的设备可能需要几分钟。<button onClick={() => abort.current?.abort()}>取消转写</button></p></div>}
          {selected?.segments.length ? <><div className="transcript-toolbar"><span>点击文字即可校对，离开输入框时保存</span><button disabled={exporting} onClick={() => void doExport('txt')}>导出纯文本</button></div><div className="transcript-segments">{selected.segments.map((segment, index) => <div className="segment" key={segment.id}><span className="timestamp">{time(segment.start)}</span><textarea aria-label={`第 ${index + 1} 段逐字稿`} value={segment.text} rows={Math.max(2, Math.ceil(segment.text.length / 50))} onChange={e => updateSelected({ segments: selected.segments.map(s => s.id === segment.id ? { ...s, text: e.target.value } : s) })} onBlur={() => void saveSelected()}/></div>)}</div><div className="transcript-footer"><ShieldCheck size={14}/>离线机器识别结果，请以原始录音为准。</div></> : <div className="transcript-empty"><div className="empty-document"><FileText size={28}/></div><strong>{selected?.status === 'error' ? '转写未完成，录制已保留' : selected?.status === 'done' ? '没有识别到语音' : '你的文字，将在这里出现'}</strong><p>{selected?.error || (selected ? '点击「生成逐字稿」，也可以手动添加文字。' : '录制结束后，声记会自动生成带时间标记的逐字稿。')}</p>{selected && <div className="manual-text"><textarea aria-label="手动输入逐字稿" placeholder="也可以手动输入或粘贴校对后的文字…" value={draft} onChange={e => setDraft(e.target.value)}/><button className="button subtle compact" disabled={!draft.trim()} onClick={() => { void persist({ ...selected, status: 'done', segments: [{ id: crypto.randomUUID(), start: 0, end: selected.duration, text: draft.trim() }] }); setDraft(''); }}>保存文字</button></div>}</div>}
        </section>
        <footer className="workspace-footer"><span><ShieldCheck size={14}/>声音与文字只存于本机</span><span>声记 · 开源离线记录工具</span></footer>
      </div>
    </main>

    {sources !== null && <div className="modal-backdrop"><section className="modal source-modal" role="dialog" aria-modal="true" aria-label="选择录制来源"><div className="modal-heading"><h2>选择要录制的画面</h2><button aria-label="取消选择" onClick={() => setSources(null)}><X size={21}/></button></div><p>选择屏幕或窗口后开始录制。请确认画面中没有不想记录的内容。</p><div className="source-grid">{sources.map(source => <button key={source.id} onClick={() => { setSources(null); void begin(source.id); }}><img src={source.thumbnail} alt=""/><span>{source.name}</span></button>)}</div>{!sources.length && <p>未找到可录制来源，请检查系统屏幕录制权限。</p>}</section></div>}
    {settings && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="转写设置"><div className="modal-heading"><h2>转写设置</h2><button aria-label="关闭设置" onClick={() => setSettings(false)}><X size={21}/></button></div><label className="field-label">识别语言<select value={language} onChange={e => setLanguage(e.target.value)} disabled={busy}><option value="zh">中文</option><option value="en">英语</option><option value="auto">自动检测</option></select></label><label className="toggle-row"><div><strong>结束录制后自动转写</strong><span>导入音频后也会自动开始识别</span></div><input type="checkbox" checked={autoTranscribe} onChange={e => setAutoTranscribe(e.target.checked)}/></label><div className="model-note"><HardDrive size={20}/><div><strong>Whisper Tiny · 多语言离线模型</strong><p>{modelReady === true ? '模型已随应用提供，无需下载或联网。' : modelReady === false ? '当前构建缺少模型，请使用完整安装包；开发者需运行 npm run model:prepare。' : '正在检查本机模型…'}<br/>识别速度与准确率取决于设备、口音和录音质量。</p></div></div><button className="button primary full" onClick={() => setSettings(false)}>完成</button></section></div>}
    {help && <div className="modal-backdrop"><section className="modal help-modal" role="dialog" aria-modal="true" aria-label="使用指南"><div className="modal-heading"><h2>从录制到 Word，只需三步</h2><button aria-label="关闭指南" onClick={() => setHelp(false)}><X size={21}/></button></div><ol><li><strong>选择录音或录屏</strong><p>点击「开始录制」，按系统提示授权。单次最长 30 分钟。</p></li><li><strong>结束录制，离线转写</strong><p>模型会在本机识别音频，无需网络与账号。手机转写时请保持应用在前台。</p></li><li><strong>校对，然后导出</strong><p>修改逐字稿后点「导出 Word」。Android 会打开系统分享面板，可保存到文件或交给 Word。</p></li></ol><div className="model-note"><p>Windows 支持录屏、麦克风及可用的系统声音。Android 录屏录制麦克风，不捕捉其他 App 内部声音。当前未提供 iPhone 安装包。资料保存在当前设备，卸载应用或清理存储会删除资料，请及时导出。</p></div></section></div>}
    {deleteId && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="删除录制"><div className="modal-heading"><h2>删除这份录制？</h2><button aria-label="取消删除" onClick={() => setDeleteId(undefined)}><X size={21}/></button></div><p>将从本机资料库移除录制文件和逐字稿。已导出的文件不受影响。</p><div className="modal-actions"><button className="button subtle" onClick={() => setDeleteId(undefined)}>保留</button><button className="button danger" onClick={() => void remove()}>删除录制</button></div></section></div>}
  </div>;
}
