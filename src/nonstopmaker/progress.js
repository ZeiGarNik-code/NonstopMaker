import { DURATION_OPTIONS, sumTrackDuration } from './mixUtils.js';

/**
 * Single source of truth for the four visible workflow steps.
 * The header navigation and the per-step progress card both read from here.
 */
export const WORKFLOW = [
  { id: 'setup', number: '01', label: 'Chọn nhạc', action: 'Nạp nhạc để bắt đầu' },
  { id: 'arrange', number: '02', label: 'Xếp set', action: 'Chọn bài và phân tích BPM / tone' },
  { id: 'editor', number: '03', label: 'Nghe & chỉnh sửa', action: 'Nghe thử và chỉnh chuyển bài' },
  { id: 'export', number: '04', label: 'Xuất file', action: 'Render MP3 hoặc xuất playlist' },
];

export const STEP_IDS = WORKFLOW.map((step) => step.id);

export function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

export function completionPercent(checks) {
  const list = Array.isArray(checks) ? checks : [];
  if (!list.length) return 0;
  return clampPercent((list.filter((check) => check?.done).length / list.length) * 100);
}

function targetReached(selectedTracks, targetDuration) {
  if (!selectedTracks.length) return false;
  const option = DURATION_OPTIONS.find((item) => item.id === targetDuration);
  if (!option || !Number.isFinite(option.seconds)) return true;
  return sumTrackDuration(selectedTracks) >= option.seconds * 0.5;
}

function hasAnalysis(selectedTracks, analysisState) {
  if (analysisState?.status === 'done') return true;
  if (!selectedTracks.length) return false;
  return selectedTracks.every((track) => track.demo || track.analysisStatus === 'done');
}

/**
 * Checklists double as readiness signals: a step is "100%" once everything the
 * next step needs is in place, so the bar never claims progress that is not real.
 */
export function stepChecks(screen, context = {}) {
  const selectedTracks = Array.isArray(context.selectedTracks) ? context.selectedTracks : [];
  const tracks = Array.isArray(context.tracks) ? context.tracks : [];

  switch (screen) {
    case 'arrange':
      return [
        { id: 'in-set', label: 'Có bài trong set', done: selectedTracks.length > 0 },
        { id: 'target', label: 'Đạt nửa thời lượng mục tiêu', done: targetReached(selectedTracks, context.targetDuration) },
        { id: 'analysis', label: 'Có BPM / tone', done: hasAnalysis(selectedTracks, context.analysisState) },
        { id: 'order', label: 'Đã xếp thứ tự', done: Boolean(context.orderTouched) },
      ];
    case 'editor':
      return [
        { id: 'ready', label: 'Set đã sẵn sàng', done: selectedTracks.length > 0 },
        { id: 'transition', label: 'Kiểu chuyển bài', done: Boolean(context.transition) },
        { id: 'crossfade', label: 'Crossfade hợp lệ', done: context.transition === 'Cắt gọn' || Number(context.crossfade) > 0 },
        { id: 'preview', label: 'Đã nghe thử', done: Boolean(context.playbackTouched) },
      ];
    case 'export': {
      const hasRealAudio = selectedTracks.length > 0 && selectedTracks.every((track) => Boolean(track.file));
      return [
        { id: 'ready', label: 'Set đã sẵn sàng', done: selectedTracks.length > 0 },
        { id: 'source', label: 'Có audio gốc để render', done: hasRealAudio },
        { id: 'package', label: 'Đã xuất playlist / mix plan', done: Boolean(context.exportedArtifacts) },
        { id: 'render', label: 'Đã render MP3', done: context.renderState?.status === 'done' },
      ];
    }
    case 'setup':
    default:
      return [
        { id: 'files', label: 'Đã nạp nhạc', done: tracks.length > 0 },
        { id: 'duration', label: 'Độ dài mục tiêu', done: Boolean(context.targetDuration) },
        { id: 'mood', label: 'Mood đã chọn', done: Boolean(context.mood) },
        { id: 'name', label: 'Tên set', done: Boolean(String(context.setName ?? '').trim()) },
      ];
  }
}

export function computeStepProgress(screen, context = {}) {
  const index = Math.max(0, STEP_IDS.indexOf(screen));
  const meta = WORKFLOW[index];
  const checks = stepChecks(screen, context);
  const percent = completionPercent(checks);
  const pending = checks.filter((check) => !check.done);
  return {
    screen,
    index,
    number: meta.number,
    label: meta.label,
    percent,
    checks,
    complete: percent === 100,
    pendingCount: pending.length,
    nextAction: pending[0]?.label || null,
    summary: percent === 100 ? 'Bước này đã hoàn tất' : `Còn ${pending.length} mục · tiếp: ${pending[0]?.label || 'hoàn thiện bước'}`,
  };
}

/**
 * Overall progress treats every step as an equal quarter so the number keeps
 * moving while the user works inside the current step.
 */
export function computeOverallProgress(screen, context = {}) {
  const activeIndex = Math.max(0, STEP_IDS.indexOf(screen));
  let total = 0;
  STEP_IDS.forEach((id, index) => {
    if (index < activeIndex) total += 100;
    else if (index === activeIndex) total += computeStepProgress(id, context).percent;
  });
  return clampPercent(total / STEP_IDS.length);
}

/**
 * Live sub-progress (analysis / MP3 rendering) surfaced in the header and cards.
 */
export function describeActivity(analysisState, renderState) {
  if (analysisState?.status === 'running') {
    const total = analysisState.trackCount || 0;
    const current = total ? Math.min(analysisState.trackIndex || 1, total) : 0;
    return {
      id: 'analysis',
      label: 'Đang phân tích',
      percent: clampPercent(analysisState.progress),
      detail: [analysisState.phaseLabel || 'Đang xử lý', analysisState.currentTrackName, total ? `bài ${current}/${total}` : null]
        .filter(Boolean)
        .join(' · '),
    };
  }
  if (renderState?.status === 'running') {
    return {
      id: 'render',
      label: 'Đang render MP3',
      percent: clampPercent(renderState.progress),
      detail: [renderState.phaseLabel || 'Đang trộn', renderState.currentTrackName].filter(Boolean).join(' · '),
    };
  }
  return null;
}
