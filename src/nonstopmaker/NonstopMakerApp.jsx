import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BadgeCheck,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Disc3,
  Download,
  FileAudio,
  FileDown,
  FolderOpen,
  Headphones,
  Info,
  ListMusic,
  Menu,
  MoreHorizontal,
  MoveDown,
  MoveUp,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Repeat2,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import {
  arrangeTracksByCompatibility,
  buildM3U,
  buildMixPlan,
  DEMO_TRACKS,
  DURATION_OPTIONS,
  formatTime,
  GENRE_OPTIONS,
  makeImportedTracks,
  MOOD_OPTIONS,
  STYLE_OPTIONS,
  sumTrackDuration,
} from './mixUtils.js';
import './nonstopmaker.css';

const WORKFLOW = [
  { id: 'setup', number: '01', label: 'Chọn nhạc' },
  { id: 'arrange', number: '02', label: 'Xếp set' },
  { id: 'editor', number: '03', label: 'Nghe & chỉnh sửa' },
  { id: 'export', number: '04', label: 'Xuất file' },
];

const TRANSITIONS = ['Fade mềm', 'Cắt gọn'];

function downloadText(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function safeFileName(value) {
  return String(value || 'nonstop-set')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'nonstop-set';
}

async function readEntry(entry, parentPath = '') {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file(
        (file) => resolve([{ file, relativePath: `${parentPath}${file.name}` }]),
        () => resolve([]),
      );
    });
  }
  if (!entry.isDirectory) return [];

  const reader = entry.createReader();
  const children = [];
  await new Promise((resolve) => {
    const readBatch = () => reader.readEntries((batch) => {
      if (!batch.length) {
        resolve();
        return;
      }
      children.push(...batch);
      readBatch();
    }, resolve);
    readBatch();
  });

  const base = `${parentPath}${entry.name}/`;
  const nested = await Promise.all(children.map((child) => readEntry(child, base)));
  return nested.flat();
}

async function filesFromDrop(dataTransfer) {
  const entries = Array.from(dataTransfer.items || [])
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (entries.length) {
    const nested = await Promise.all(entries.map((entry) => readEntry(entry)));
    return nested.flat();
  }
  return Array.from(dataTransfer.files || []).map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
  }));
}

function Waveform({ seed = 'demo', color = '#37b9f1', compact = false, peaks = null }) {
  const viewHeight = compact ? 36 : 62;
  const barCount = compact ? 68 : 112;
  const bars = useMemo(() => {
    if (peaks?.length) {
      return Array.from({ length: barCount }, (_, index) => {
        const amplitude = peaks[Math.min(peaks.length - 1, Math.floor(index * peaks.length / barCount))] / 255;
        return Math.max(4, Math.round(4 + amplitude * (viewHeight - 8)));
      });
    }
    let hash = 0;
    for (const character of String(seed)) hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return Array.from({ length: barCount }, (_, index) => {
      const wave = Math.abs(Math.sin(index * 0.43 + hash * 0.001));
      const pulse = Math.abs(Math.cos(index * 0.16 + hash * 0.002));
      return 5 + Math.round((wave * 0.62 + pulse * 0.38) * (compact ? 20 : 30));
    });
  }, [barCount, compact, peaks, seed, viewHeight]);
  const gradientId = `wave-${String(seed).replace(/[^a-zA-Z0-9]/g, '') || 'sample'}`;
  const barWidth = compact ? 13 : 8.5;
  const barGap = compact ? 3 : 2.3;

  return (
    <svg
      className={`waveform-svg ${compact ? 'waveform-svg-compact' : ''}`}
      viewBox={`0 0 ${bars.length * (barWidth + barGap)} ${viewHeight}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={peaks?.length ? 'Dạng sóng trích xuất từ audio cục bộ' : 'Dạng sóng minh họa'}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity=".48" />
          <stop offset="45%" stopColor={color} stopOpacity=".98" />
          <stop offset="100%" stopColor="#d785ff" stopOpacity=".82" />
        </linearGradient>
      </defs>
      <line x1="0" y1={viewHeight / 2} x2="100%" y2={viewHeight / 2} className="waveform-baseline" />
      {bars.map((height, index) => (
        <rect
          key={index}
          x={index * (barWidth + barGap)}
          y={(viewHeight - height) / 2}
          width={barWidth}
          height={height}
          rx={compact ? 1 : 1.4}
          fill={`url(#${gradientId})`}
        />
      ))}
    </svg>
  );
}

function SectionHeading({ number, title, description, accessory }) {
  return (
    <div className="nsm-section-heading">
      <span className="nsm-step-number">{number}</span>
      <div className="nsm-section-copy">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {accessory && <div className="nsm-heading-accessory">{accessory}</div>}
    </div>
  );
}

function Header({ screen, onNavigate, hasTracks, simpleMode, setSimpleMode, onExport }) {
  return (
    <header className="nsm-topbar">
      <a className="nsm-brand" href="#home" onClick={(event) => { event.preventDefault(); onNavigate('setup'); }} aria-label="NonstopMaker Lite - trang đầu">
        <span className="nsm-brand-icon"><AudioLines size={21} strokeWidth={2.4} /></span>
        <span className="nsm-brand-copy">
          <strong>NonstopMaker</strong>
          <small>STUDIO LITE <i /> LOCAL SET BUILDER</small>
        </span>
      </a>

      <nav className="nsm-workflow" aria-label="Quy trình tạo nonstop">
        {WORKFLOW.map((item, index) => {
          const active = screen === item.id;
          const currentIndex = WORKFLOW.findIndex((stage) => stage.id === screen);
          const complete = index < currentIndex;
          const disabled = index > 0 && !hasTracks;
          return (
            <button
              className={`nsm-workflow-step ${active ? 'is-active' : ''} ${complete ? 'is-complete' : ''}`}
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => onNavigate(item.id)}
              aria-current={active ? 'step' : undefined}
            >
              <span className="nsm-workflow-number">{complete ? <Check size={12} /> : item.number}</span>
              <span>{item.label}</span>
              {index < WORKFLOW.length - 1 && <ChevronRight className="nsm-workflow-chevron" size={14} />}
            </button>
          );
        })}
      </nav>

      <div className="nsm-header-actions">
        <span className="nsm-local-pill"><ShieldCheck size={13} /> Nhạc nằm trên máy bạn</span>
        <button className={`nsm-simple-toggle ${simpleMode ? 'is-on' : ''}`} type="button" onClick={() => setSimpleMode(!simpleMode)} aria-pressed={simpleMode}>
          <span className="nsm-toggle-dot" />
          <span>Đơn giản</span>
        </button>
        {screen !== 'setup' && (
          <button className="nsm-header-export" type="button" onClick={onExport}>
            <FileDown size={15} /> Xuất set
          </button>
        )}
        <button className="nsm-mobile-menu" type="button" onClick={() => onNavigate('setup')} aria-label="Về chọn nhạc"><Menu size={19} /></button>
      </div>
    </header>
  );
}

function SetupScreen({
  tracks,
  selectedTracks,
  targetDuration,
  setTargetDuration,
  mood,
  setMood,
  selectedStyles,
  toggleStyle,
  selectedGenres,
  toggleGenre,
  setName,
  setSetName,
  onChooseFolder,
  onChooseFiles,
  onDropFiles,
  onLoadDemo,
  onContinue,
  isDragging,
  setIsDragging,
}) {
  const trackCount = tracks.length;
  const totalDuration = sumTrackDuration(selectedTracks);

  return (
    <main className="nsm-content nsm-setup-page">
      <div className="nsm-page-heading">
        <div>
          <span className="nsm-eyebrow"><Sparkles size={13} /> DJ SET BUILDER · BẢN NHẸ</span>
          <h1>Làm nonstop chỉ với <em>3 bước</em></h1>
          <p>Chọn nhạc, chọn mood, rồi xếp set theo cách của bạn — không cần tải thư viện nhạc lên máy chủ.</p>
        </div>
        <div className="nsm-demo-callout">
          <span className="nsm-demo-spark"><Zap size={16} fill="currentColor" /></span>
          <div><strong>Muốn xem nhanh?</strong><small>Mở timeline bằng bộ dữ liệu mẫu</small></div>
          <button type="button" onClick={onLoadDemo}>Mở demo <ArrowRight size={14} /></button>
        </div>
      </div>

      <div className="nsm-setup-grid">
        <div className="nsm-setup-main">
          <section className="nsm-panel nsm-import-panel">
            <SectionHeading
              number="01"
              title="Chọn thư mục nhạc"
              description="Chọn một thư mục hoặc vài tệp audio. Mọi thứ được đọc ngay trên thiết bị của bạn."
              accessory={trackCount > 0 ? <span className="nsm-count-pill"><CheckCircle2 size={13} /> {trackCount} bài đã nạp</span> : <span className="nsm-optional-pill">BẮT ĐẦU TẠI ĐÂY</span>}
            />
            <div
              className={`nsm-dropzone ${isDragging ? 'is-dragging' : ''} ${trackCount ? 'has-tracks' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false); }}
              onDrop={(event) => { event.preventDefault(); setIsDragging(false); onDropFiles(event.dataTransfer); }}
            >
              <div className="nsm-folder-orbit"><FolderOpen size={24} /></div>
              <div className="nsm-drop-copy">
                <strong>{trackCount ? `Đã chọn ${trackCount} bài nhạc` : 'Kéo thả thư mục nhạc vào đây'}</strong>
                <span>{trackCount ? `${selectedTracks.length} bài sẽ được đưa vào set · tệp vẫn ở trên máy` : 'Hoặc bấm chọn thư mục / thêm bài lẻ · MP3, WAV, FLAC, M4A, AAC'}</span>
              </div>
              <div className="nsm-drop-actions">
                <button className="nsm-button nsm-button-secondary" type="button" onClick={onChooseFolder}><FolderOpen size={15} /> Chọn thư mục</button>
                <button className="nsm-button nsm-button-quiet" type="button" onClick={onChooseFiles}><Plus size={15} /> Thêm bài lẻ</button>
              </div>
              {trackCount > 0 && <button className="nsm-text-button nsm-clear-files" type="button" onClick={onChooseFolder}><MoreHorizontal size={16} /> Chọn thư mục khác</button>}
            </div>
            <div className="nsm-import-footnote"><ShieldCheck size={13} /> Không tải audio lên cloud · không phân tích âm thanh nếu bạn chưa bấm phát</div>
          </section>

          <section className="nsm-panel">
            <SectionHeading number="02" title="Nonstop dài bao lâu?" description="Chọn độ dài mục tiêu, có thể thay đổi sau khi xếp bài." />
            <div className="nsm-choice-grid nsm-duration-grid">
              {DURATION_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  className={`nsm-choice-card nsm-duration-choice ${targetDuration === option.id ? 'is-selected' : ''}`}
                  type="button"
                  onClick={() => setTargetDuration(option.id)}
                  aria-pressed={targetDuration === option.id}
                >
                  <span className="nsm-choice-check">{targetDuration === option.id ? <Check size={12} /> : <Clock3 size={13} />}</span>
                  <strong>{option.label}</strong>
                  <small>{option.helper}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="nsm-panel">
            <SectionHeading number="03" title="Muốn nghe kiểu gì?" description="Chọn năng lượng cho set. Có thể phân tích BPM / tone cục bộ rồi sắp thứ tự tương thích." />
            <div className="nsm-choice-grid nsm-mood-grid">
              {MOOD_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  className={`nsm-choice-card nsm-mood-choice ${mood === option.id ? 'is-selected' : ''}`}
                  type="button"
                  onClick={() => setMood(option.id)}
                  aria-pressed={mood === option.id}
                  style={{ '--mood-color': option.color }}
                >
                  <span className="nsm-mood-icon">{option.icon}</span>
                  <span className="nsm-mood-copy"><strong>{option.title}</strong><small>{option.detail}</small></span>
                  <span className="nsm-choice-radio" />
                </button>
              ))}
            </div>
          </section>

          <section className="nsm-panel nsm-preferences-panel">
            <div className="nsm-preference-row">
              <div className="nsm-preference-label"><span>CHẤT NHẠC</span><small>Chọn một hoặc nhiều</small></div>
              <div className="nsm-chip-list">
                {STYLE_OPTIONS.map((style) => (
                  <button key={style} type="button" onClick={() => toggleStyle(style)} className={`nsm-chip ${selectedStyles.includes(style) ? 'is-active' : ''}`} aria-pressed={selectedStyles.includes(style)}>
                    {selectedStyles.includes(style) && <Check size={11} />}{style}
                  </button>
                ))}
              </div>
            </div>
            <div className="nsm-preference-row">
              <div className="nsm-preference-label"><span>LOẠI NHẠC</span><small>Lọc theo thư viện của bạn</small></div>
              <div className="nsm-chip-list">
                {GENRE_OPTIONS.map((genre) => (
                  <button key={genre} type="button" onClick={() => toggleGenre(genre)} className={`nsm-chip nsm-chip-genre ${selectedGenres.includes(genre) ? 'is-active' : ''}`} aria-pressed={selectedGenres.includes(genre)}>
                    {selectedGenres.includes(genre) && <Check size={11} />}{genre}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <aside className="nsm-setup-aside">
          <div className="nsm-summary-card">
            <div className="nsm-summary-card-head"><span><Activity size={15} /> SET CỦA BẠN</span><span className="nsm-summary-live"><i /> LIVE PREVIEW</span></div>
            <h2>Tạo một set<br />đúng gu của bạn.</h2>
            <p>Mọi tùy chọn được giữ cục bộ trong phiên làm việc này.</p>
            <div className="nsm-summary-metrics">
              <div><small>BÀI NHẠC</small><strong>{String(trackCount).padStart(2, '0')} <span>bài</span></strong></div>
              <div><small>THỜI LƯỢNG</small><strong>{targetDuration === 'all' ? 'Tất cả' : `${targetDuration} phút`}</strong></div>
              <div><small>MOOD</small><strong className="nsm-summary-mood">{MOOD_OPTIONS.find((item) => item.id === mood)?.title || 'Chill DJ'}</strong></div>
              <div><small>ĐÃ CHỌN</small><strong>{selectedTracks.length} <span>bài</span></strong></div>
            </div>
            <div className="nsm-summary-trackline"><span style={{ width: `${trackCount ? Math.min(100, (selectedTracks.length / Math.max(trackCount, 1)) * 100) : 8}%` }} /></div>
            <div className="nsm-summary-note"><Clock3 size={14} /> {totalDuration ? `${formatTime(totalDuration)} nhạc đã nạp` : 'Chọn thư mục nhạc để bắt đầu'}</div>
            <label className="nsm-input-label" htmlFor="set-name">TÊN SET</label>
            <div className="nsm-name-input-wrap"><Disc3 size={15} /><input id="set-name" value={setName} onChange={(event) => setSetName(event.target.value)} maxLength={54} /></div>
            <button className="nsm-button nsm-button-primary nsm-full-button" type="button" onClick={onContinue} disabled={!trackCount}>
              Xếp bài & đi tiếp <ArrowRight size={16} />
            </button>
            {!trackCount && <button className="nsm-demo-text-button" type="button" onClick={onLoadDemo}>hoặc dùng bộ demo có sẵn</button>}
            <div className="nsm-summary-secure"><ShieldCheck size={13} /> Không sao chép tệp nhạc khi xuất cấu hình</div>
          </div>

          <div className="nsm-tip-card">
            <div className="nsm-tip-icon"><Info size={17} /></div>
            <div><strong>Audio ở trên thiết bị của bạn</strong><p>Không kèm nhạc mẫu hoặc tải tệp lên. Waveform demo là minh họa; file bạn chọn có thể phân tích và render MP3 cục bộ.</p></div>
          </div>
          <div className="nsm-storage-card"><span className="nsm-storage-icon"><Activity size={16} /></span><div><strong>Chạy ngay trên trình duyệt</strong><small>Không cần tài khoản · không cần cài thêm</small></div><BadgeCheck size={15} className="nsm-storage-check" /></div>
        </aside>
      </div>
    </main>
  );
}

function ArrangeScreen({
  tracks,
  selectedTracks,
  activeTrackId,
  mood,
  search,
  setSearch,
  onToggleTrack,
  onSelectTrack,
  onMoveTrack,
  onAutoArrange,
  onChooseFiles,
  onContinue,
  targetDuration,
  analysisState,
  onAnalyze,
  onCancelAnalysis,
  onToast,
}) {
  const filtered = tracks.filter((track) => `${track.title} ${track.artist} ${track.genre}`.toLowerCase().includes(search.toLowerCase()));
  const totalDuration = sumTrackDuration(selectedTracks);
  const target = DURATION_OPTIONS.find((option) => option.id === targetDuration) || DURATION_OPTIONS[1];
  const targetSeconds = target.seconds;
  const percentage = Number.isFinite(targetSeconds) && targetSeconds > 0 ? Math.min(100, (totalDuration / targetSeconds) * 100) : 0;

  return (
    <main className="nsm-content nsm-workspace-page">
      <div className="nsm-page-heading nsm-workspace-heading">
        <div><span className="nsm-eyebrow"><ListMusic size={13} /> BƯỚC 02 · TRACK SEQUENCER</span><h1>Xếp set theo nhịp của bạn</h1><p>Bật/tắt bài, đổi thứ tự, phân tích BPM / tone và xếp các track tương thích.</p></div>
        <div className="nsm-heading-actions"><button className="nsm-button nsm-button-secondary" type="button" onClick={onChooseFiles}><Plus size={15} /> Thêm bài</button><button className="nsm-button nsm-button-secondary" type="button" onClick={analysisState?.status === 'running' ? onCancelAnalysis : onAnalyze} disabled={analysisState?.status !== 'running' && !selectedTracks.some((track) => track.file)}>{analysisState?.status === 'running' ? <><X size={14} /> Dừng {analysisState.progress}%</> : <><Activity size={14} /> Phân tích BPM / tone</>}</button><button className="nsm-button nsm-button-violet" type="button" onClick={onAutoArrange}><Wand2 size={15} /> Tự xếp theo nhạc</button></div>
      </div>

      <div className="nsm-arrange-grid">
        <section className="nsm-panel nsm-track-panel">
          <div className="nsm-track-panel-toolbar">
            <div><strong>Danh sách nhạc</strong><span>{selectedTracks.length} / {tracks.length} bài trong set</span></div>
            <div className="nsm-track-toolbar-actions">
              <label className="nsm-search-wrap"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm bài / nghệ sĩ" aria-label="Tìm bài nhạc" /><kbd>⌘ K</kbd></label>
              <button className="nsm-icon-button" type="button" onClick={() => onToast('Danh sách đang được lọc theo nội dung tên bài và nghệ sĩ.')} aria-label="Thông tin tìm kiếm"><CircleHelp size={16} /></button>
            </div>
          </div>
          {analysisState?.status === 'running' && <div className="nsm-analysis-progress" role="status"><div className="nsm-analysis-progress-copy"><span><Activity size={13} className="nsm-spinning" /> Đang phân tích {analysisState.currentTrackName || 'audio'} ({analysisState.trackIndex}/{analysisState.trackCount})</span><strong>{analysisState.phaseLabel || 'Đang đọc metadata…'} · {analysisState.progress}%</strong></div><div className="nsm-analysis-progress-track"><span style={{ width: `${analysisState.progress}%` }} /></div></div>}
          {analysisState?.status === 'done' && <div className="nsm-analysis-complete"><CheckCircle2 size={13} /> Đã phân tích {analysisState.completed} bài · BPM và tone là ước lượng từ tín hiệu audio.</div>}
          <div className="nsm-track-table-wrap">
            <table className="nsm-track-table">
              <thead><tr><th className="nsm-th-check"><span className="nsm-sr-only">Chọn bài</span></th><th># / TÊN BÀI</th><th>BPM</th><th>TONE</th><th>NĂNG LƯỢNG</th><th>ĐỘ DÀI</th><th><span className="nsm-sr-only">Thao tác</span></th></tr></thead>
              <tbody>
                {filtered.map((track) => {
                  const index = tracks.findIndex((item) => item.id === track.id);
                  return (
                    <tr key={track.id} className={`${track.selected ? 'is-in-set' : 'is-out-set'} ${track.id === activeTrackId ? 'is-current' : ''}`} onDoubleClick={() => onSelectTrack(track.id)}>
                      <td><button className={`nsm-track-check ${track.selected ? 'is-checked' : ''}`} type="button" onClick={() => onToggleTrack(track.id)} aria-label={`${track.selected ? 'Bỏ' : 'Thêm'} ${track.title} khỏi set`}>{track.selected && <Check size={12} />}</button></td>
                      <td>
                        <button className="nsm-track-title-button" type="button" onClick={() => onSelectTrack(track.id)}>
                          <span className="nsm-track-art" style={{ '--track-color': track.color }}><Music2 size={15} /></span>
                          <span className="nsm-track-title-copy"><strong>{track.title}</strong><small>{track.artist}{track.demo ? ' · metadata demo' : track.analysisStatus === 'done' ? (track.analysisConfidence != null ? ` · đã phân tích ${track.analysisConfidence}%` : ' · đã phân tích') : track.analysisStatus === 'error' ? ' · lỗi phân tích' : track.analysisStatus === 'analyzing' ? ' · đang phân tích' : track.analysisStatus === 'unavailable' ? ' · tín hiệu chưa đủ rõ' : ' · chờ phân tích'}</small></span>
                        </button>
                      </td>
                      <td><span className="nsm-number-cell">{track.bpm ? `${Math.round(track.bpm)} BPM` : '—'}</span></td>
                      <td><span className="nsm-key-cell"><span className="nsm-key-chip">{track.key || '—'}</span>{track.camelot && <small>{track.camelot}</small>}</span></td>
                      <td><EnergyDots value={track.energy ?? 0} /></td>
                      <td><span className="nsm-number-cell">{track.duration ? formatTime(track.duration) : '--:--'}</span></td>
                      <td><div className="nsm-row-actions"><button type="button" onClick={() => onMoveTrack(index, -1)} aria-label={`Đưa ${track.title} lên`} disabled={index === 0}><MoveUp size={14} /></button><button type="button" onClick={() => onMoveTrack(index, 1)} aria-label={`Đưa ${track.title} xuống`} disabled={index === tracks.length - 1}><MoveDown size={14} /></button></div></td>
                    </tr>
                  );
                })}
                {!filtered.length && <tr><td colSpan="7"><div className="nsm-empty-list"><Search size={18} /><span>Không tìm thấy bài phù hợp.</span></div></td></tr>}
              </tbody>
            </table>
          </div>
          <div className="nsm-track-panel-footer"><span><ShieldCheck size={13} /> Danh sách chỉ lưu trong bộ nhớ phiên này</span><button type="button" onClick={onChooseFiles}><Plus size={13} /> Thêm từ thư mục</button></div>
        </section>

        <aside className="nsm-arrange-aside">
          <div className="nsm-panel nsm-set-summary">
            <div className="nsm-summary-card-head"><span><BarChart3 size={15} /> SET OVERVIEW</span><span className="nsm-step-mini">02 / 04</span></div>
            <h2>{selectedTracks.length} <span>bài đã chọn</span></h2>
            <p className="nsm-summary-muted">{formatTime(totalDuration)} nhạc gốc · dự kiến {formatTime(Math.max(0, totalDuration - Math.max(0, selectedTracks.length - 1) * 8))} sau crossfade</p>
            <div className="nsm-target-meter"><div className="nsm-meter-label"><span>MỤC TIÊU</span><strong>{targetDuration === 'all' ? 'Không giới hạn' : `≈ ${targetDuration} phút`}</strong></div><div className="nsm-meter-track"><span style={{ width: `${percentage || (selectedTracks.length ? 6 : 0)}%` }} /></div><small>{totalDuration ? `${Math.round(percentage)}% thời lượng mục tiêu` : 'Chọn ít nhất một bài để tính thời lượng'}</small></div>
            <div className="nsm-summary-divider" />
            <div className="nsm-summary-list"><span><span className="nsm-summary-list-icon"><Sparkles size={14} /></span>Mood</span><strong>{MOOD_OPTIONS.find((item) => item.id === mood)?.title || 'Chill DJ'}</strong></div>
            <div className="nsm-summary-list"><span><span className="nsm-summary-list-icon"><Repeat2 size={14} /></span>Crossfade</span><strong>8 giây</strong></div>
            <div className="nsm-summary-list"><span><span className="nsm-summary-list-icon"><Disc3 size={14} /></span>Định dạng</span><strong>Playlist · M3U</strong></div>
            <button className="nsm-button nsm-button-primary nsm-full-button" type="button" disabled={!selectedTracks.length} onClick={onContinue}>Nghe & chỉnh sửa <ArrowRight size={16} /></button>
            <div className="nsm-small-note"><Info size={13} /> {activeTrack?.waveform ? 'Waveform lấy mẫu từ audio cục bộ; render MP3 thật ở bước Xuất.' : 'Waveform mẫu cho tới khi phân tích hoặc render tệp audio thật.'}</div>
          </div>
          <div className="nsm-side-help"><CircleHelp size={16} /><span><strong>Mẹo xếp set</strong><small>Phân tích BPM / tone trước khi tự xếp. Kết quả là ước lượng, demo dùng metadata mẫu.</small></span></div>
        </aside>
      </div>
    </main>
  );
}

function EnergyDots({ value = 0 }) {
  return <span className="nsm-energy" aria-label={value ? `Năng lượng ước lượng ${value} trên 6` : 'Năng lượng chưa phân tích'}>{Array.from({ length: 6 }, (_, index) => <i className={index < value ? 'is-on' : ''} key={index} />)}</span>;
}

function EditorScreen({
  setName,
  selectedTracks,
  tracks,
  activeTrack,
  onSelectTrack,
  isPlaying,
  playhead,
  onTogglePlayback,
  onSkip,
  onSeek,
  transition,
  setTransition,
  crossfade,
  setCrossfade,
  volume,
  setVolume,
  alignFadeToBpm,
  setAlignFadeToBpm,
  normalizeAudio,
  setNormalizeAudio,
  simpleMode,
  onArrange,
  onBack,
  onExport,
  audioRef,
  onAudioTime,
  onAudioEnded,
  onAudioDuration,
}) {
  const totalDuration = sumTrackDuration(selectedTracks);
  const activeDuration = activeTrack?.duration || 225;
  const progress = Math.max(0, Math.min(100, (playhead / activeDuration) * 100));
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [audioRef, volume]);
  const visibleTracks = selectedTracks.length ? selectedTracks : tracks;
  const totalTimelineSeconds = visibleTracks.reduce((sum, track) => sum + (track.duration || 225), 0);
  let cursor = 0;
  const blocks = visibleTracks.map((track) => {
    const duration = track.duration || 225;
    const left = totalTimelineSeconds ? (cursor / totalTimelineSeconds) * 100 : 0;
    const width = totalTimelineSeconds ? (duration / totalTimelineSeconds) * 100 : 0;
    cursor += duration;
    return { ...track, left, width };
  });
  const ticks = Array.from({ length: 9 }, (_, index) => index * (totalTimelineSeconds / 8));

  return (
    <main className="nsm-content nsm-editor-page">
      <div className="nsm-editor-page-top">
        <div className="nsm-editor-title-group"><button className="nsm-back-button" type="button" onClick={onBack}><ArrowLeft size={15} /> Xếp set</button><span className="nsm-title-divider" /><div><span className="nsm-eyebrow"><Radio size={12} /> BƯỚC 03 · NONSTOP EDITOR</span><h1>{setName || 'Nonstop mới'} <span className="nsm-unsaved-dot" /></h1><p>{selectedTracks.length} bài <i /> {totalDuration ? `${formatTime(totalDuration)} tổng thời lượng` : 'thời lượng sẽ hiện khi có metadata'}</p></div></div>
        <div className="nsm-editor-actions"><span className="nsm-auto-save"><CheckCircle2 size={13} /> Đã lưu trong phiên</span><button className="nsm-button nsm-button-secondary" type="button" onClick={onArrange}><Wand2 size={14} /> Tự làm từ A–Z</button><button className="nsm-button nsm-button-primary" type="button" onClick={onExport}><FileDown size={14} /> Xuất file</button></div>
      </div>

      <div className="nsm-editor-workspace">
        <section className="nsm-editor-main">
          <div className="nsm-editor-toolbar">
            <div className="nsm-editor-tabs"><button type="button" className="is-active"><AudioLines size={14} /> Timeline</button><button type="button" onClick={() => onSelectTrack(activeTrack?.id)}><ListMusic size={14} /> Track list <span>{selectedTracks.length}</span></button></div>
            <div className="nsm-editor-toolbar-right"><span className="nsm-editor-mode"><i /> LOCAL SESSION</span><button className="nsm-icon-button" type="button" aria-label="Tuỳ chọn timeline"><SlidersHorizontal size={15} /></button><button className="nsm-icon-button" type="button" aria-label="Thêm tuỳ chọn"><MoreHorizontal size={17} /></button></div>
          </div>

          <div className="nsm-timeline-overview">
            <div className="nsm-timeline-heading"><span><span className="nsm-live-dot" /> MIX OVERVIEW</span><span>{formatTime(totalTimelineSeconds)} <small>· {visibleTracks.length} đoạn</small></span></div>
            <div className="nsm-timeline-ruler"><span>00:00</span>{ticks.slice(1, -1).map((tick, index) => <span key={index}>{formatTime(tick)}</span>)}<span>{formatTime(totalTimelineSeconds)}</span></div>
            <div className="nsm-overview-lane">
              {blocks.map((track, index) => (
                <button
                  key={track.id}
                  type="button"
                  className={`nsm-overview-block ${track.id === activeTrack?.id ? 'is-current' : ''}`}
                  style={{ left: `${track.left}%`, width: `${Math.max(track.width, 3)}%`, '--track-color': track.color, zIndex: index + 1 }}
                  title={`${index + 1}. ${track.title}`}
                  onClick={() => onSelectTrack(track.id)}
                ><span className="nsm-overview-index">{String(index + 1).padStart(2, '0')}</span><span>{track.title}</span></button>
              ))}
              <div className="nsm-overview-playhead" style={{ left: `${progress}%` }}><span /></div>
            </div>
          </div>

          <div className="nsm-wave-card">
            <div className="nsm-wave-card-head"><div><span className="nsm-wave-kicker">STEREO WAVEFORM</span><strong>{activeTrack?.title || 'Chọn một bài để xem waveform'}</strong></div><div className="nsm-wave-head-actions"><span className="nsm-demo-wave-label"><span /> {activeTrack?.waveform ? 'WAVEFORM AUDIO' : activeTrack?.demo || !activeTrack?.file ? 'WAVEFORM MẪU' : 'CHƯA PHÂN TÍCH'}</span><button className="nsm-icon-button" type="button" aria-label="Thu nhỏ timeline"><ArrowDown size={15} /></button></div></div>
            <div className="nsm-wave-ruler"><span>0:00</span><span>¼</span><span>½</span><span>¾</span><span>{formatTime(activeDuration)}</span></div>
            <div className="nsm-stereo-track">
              <div className="nsm-channel-label">L</div>
              <div className="nsm-wave-lane"><Waveform seed={`${activeTrack?.id || 'left'}-left`} color={activeTrack?.color || '#29c8d1'} peaks={activeTrack?.waveform?.left} /><div className="nsm-wave-progress" style={{ width: `${progress}%` }} /><div className="nsm-wave-cursor" style={{ left: `${progress}%` }} /></div>
            </div>
            <div className="nsm-stereo-track">
              <div className="nsm-channel-label">R</div>
              <div className="nsm-wave-lane nsm-wave-lane-lower"><Waveform seed={`${activeTrack?.id || 'right'}-right`} color="#9f7dff" peaks={activeTrack?.waveform?.right} /><div className="nsm-wave-progress nsm-wave-progress-lower" style={{ width: `${progress}%` }} /><div className="nsm-wave-cursor" style={{ left: `${progress}%` }} /></div>
            </div>
            <div className="nsm-wave-legend"><span><i className="legend-cyan" /> Track A · preview</span><span><i className="legend-violet" /> Track B · transition overlay</span><span className="nsm-legend-note">{activeTrack?.waveform ? 'Biên độ trích từ audio' : 'Mẫu minh hoạ · phân tích để tạo waveform'}</span></div>
          </div>

          <div className="nsm-transport">
            <div className="nsm-transport-left"><button type="button" className="nsm-transport-icon" onClick={() => onSkip(-1)} aria-label="Bài trước"><SkipBack size={16} /></button><button type="button" className="nsm-transport-play" onClick={onTogglePlayback} aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}>{isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><button type="button" className="nsm-transport-icon" onClick={() => onSkip(1)} aria-label="Bài tiếp"><SkipForward size={16} /></button><span className="nsm-transport-time">{formatTime(playhead)} <i>/</i> {formatTime(activeDuration)}</span></div>
            <input className="nsm-seek-slider" type="range" min="0" max={activeDuration || 1} value={Math.min(playhead, activeDuration || 0)} onChange={(event) => onSeek(Number(event.target.value))} aria-label="Tua bài đang phát" />
            <div className="nsm-transport-right"><span className="nsm-preview-badge"><Headphones size={13} /> PREVIEW</span><Volume2 size={15} /><input type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Âm lượng" /></div>
          </div>

          <div className="nsm-queue-card">
            <div className="nsm-queue-heading"><div><span className="nsm-wave-kicker">PLAYLIST / ARRANGEMENT</span><strong>Thứ tự phát <span>{selectedTracks.length}</span></strong></div><button type="button" className="nsm-text-button" onClick={onArrange}><SlidersHorizontal size={14} /> Quản lý bài</button></div>
            <div className="nsm-queue-table-wrap"><table className="nsm-queue-table"><thead><tr><th>#</th><th>BÀI NHẠC</th><th>VÀO</th><th>RA</th><th>SANG BÀI KẾ</th><th>CHUYỂN</th><th>ÂM LƯỢNG</th><th></th></tr></thead><tbody>
              {selectedTracks.slice(0, 7).map((track, index) => (
                <tr key={track.id} className={track.id === activeTrack?.id ? 'is-active' : ''} onClick={() => onSelectTrack(track.id)}>
                  <td><span className="nsm-queue-number">{String(index + 1).padStart(2, '0')}</span></td>
                  <td><span className="nsm-queue-track"><i style={{ background: track.color }} /><span><strong>{track.title}</strong><small>{track.artist}</small></span></span></td>
                  <td>{index === 0 ? '00:00' : `0${index}:${String(index * 18).padStart(2, '0')}`}</td>
                  <td>{formatTime(track.duration || 225)}</td>
                  <td><span className="nsm-transition-state">{index === selectedTracks.length - 1 ? '—' : 'Tự động'}</span></td>
                  <td><span className="nsm-transition-chip"><Repeat2 size={11} /> {transition}</span></td>
                  <td><span className="nsm-volume-cell">{volume}%</span></td>
                  <td><button type="button" className="nsm-icon-button nsm-row-more" aria-label={`Thao tác ${track.title}`}><MoreHorizontal size={15} /></button></td>
                </tr>
              ))}
              {!selectedTracks.length && <tr><td colSpan="8"><div className="nsm-empty-list">Chưa có bài trong set.</div></td></tr>}
            </tbody></table></div>
            {selectedTracks.length > 7 && <div className="nsm-table-more">Còn {selectedTracks.length - 7} bài khác trong set <ChevronDown size={13} /></div>}
          </div>
        </section>

        <aside className="nsm-edit-sidebar">
          <div className="nsm-now-playing-card">
            <div className="nsm-now-playing-top"><span><Disc3 size={14} /> ĐANG CHỌN</span><button type="button" className="nsm-icon-button" aria-label="Thêm tuỳ chọn bài"><MoreHorizontal size={17} /></button></div>
            <div className="nsm-cover-art" style={{ '--track-color': activeTrack?.color || '#328df5' }}><span className="nsm-cover-glow" /><AudioLines size={34} /><small>NONSTOP<br />MAKER</small><span className="nsm-cover-index">{String(Math.max(1, selectedTracks.findIndex((track) => track.id === activeTrack?.id) + 1)).padStart(2, '0')}</span></div>
            <h2>{activeTrack?.title || 'Chưa chọn bài'}</h2><p>{activeTrack?.artist || 'Chọn bài trong danh sách để chỉnh sửa'}</p>
            <div className="nsm-current-tags"><span><Activity size={12} /> {activeTrack?.bpm || '—'} BPM</span><span><Disc3 size={12} /> Tone {activeTrack?.key || '—'}</span></div>
          </div>

          <div className="nsm-panel nsm-edit-controls">
            <div className="nsm-edit-controls-title"><span><Settings2 size={15} /> CHỈNH SET</span><span className="nsm-panel-dot" /></div>
            <div className="nsm-control-row"><div><strong>Chuyển bài</strong><small>Kiểu nối giữa 2 track</small></div><label className="nsm-select-wrap"><select value={transition} onChange={(event) => setTransition(event.target.value)}>{TRANSITIONS.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></label></div>
            {!simpleMode && <div className="nsm-control-row"><div><strong>Crossfade</strong><small>Chồng âm giữa các bài</small></div><div className="nsm-inline-range"><input type="range" min="2" max="20" value={crossfade} onChange={(event) => setCrossfade(Number(event.target.value))} /><span>{crossfade}s</span></div></div>}
            <div className="nsm-control-row"><div><strong>Âm lượng preview</strong><small>Chỉ ảnh hưởng bài đang nghe</small></div><div className="nsm-inline-range nsm-volume-range"><Volume2 size={14} /><input type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /><span>{volume}%</span></div></div>
            <div className="nsm-control-row"><div><strong>Canh fade theo BPM</strong><small>Làm tròn độ dài fade theo tempo đo được</small></div><button className={`nsm-switch ${alignFadeToBpm ? 'is-on' : ''}`} type="button" role="switch" aria-checked={alignFadeToBpm} aria-label="Canh độ dài fade theo BPM" onClick={() => setAlignFadeToBpm(!alignFadeToBpm)}><i /></button></div>
            <div className="nsm-control-row"><div><strong>Tự cân bằng âm</strong><small>Chuẩn hóa RMS từng track khi render</small></div><button className={`nsm-switch ${normalizeAudio ? 'is-on' : ''}`} type="button" role="switch" aria-checked={normalizeAudio} onClick={() => setNormalizeAudio(!normalizeAudio)}><i /></button></div>
          </div>

          <div className="nsm-device-card"><div className="nsm-device-icon"><Headphones size={17} /></div><div><strong>Đầu ra âm thanh</strong><small>{activeTrack?.file ? 'Trình duyệt · tệp cục bộ' : 'Chưa chọn tệp audio thật'}</small></div><button type="button" className="nsm-icon-button" aria-label="Cài đặt đầu ra"><ChevronDown size={15} /></button></div>
        </aside>
      </div>
      <audio ref={audioRef} preload="none" onTimeUpdate={onAudioTime} onEnded={onAudioEnded} onLoadedMetadata={onAudioDuration} />
    </main>
  );
}

function ExportScreen({
  setName,
  setSetName,
  selectedTracks,
  targetDuration,
  mood,
  transition,
  crossfade,
  bitrate,
  setBitrate,
  alignFadeToBpm,
  normalizeAudio,
  renderState,
  canRender,
  onRenderMp3,
  onCancelRender,
  onDownloadMp3,
  onBack,
  onExportM3U,
  onExportPlan,
  onToast,
}) {
  const totalDuration = sumTrackDuration(selectedTracks);
  const isRendering = renderState?.status === 'running';
  return (
    <main className="nsm-content nsm-export-page">
      <div className="nsm-page-heading nsm-workspace-heading"><div><span className="nsm-eyebrow"><Download size={13} /> BƯỚC 04 · EXPORT SET</span><h1>Render nonstop của bạn</h1><p>Ghép các tệp audio đã chọn thành MP3, hoặc tải playlist / cấu hình riêng.</p></div><button className="nsm-button nsm-button-secondary" type="button" onClick={onBack}><ArrowLeft size={14} /> Quay lại timeline</button></div>
      <div className="nsm-export-grid">
        <section className="nsm-panel nsm-export-summary">
          <div className="nsm-export-art"><span><AudioLines size={36} /></span><i className="export-spark export-spark-one" /><i className="export-spark export-spark-two" /><i className="export-grid-lines" /></div>
          <span className="nsm-eyebrow"><CheckCircle2 size={13} /> SET READY TO MIX</span>
          <h2>{setName || 'Nonstop mới'}</h2>
          <p>{selectedTracks.length} bài được xếp theo thứ tự hiện tại; MP3 sẽ được mã hóa ngay trên thiết bị.</p>
          <div className="nsm-export-stats"><div><small>TRACKS</small><strong>{selectedTracks.length}</strong></div><div><small>THỜI LƯỢNG GỐC</small><strong>{totalDuration ? formatTime(totalDuration) : 'Đang đo'}</strong></div><div><small>BITRATE</small><strong>{bitrate} kbps</strong></div></div>
          <label className="nsm-input-label" htmlFor="export-name">TÊN FILE ĐẦU RA</label><div className="nsm-name-input-wrap"><Save size={15} /><input id="export-name" value={setName} onChange={(event) => setSetName(event.target.value)} maxLength={54} /><span>.mp3</span></div>
          <div className="nsm-export-disclaimer"><Info size={15} /><span><strong>Render MP3 thật, xử lý cục bộ.</strong> Không gửi nhạc lên máy chủ. Crossfade là equal-power; đây chưa phải time-stretch / beatmatch kiểu DJ chuyên nghiệp.</span></div>
        </section>
        <aside className="nsm-export-options">
          <div className="nsm-panel nsm-export-option-panel"><span className="nsm-eyebrow">AUDIO MASTER</span><h3>Tạo file MP3</h3>
            <div className="nsm-render-settings-row"><label htmlFor="mp3-bitrate">BITRATE</label><select id="mp3-bitrate" value={bitrate} onChange={(event) => setBitrate(Number(event.target.value))} disabled={isRendering}><option value="128">128 kbps · nhẹ</option><option value="192">192 kbps · cân bằng</option><option value="256">256 kbps · chất lượng cao</option></select></div>
            {!isRendering && <button className="nsm-button nsm-button-primary nsm-render-button" type="button" onClick={onRenderMp3} disabled={!canRender}><AudioLines size={16} /> Render MP3 nonstop <ArrowRight size={15} /></button>}
            {isRendering && <div className="nsm-render-progress"><div className="nsm-render-progress-title"><span><Activity size={13} className="nsm-spinning" /> {renderState.phaseLabel || 'Đang render…'}</span><strong>{renderState.progress || 0}%</strong></div><small>{renderState.currentTrackName || 'Chuẩn bị audio'}{renderState.trackCount ? ` · bài ${renderState.trackIndex}/${renderState.trackCount}` : ''}</small><div className="nsm-analysis-progress-track"><span style={{ width: `${renderState.progress || 0}%` }} /></div><button className="nsm-render-cancel" type="button" onClick={onCancelRender}><X size={13} /> Hủy render</button></div>}
            {!canRender && !isRendering && <div className="nsm-render-hint"><Info size={14} /> Cần chọn tệp audio thật; dữ liệu demo không chứa nhạc để render.</div>}
            {renderState?.status === 'done' && <div className="nsm-render-success"><CheckCircle2 size={15} /><span><strong>{renderState.downloaded ? 'MP3 đã tải xuống' : 'MP3 render xong'}</strong><small>{formatTime(renderState.duration)} · {renderState.fileSizeLabel} · {renderState.sampleRate} Hz</small></span>{renderState.blob && <button className="nsm-download-mp3" type="button" onClick={onDownloadMp3}><Download size={13} /> Tải MP3</button>}</div>}
            {renderState?.status === 'error' && <div className="nsm-render-error"><Info size={14} />{renderState.message}</div>}
            <div className="nsm-render-options-caption"><span><Check size={11} /> {transition === 'Cắt gọn' ? 'Không crossfade' : `Crossfade ${crossfade}s`}</span>{transition !== 'Cắt gọn' && <span><Check size={11} /> {alignFadeToBpm ? 'Fade theo BPM đo được' : 'Fade cố định'}</span>}<span><Check size={11} /> {normalizeAudio ? 'Cân bằng RMS' : 'Không chuẩn hóa'}</span></div>
            <div className="nsm-render-hint"><Info size={14} /> Giới hạn render: 120 MB / track, 15 phút / track, tối đa 120 phút / set. Định dạng giải mã tùy trình duyệt.</div>
            <div className="nsm-export-divider" />
            <button className="nsm-export-option" type="button" onClick={onExportM3U}><span className="nsm-export-file-icon"><ListMusic size={18} /></span><span><strong>Playlist M3U8</strong><small>Mở trong phần mềm nghe nhạc / DJ</small></span><span className="nsm-export-size">~1 KB <Download size={15} /></span></button>
            <button className="nsm-export-option" type="button" onClick={onExportPlan}><span className="nsm-export-file-icon is-purple"><FileAudio size={18} /></span><span><strong>Mix plan JSON</strong><small>Thứ tự, BPM/tone, mood và transition</small></span><span className="nsm-export-size">~2 KB <Download size={15} /></span></button>
            <div className="nsm-export-privacy"><ShieldCheck size={15} /><span><strong>Audio không rời khỏi thiết bị</strong><small>MP3 được tạo trong trình duyệt bằng Web Audio + encoder cục bộ.</small></span></div>
          </div>
          <div className="nsm-panel nsm-export-settings"><div className="nsm-section-heading compact"><span className="nsm-step-number"><Settings2 size={14} /></span><div className="nsm-section-copy"><h2>Thông số set</h2><p>Được ghi vào mix plan JSON.</p></div></div><div className="nsm-summary-list"><span>Mood</span><strong>{MOOD_OPTIONS.find((item) => item.id === mood)?.title}</strong></div><div className="nsm-summary-list"><span>Chuyển bài</span><strong>{transition}</strong></div><div className="nsm-summary-list"><span>Crossfade</span><strong>{crossfade} giây</strong></div><button className="nsm-text-button nsm-reset-button" type="button" onClick={() => onToast('Bản MP3 được mã hóa cục bộ; playlist chỉ tham chiếu đường dẫn các tệp đã chọn.')}><CircleHelp size={14} /> Tìm hiểu dữ liệu được xuất</button></div>
        </aside>
      </div>
    </main>
  );
}

export default function NonstopMakerApp() {
  const [screen, setScreen] = useState('setup');
  const [tracks, setTracks] = useState([]);
  const [targetDuration, setTargetDuration] = useState('60');
  const [mood, setMood] = useState('chill');
  const [selectedStyles, setSelectedStyles] = useState(['Căng dần · lên mood', 'Chill · nhẹ nhàng']);
  const [selectedGenres, setSelectedGenres] = useState(['Tất cả']);
  const [setName, setSetName] = useState('Nonstop · Bản mix mới');
  const [search, setSearch] = useState('');
  const [simpleMode, setSimpleMode] = useState(true);
  const [transition, setTransition] = useState('Fade mềm');
  const [crossfade, setCrossfade] = useState(8);
  const [volume, setVolume] = useState(82);
  const [alignFadeToBpm, setAlignFadeToBpm] = useState(true);
  const [normalizeAudio, setNormalizeAudio] = useState(true);
  const [mp3Bitrate, setMp3Bitrate] = useState(192);
  const [analysisState, setAnalysisState] = useState({ status: 'idle', progress: 0 });
  const [renderState, setRenderState] = useState({ status: 'idle', progress: 0 });
  const [activeTrackId, setActiveTrackId] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [toast, setToast] = useState('');
  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef({ id: null, url: null });
  const analysisAbortRef = useRef(null);
  const renderAbortRef = useRef(null);

  const selectedTracks = useMemo(() => tracks.filter((track) => track.selected), [tracks]);
  const activeTrack = tracks.find((track) => track.id === activeTrackId) || selectedTracks[0] || tracks[0] || null;
  const trackCount = tracks.length;

  useEffect(() => {
    document.title = 'NonstopMaker Lite · DJ Set Builder';
    document.documentElement.lang = 'vi';
    const folderInput = folderInputRef.current;
    if (folderInput) {
      folderInput.setAttribute('webkitdirectory', '');
      folderInput.setAttribute('directory', '');
    }
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => () => {
    analysisAbortRef.current?.abort();
    renderAbortRef.current?.abort();
    if (audioRef.current) audioRef.current.pause();
    if (audioUrlRef.current.url) URL.revokeObjectURL(audioUrlRef.current.url);
  }, []);

  useEffect(() => {
    const track = tracks.find((item) => item.id === activeTrackId);
    const audio = audioRef.current;
    if (!track?.file || !audio) {
      if (audio && !audio.paused) audio.pause();
      if (audio && audioUrlRef.current.url) {
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(audioUrlRef.current.url);
        audioUrlRef.current = { id: null, url: null };
      }
      return;
    }
    if (audioUrlRef.current.id !== track.id) {
      if (audioUrlRef.current.url) URL.revokeObjectURL(audioUrlRef.current.url);
      audioUrlRef.current = { id: track.id, url: URL.createObjectURL(track.file) };
    }
    if (audio.src !== audioUrlRef.current.url) {
      audio.src = audioUrlRef.current.url;
      audio.load();
      setPlayhead(0);
      setIsPlaying(false);
    }
  }, [activeTrackId, tracks, screen]);

  useEffect(() => {
    if (!isPlaying || activeTrack?.file) return undefined;
    const duration = activeTrack?.duration || 225;
    const timer = window.setInterval(() => {
      setPlayhead((current) => {
        if (current + 1 >= duration) {
          setIsPlaying(false);
          return 0;
        }
        return current + 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, activeTrack?.id, activeTrack?.duration, activeTrack?.file]);

  function showToast(message) {
    setToast(message);
  }

  function navigate(nextScreen) {
    if (nextScreen !== 'setup' && !tracks.length) {
      showToast('Chọn thư mục nhạc hoặc mở dữ liệu demo trước nhé.');
      return;
    }
    if ((nextScreen === 'editor' || nextScreen === 'export') && !selectedTracks.length) {
      showToast('Hãy chọn ít nhất một bài để tiếp tục.');
      return;
    }
    setScreen(nextScreen);
  }

  function importFiles(entries, replace = false) {
    const imported = makeImportedTracks(entries);
    if (!imported.length) {
      showToast('Không tìm thấy tệp audio hỗ trợ. Thử MP3, WAV, FLAC, M4A hoặc AAC nhé.');
      return;
    }
    analysisAbortRef.current?.abort();
    renderAbortRef.current?.abort();
    setAnalysisState({ status: 'idle', progress: 0 });
    setRenderState({ status: 'idle', progress: 0 });
    setTracks((current) => [...(replace ? [] : current.filter((track) => !track.demo)), ...imported]);
    setActiveTrackId(imported[0].id);
    setPlayhead(0);
    setIsPlaying(false);
    showToast(`Đã thêm ${imported.length} bài cục bộ — không có tệp nào được tải lên.`);
  }

  function handleFolderFiles(event) {
    const entries = Array.from(event.target.files || []).map((file) => ({ file, relativePath: file.webkitRelativePath || file.name }));
    importFiles(entries, true);
    event.target.value = '';
  }

  function handleInputFiles(event) {
    const entries = Array.from(event.target.files || []).map((file) => ({ file, relativePath: file.webkitRelativePath || file.name }));
    importFiles(entries);
    event.target.value = '';
  }

  async function handleDrop(dataTransfer) {
    const entries = await filesFromDrop(dataTransfer);
    importFiles(entries);
  }

  function loadDemo() {
    analysisAbortRef.current?.abort();
    renderAbortRef.current?.abort();
    setAnalysisState({ status: 'idle', progress: 0 });
    setRenderState({ status: 'idle', progress: 0 });
    const demoTracks = DEMO_TRACKS.map((track) => ({ ...track }));
    setTracks(demoTracks);
    setActiveTrackId(demoTracks[0].id);
    setPlayhead(0);
    setIsPlaying(false);
    showToast('Đã nạp 8 bài demo nhẹ — không kèm file âm thanh.');
  }

  function toggleStyle(style) {
    setSelectedStyles((current) => current.includes(style) ? current.filter((item) => item !== style) : [...current, style]);
  }

  function toggleGenre(genre) {
    setSelectedGenres((current) => {
      if (genre === 'Tất cả') return ['Tất cả'];
      const withoutAll = current.filter((item) => item !== 'Tất cả');
      const next = withoutAll.includes(genre) ? withoutAll.filter((item) => item !== genre) : [...withoutAll, genre];
      return next.length ? next : ['Tất cả'];
    });
  }

  function startArrangement() {
    if (!trackCount) {
      showToast('Chọn một thư mục hoặc mở bộ demo trước nhé.');
      return;
    }
    if (!selectedTracks.length) {
      setTracks((current) => current.map((track) => ({ ...track, selected: true })));
    }
    setScreen('arrange');
  }

  function autoArrange() {
    if (!selectedTracks.length) {
      showToast('Chọn ít nhất một bài để tự xếp.');
      return;
    }
    const sorted = arrangeTracksByCompatibility(tracks);
    setTracks(sorted);
    const firstSelected = sorted.find((track) => track.selected);
    if (firstSelected) setActiveTrackId(firstSelected.id);
    const analyzedCount = selectedTracks.filter((track) => track.analysisStatus === 'done').length;
    showToast(analyzedCount ? `Đã xếp ${selectedTracks.length} bài theo BPM, tone và năng lượng.` : 'Đã xếp set theo metadata hiện có; phân tích BPM / tone để có gợi ý chính xác hơn.');
  }

  async function analyzeSelectedTracks() {
    const candidates = selectedTracks.filter((track) => track.file);
    if (!candidates.length) {
      showToast('Thêm tệp audio thật trước khi phân tích BPM / tone.');
      return;
    }
    if (analysisAbortRef.current) return;
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setAnalysisState({ status: 'running', progress: 0, completed: 0, trackCount: candidates.length, trackIndex: 0, phaseLabel: 'Đang khởi tạo worker…' });

    const phaseLabels = {
      decode: 'Đang giải mã audio…',
      prepare: 'Đang lấy mẫu tín hiệu…',
      bpm: 'Đang tìm BPM…',
      key: 'Đang nhận diện tone…',
    };

    try {
      const { analyzeAudioFile } = await import('./audioAnalysis.js');
      let completed = 0;
      let failed = 0;
      for (const [index, track] of candidates.entries()) {
        if (controller.signal.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
        setTracks((current) => current.map((item) => item.id === track.id ? { ...item, analysisStatus: 'analyzing' } : item));
        setAnalysisState((current) => ({ ...current, currentTrackName: track.title, trackIndex: index + 1, phaseLabel: 'Đang chuẩn bị…' }));
        try {
          const result = await analyzeAudioFile(track.file, {
            signal: controller.signal,
            onProgress: (progress) => {
              const overall = Math.min(99, Math.round(((index + (progress.progress || 0) / 100) / candidates.length) * 100));
              setAnalysisState((current) => ({
                ...current,
                status: 'running',
                progress: overall,
                completed,
                currentTrackName: track.title,
                trackIndex: index + 1,
                trackCount: candidates.length,
                phaseLabel: phaseLabels[progress.stage] || 'Đang phân tích…',
              }));
            },
          });
          const confidenceValues = [result.tempo?.confidence, result.musicalKey?.confidence].filter(Number.isFinite);
          const analysisConfidence = confidenceValues.length
            ? Math.round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length)
            : null;
          const hasResult = Boolean(result.tempo?.bpm || result.musicalKey?.key);
          setTracks((current) => current.map((item) => item.id === track.id ? {
            ...item,
            duration: result.duration || item.duration,
            waveform: result.waveform ?? item.waveform ?? null,
            bpm: result.tempo?.bpm ?? null,
            key: result.musicalKey?.key ?? null,
            camelot: result.musicalKey?.camelot ?? null,
            energy: result.energy ?? null,
            analysisConfidence,
            analysisStatus: hasResult ? 'done' : 'unavailable',
            analysisSampleRate: result.sampleRate,
          } : item));
          if (hasResult) completed += 1;
        } catch (error) {
          if (controller.signal.aborted || error?.name === 'AbortError') throw error;
          failed += 1;
          setTracks((current) => current.map((item) => item.id === track.id ? { ...item, analysisStatus: 'error', analysisError: error?.message || 'Analysis failed' } : item));
        }
      }
      setAnalysisState({ status: 'done', progress: 100, completed, failed, trackCount: candidates.length });
      showToast(failed ? `Phân tích xong ${completed}/${candidates.length} bài; ${failed} bài không giải mã được.` : `Đã phân tích BPM và tone cho ${completed} bài audio.`);
    } catch (error) {
      setTracks((current) => current.map((item) => item.analysisStatus === 'analyzing' ? { ...item, analysisStatus: 'pending' } : item));
      const cancelled = controller.signal.aborted || error?.name === 'AbortError';
      setAnalysisState({ status: cancelled ? 'idle' : 'error', progress: 0 });
      if (cancelled) showToast('Đã dừng phân tích audio.');
      else showToast(`Không thể phân tích tệp audio: ${error?.message || 'Lỗi không xác định'}`);
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
    }
  }

  function cancelAnalysis() {
    analysisAbortRef.current?.abort();
  }

  async function renderSelectedMix() {
    if (!selectedTracks.length || selectedTracks.some((track) => !track.file)) {
      showToast('Chỉ có thể render khi mọi bài được chọn là tệp audio thật.');
      return;
    }
    if (renderAbortRef.current) return;
    const controller = new AbortController();
    renderAbortRef.current = controller;
    setRenderState({ status: 'running', progress: 0, phaseLabel: 'Đang khởi tạo MP3 encoder…', trackCount: selectedTracks.length, trackIndex: 0 });
    const phaseLabels = {
      decode: 'Đang giải mã audio…',
      normalize: 'Đang cân bằng âm lượng…',
      encode: 'Đang mã hóa MP3…',
      'track-done': 'Đã trộn xong track…',
      flush: 'Đang hoàn tất file MP3…',
    };
    try {
      const { renderMixToMp3 } = await import('./audioMixer.js');
      const result = await renderMixToMp3(selectedTracks, {
        crossfadeSeconds: transition === 'Cắt gọn' ? 0 : crossfade,
        bitrate: mp3Bitrate,
        alignFadeToBpm,
        normalizeAudio,
        signal: controller.signal,
        onProgress: (progress) => {
          const track = selectedTracks[progress.trackIndex] || null;
          setRenderState((current) => ({
            ...current,
            status: 'running',
            progress: progress.progress || current.progress || 0,
            phaseLabel: phaseLabels[progress.phase] || 'Đang render…',
            currentTrackName: track?.title || current.currentTrackName || '',
            trackIndex: progress.trackIndex == null ? current.trackIndex : Math.min(progress.trackIndex + 1, progress.trackCount || selectedTracks.length),
            trackCount: progress.trackCount || selectedTracks.length,
          }));
        },
        onTrackDuration: (id, duration) => {
          setTracks((current) => current.map((track) => track.id === id ? { ...track, duration } : track));
        },
        onTrackWaveform: (id, waveform) => {
          setTracks((current) => current.map((track) => track.id === id ? { ...track, waveform } : track));
        },
      });
      const fileSizeLabel = result.blob.size >= 1024 * 1024
        ? `${(result.blob.size / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(result.blob.size / 1024))} KB`;
      setRenderState({ status: 'done', progress: 100, duration: result.duration, fileSizeLabel, sampleRate: result.sampleRate, bitrate: result.bitrate, blob: result.blob, downloaded: false });
      showToast(`MP3 đã render · ${formatTime(result.duration)} · bấm Tải MP3 để lưu file.`);
    } catch (error) {
      const cancelled = controller.signal.aborted || error?.name === 'AbortError';
      if (cancelled) {
        setRenderState({ status: 'idle', progress: 0 });
        showToast('Đã hủy render; chưa có MP3 được lưu.');
      } else {
        setRenderState({ status: 'error', progress: 0, message: error?.message || 'Lỗi không xác định khi render.' });
        showToast(`Render MP3 thất bại: ${error?.message || 'Lỗi không xác định'}`);
      }
    } finally {
      if (renderAbortRef.current === controller) renderAbortRef.current = null;
    }
  }

  function cancelRender() {
    renderAbortRef.current?.abort();
  }

  function downloadRenderedMp3() {
    if (!renderState?.blob) return;
    downloadBlob(`${safeFileName(setName)}.mp3`, renderState.blob);
    setRenderState((current) => ({ ...current, blob: null, downloaded: true }));
    showToast('MP3 đã tải xuống.');
  }

  function toggleTrack(id) {
    setTracks((current) => current.map((track) => track.id === id ? { ...track, selected: !track.selected } : track));
  }

  function selectTrack(id) {
    if (!id) return;
    setActiveTrackId(id);
    setPlayhead(0);
    setIsPlaying(false);
    if (audioRef.current && !audioRef.current.paused) audioRef.current.pause();
  }

  function moveTrack(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= tracks.length) return;
    setTracks((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function skipTrack(direction) {
    const list = selectedTracks.length ? selectedTracks : tracks;
    if (!list.length) return;
    const index = Math.max(0, list.findIndex((track) => track.id === activeTrack?.id));
    const nextIndex = (index + direction + list.length) % list.length;
    selectTrack(list[nextIndex].id);
  }

  function togglePlayback() {
    if (!activeTrack) {
      showToast('Chọn bài demo hoặc thêm file audio để nghe preview.');
      return;
    }
    if (activeTrack.file && audioRef.current) {
      const audio = audioRef.current;
      if (audio.paused) {
        audio.play().then(() => setIsPlaying(true)).catch(() => showToast('Trình duyệt chưa phát được tệp này. Thử định dạng MP3 hoặc WAV nhé.'));
      } else {
        audio.pause();
        setIsPlaying(false);
      }
      return;
    }
    setIsPlaying((current) => !current);
  }

  function seek(seconds) {
    setPlayhead(seconds);
    if (audioRef.current && activeTrack?.file) audioRef.current.currentTime = seconds;
  }

  function onAudioTime(event) {
    setPlayhead(event.currentTarget.currentTime || 0);
    setIsPlaying(!event.currentTarget.paused);
  }

  function onAudioEnded() {
    setIsPlaying(false);
    skipTrack(1);
  }

  function onAudioDuration(event) {
    const duration = event.currentTarget.duration;
    if (!Number.isFinite(duration) || !activeTrack?.id) return;
    setTracks((current) => current.map((track) => track.id === activeTrack.id ? { ...track, duration } : track));
  }

  function exportM3U() {
    if (!selectedTracks.length) {
      showToast('Chưa có bài nào để xuất.');
      return;
    }
    downloadText(`${safeFileName(setName)}.m3u8`, buildM3U(selectedTracks, setName), 'audio/x-mpegurl;charset=utf-8');
    showToast('Playlist M3U8 đã tải xuống.');
  }

  function exportPlan() {
    if (!selectedTracks.length) {
      showToast('Chưa có bài nào để xuất.');
      return;
    }
    const durationOption = DURATION_OPTIONS.find((option) => option.id === targetDuration);
    const plan = buildMixPlan(selectedTracks, {
      targetMinutes: durationOption?.id === 'all' ? 'all' : Number(targetDuration),
      mood,
      transition,
      crossfadeSeconds: crossfade,
      alignFadeToBpm,
      normalizeAudio,
      bitrateKbps: mp3Bitrate,
      styles: selectedStyles,
      genres: selectedGenres,
    });
    downloadText(`${safeFileName(setName)}-mix-plan.json`, JSON.stringify(plan, null, 2), 'application/json;charset=utf-8');
    showToast('Mix plan JSON đã tải xuống.');
  }

  const onTopExport = () => {
    if (!selectedTracks.length) {
      showToast('Chọn bài trước khi xuất set nhé.');
      return;
    }
    setScreen('export');
  };

  return (
    <div className="nsm-app">
      <input ref={folderInputRef} className="nsm-hidden-input" type="file" multiple accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff,.aif,.wma" onChange={handleFolderFiles} aria-label="Chọn thư mục nhạc" />
      <input ref={fileInputRef} className="nsm-hidden-input" type="file" multiple accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff,.aif,.wma" onChange={handleInputFiles} aria-label="Chọn tệp nhạc" />
      <Header screen={screen} onNavigate={navigate} hasTracks={trackCount > 0} simpleMode={simpleMode} setSimpleMode={setSimpleMode} onExport={onTopExport} />

      {screen === 'setup' && (
        <SetupScreen
          tracks={tracks}
          selectedTracks={selectedTracks}
          targetDuration={targetDuration}
          setTargetDuration={setTargetDuration}
          mood={mood}
          setMood={setMood}
          selectedStyles={selectedStyles}
          toggleStyle={toggleStyle}
          selectedGenres={selectedGenres}
          toggleGenre={toggleGenre}
          setName={setName}
          setSetName={setSetName}
          onChooseFolder={() => folderInputRef.current?.click()}
          onChooseFiles={() => fileInputRef.current?.click()}
          onDropFiles={handleDrop}
          onLoadDemo={loadDemo}
          onContinue={startArrangement}
          isDragging={isDragging}
          setIsDragging={setIsDragging}
        />
      )}

      {screen === 'arrange' && (
        <ArrangeScreen
          tracks={tracks}
          selectedTracks={selectedTracks}
          activeTrackId={activeTrackId}
          mood={mood}
          search={search}
          setSearch={setSearch}
          onToggleTrack={toggleTrack}
          onSelectTrack={selectTrack}
          onMoveTrack={moveTrack}
          onAutoArrange={autoArrange}
          onChooseFiles={() => fileInputRef.current?.click()}
          onContinue={() => { if (!selectedTracks.length) showToast('Hãy chọn ít nhất một bài để tiếp tục.'); else setScreen('editor'); }}
          targetDuration={targetDuration}
          analysisState={analysisState}
          onAnalyze={analyzeSelectedTracks}
          onCancelAnalysis={cancelAnalysis}
          onToast={showToast}
        />
      )}

      {screen === 'editor' && (
        <EditorScreen
          setName={setName}
          selectedTracks={selectedTracks}
          tracks={tracks}
          activeTrack={activeTrack}
          onSelectTrack={selectTrack}
          isPlaying={isPlaying}
          playhead={playhead}
          onTogglePlayback={togglePlayback}
          onSkip={skipTrack}
          onSeek={seek}
          transition={transition}
          setTransition={setTransition}
          crossfade={crossfade}
          setCrossfade={setCrossfade}
          volume={volume}
          setVolume={setVolume}
          alignFadeToBpm={alignFadeToBpm}
          setAlignFadeToBpm={setAlignFadeToBpm}
          normalizeAudio={normalizeAudio}
          setNormalizeAudio={setNormalizeAudio}
          simpleMode={simpleMode}
          onArrange={autoArrange}
          onBack={() => setScreen('arrange')}
          onExport={onTopExport}
          audioRef={audioRef}
          onAudioTime={onAudioTime}
          onAudioEnded={onAudioEnded}
          onAudioDuration={onAudioDuration}
        />
      )}

      {screen === 'export' && (
        <ExportScreen
          setName={setName}
          setSetName={setSetName}
          selectedTracks={selectedTracks}
          targetDuration={targetDuration}
          mood={mood}
          transition={transition}
          crossfade={crossfade}
          bitrate={mp3Bitrate}
          setBitrate={setMp3Bitrate}
          alignFadeToBpm={alignFadeToBpm}
          normalizeAudio={normalizeAudio}
          renderState={renderState}
          canRender={selectedTracks.length > 0 && selectedTracks.every((track) => Boolean(track.file))}
          onRenderMp3={renderSelectedMix}
          onCancelRender={cancelRender}
          onDownloadMp3={downloadRenderedMp3}
          onBack={() => setScreen('editor')}
          onExportM3U={exportM3U}
          onExportPlan={exportPlan}
          onToast={showToast}
        />
      )}

      {toast && <div className="nsm-toast" role="status"><CheckCircle2 size={16} /><span>{toast}</span><button type="button" onClick={() => setToast('')} aria-label="Đóng thông báo"><X size={14} /></button></div>}
      <footer className="nsm-footer"><span><span className="nsm-footer-mark"><AudioLines size={13} /></span> NonstopMaker <b>Lite</b></span><span>Phân tích / render cục bộ · audio không rời khỏi thiết bị</span><button type="button" onClick={() => showToast('BPM / tone là ước lượng; MP3 được trộn và mã hóa ngay trong trình duyệt.')}>Giới thiệu <Info size={12} /></button></footer>
    </div>
  );
}
