const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|m4a|aac|ogg|opus|aiff?|wma)$/i;

export const DEMO_TRACKS = [
  { id: 'demo-01', title: 'Phố lên đèn · Intro Edit', artist: 'NonstopMaker Demo', duration: 218, bpm: 124, key: 'Am', energy: 2, genre: 'Việt Mix', color: '#29c8d1', selected: true, demo: true, analysisStatus: 'demo' },
  { id: 'demo-02', title: 'Chạm vào mây · House Mix', artist: 'NonstopMaker Demo', duration: 246, bpm: 126, key: 'Dm', energy: 3, genre: 'Việt', color: '#35a9ff', selected: true, demo: true, analysisStatus: 'demo' },
  { id: 'demo-03', title: 'Ngày vui · Club Edit', artist: 'NonstopMaker Demo', duration: 231, bpm: 128, key: 'F#m', energy: 4, genre: 'Việt Mix', color: '#43d28b', selected: true, demo: true, analysisStatus: 'demo' },
  { id: 'demo-04', title: 'Nhịp tim · Vina House', artist: 'NonstopMaker Demo', duration: 264, bpm: 130, key: 'Em', energy: 5, genre: 'Việt Mix', color: '#f2bb45', selected: true, demo: true, analysisStatus: 'demo' },
  { id: 'demo-05', title: 'Đêm không ngủ · Peak Edit', artist: 'NonstopMaker Demo', duration: 239, bpm: 132, key: 'Gm', energy: 5, genre: 'Anh (US-UK)', color: '#f0804c', selected: true, demo: true, analysisStatus: 'demo' },
  { id: 'demo-06', title: 'Bước qua mùa vui · Club Mix', artist: 'NonstopMaker Demo', duration: 258, bpm: 134, key: 'Bm', energy: 6, genre: 'Việt', color: '#ef5e91', selected: true, demo: true, analysisStatus: 'demo' },
  { id: 'demo-07', title: 'Ánh sáng cuối đường · Remix', artist: 'NonstopMaker Demo', duration: 252, bpm: 132, key: 'C#m', energy: 5, genre: 'Việt Mix', color: '#a884ff', selected: true, demo: true, analysisStatus: 'demo' },
  { id: 'demo-08', title: 'Mặt trời trở lại · Outro', artist: 'NonstopMaker Demo', duration: 276, bpm: 126, key: 'A', energy: 3, genre: 'Việt', color: '#5fc1a6', selected: true, demo: true, analysisStatus: 'demo' },
];

export const DURATION_OPTIONS = [
  { id: '30', label: '≈ 30 phút', helper: 'set ngắn', seconds: 30 * 60 },
  { id: '60', label: '≈ 1 giờ', helper: 'phổ biến nhất', seconds: 60 * 60 },
  { id: '120', label: '≈ 2 giờ', helper: 'đêm dài', seconds: 120 * 60 },
  { id: 'all', label: 'Tất cả bài', helper: 'không giới hạn', seconds: Infinity },
];

export const MOOD_OPTIONS = [
  { id: 'easy', icon: '☁', title: 'Êm ả', detail: 'Nhẹ nhàng, dễ nghe', color: '#61b8e9' },
  { id: 'chill', icon: '◉', title: 'Chill DJ', detail: 'Mượt, vừa đủ phiêu', color: '#9b86ff' },
  { id: 'sung', icon: '↗', title: 'Sung', detail: 'Nhịp lên đều', color: '#54d3a0' },
  { id: 'peak', icon: 'ϟ', title: 'Cực sung', detail: 'Năng lượng cao', color: '#ff718c' },
];

export const STYLE_OPTIONS = [
  'Trữ tình · êm',
  'Căng dần · lên mood',
  'Tươi · vui sáng',
  'Hoài niệm · quen tai',
  'Chill · nhẹ nhàng',
];

export const GENRE_OPTIONS = ['Tất cả', 'Việt', 'Việt Mix', 'Anh (US-UK)', 'China'];

export function formatTime(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const rest = wholeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function isAudioFile(file) {
  return Boolean(file && (String(file.type || '').startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name || '')));
}

export function makeImportedTracks(files) {
  const entries = Array.from(files || []).map((entry) => {
    if (entry && typeof entry === 'object' && 'file' in entry) {
      return { file: entry.file, relativePath: entry.relativePath || entry.file?.webkitRelativePath || entry.file?.name };
    }
    return { file: entry, relativePath: entry?.webkitRelativePath || entry?.name };
  }).filter(({ file }) => isAudioFile(file));
  return entries.map(({ file, relativePath }, index) => {
    const title = file.name.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
    const hue = (index * 43 + 186) % 360;
    return {
      id: `local-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      title: title || file.name,
      artist: relativePath.includes('/') ? relativePath.split('/')[0] : 'Tệp cục bộ',
      duration: 0,
      bpm: null,
      key: null,
      camelot: null,
      energy: null,
      genre: 'Tệp cục bộ',
      color: `hsl(${hue} 76% 58%)`,
      selected: true,
      analysisStatus: 'not-analyzed',
      analysisConfidence: null,
      file,
      relativePath,
      demo: false,
    };
  });
}

export function sumTrackDuration(tracks) {
  return (tracks || []).reduce((total, track) => total + (Number(track.duration) || 0), 0);
}

function camelotDistance(left, right) {
  const parse = (value) => {
    const match = String(value || '').match(/^(\d{1,2})([AB])$/i);
    return match ? { number: Number(match[1]), mode: match[2].toUpperCase() } : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  const raw = Math.abs(a.number - b.number);
  const distance = Math.min(raw, 12 - raw);
  if (a.mode === b.mode) return distance;
  return distance === 0 ? 0.8 : distance + 1.25;
}

export function arrangeTracksByCompatibility(tracks) {
  const selected = Array.from(tracks || []).filter((track) => track.selected);
  const unselected = Array.from(tracks || []).filter((track) => !track.selected);
  if (selected.length < 3) return [...selected, ...unselected].sort((a, b) => (a.energy || 0) - (b.energy || 0));

  const remaining = [...selected];
  remaining.sort((a, b) => (a.energy || 0) - (b.energy || 0));
  const ordered = [remaining.shift()];
  while (remaining.length) {
    const previous = ordered[ordered.length - 1];
    const desiredEnergy = Math.min(6, (previous.energy || 0) + 0.55);
    let bestIndex = 0;
    let bestScore = Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const bpmPenalty = Number.isFinite(previous.bpm) && Number.isFinite(candidate.bpm)
        ? Math.abs(previous.bpm - candidate.bpm) * 0.32
        : 4;
      const keyDistance = camelotDistance(previous.camelot, candidate.camelot);
      const keyPenalty = keyDistance === null ? 2 : keyDistance * 2.4;
      const energyPenalty = Math.abs((candidate.energy || 0) - desiredEnergy) * 1.2;
      const score = bpmPenalty + keyPenalty + energyPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }
  return [...ordered, ...unselected];
}

export function buildM3U(tracks, title = 'NonstopMaker Lite') {
  const lines = ['#EXTM3U', `#PLAYLIST:${String(title).replace(/[\r\n]/g, ' ')}`];
  for (const track of tracks || []) {
    const seconds = Number(track.duration) > 0 ? Math.round(track.duration) : -1;
    const label = `${track.title || 'Track'}${track.artist ? ` - ${track.artist}` : ''}`.replace(/[\r\n]/g, ' ');
    const location = track.relativePath || track.file?.name || track.title || '';
    lines.push(`#EXTINF:${seconds},${label}`, location);
  }
  return `${lines.join('\n')}\n`;
}

export function buildMixPlan(tracks, settings = {}) {
  return {
    app: 'NonstopMaker Lite',
    version: 1,
    createdAt: new Date().toISOString(),
    note: 'Mix plan chỉ chứa metadata; MP3 được trộn và mã hóa cục bộ, không nhúng audio vào JSON.',
    settings: {
      targetMinutes: settings.targetMinutes ?? 60,
      mood: settings.mood ?? 'chill',
      transition: settings.transition ?? 'Fade mềm',
      crossfadeSeconds: settings.crossfadeSeconds ?? 8,
      alignFadeToBpm: settings.alignFadeToBpm ?? true,
      normalizeAudio: settings.normalizeAudio ?? true,
      bitrateKbps: settings.bitrateKbps ?? 192,
      styles: settings.styles ?? [],
      genres: settings.genres ?? [],
    },
    tracks: (tracks || []).map((track, index) => ({
      order: index + 1,
      title: track.title,
      artist: track.artist,
      durationSeconds: Number(track.duration) || null,
      bpm: track.bpm ?? null,
      key: track.key || null,
      camelot: track.camelot || null,
      energy: track.energy ?? null,
      analysisConfidence: track.analysisConfidence ?? null,
      relativePath: track.relativePath || track.file?.name || null,
    })),
  };
}
