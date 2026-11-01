import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPercent,
  completionPercent,
  computeOverallProgress,
  computeStepProgress,
  describeActivity,
  STEP_IDS,
  stepChecks,
  WORKFLOW,
} from './progress.js';
import { DEMO_TRACKS } from './mixUtils.js';

const demoSelection = DEMO_TRACKS.map((track) => ({ ...track }));
const readyContext = {
  tracks: demoSelection,
  selectedTracks: demoSelection,
  targetDuration: '30',
  mood: 'chill',
  setName: 'Nonstop thử',
  transition: 'Fade mềm',
  crossfade: 8,
  analysisState: { status: 'idle' },
  renderState: { status: 'idle' },
  orderTouched: true,
  playbackTouched: true,
  exportedArtifacts: true,
};

test('workflow exposes the four steps used by the header and the progress card', () => {
  assert.equal(WORKFLOW.length, 4);
  assert.deepEqual(STEP_IDS, ['setup', 'arrange', 'editor', 'export']);
});

test('clampPercent keeps values inside 0-100 and rounds them', () => {
  assert.equal(clampPercent(-4), 0);
  assert.equal(clampPercent(12.4), 12);
  assert.equal(clampPercent(140), 100);
  assert.equal(clampPercent('50'), 50);
  assert.equal(clampPercent(Number.NaN), 0);
  assert.equal(clampPercent(undefined), 0);
});

test('completionPercent averages done checks and tolerates empty input', () => {
  assert.equal(completionPercent([]), 0);
  assert.equal(completionPercent(undefined), 0);
  assert.equal(completionPercent([{ done: true }, { done: false }]), 50);
  assert.equal(completionPercent([{ done: true }, { done: true }]), 100);
});

test('setup progress reports partial completion while the user fills the form', () => {
  assert.equal(computeStepProgress('setup', {}).percent, 0, 'empty form has nothing done');
  const nameOnly = computeStepProgress('setup', { setName: 'Nonstop của tôi' });
  assert.equal(nameOnly.percent, 25, 'only the name is filled in');
  assert.equal(nameOnly.complete, false);

  const filled = computeStepProgress('setup', { tracks: demoSelection, ...readyContext });
  assert.equal(filled.percent, 100);
  assert.equal(filled.complete, true);
  assert.equal(filled.summary, 'Bước này đã hoàn tất');
});

test('arrange progress reflects analysis and ordering work', () => {
  const realTracks = demoSelection.map((track) => ({ ...track, demo: false, file: { name: `${track.id}.mp3` } }));
  const pending = computeStepProgress('arrange', { ...readyContext, selectedTracks: realTracks });
  assert.equal(pending.percent, 75, 'real audio still needs BPM / tone analysis');
  assert.equal(pending.pendingCount, 1);
  assert.equal(pending.nextAction, 'Có BPM / tone');

  const analyzed = computeStepProgress('arrange', {
    ...readyContext,
    selectedTracks: realTracks,
    analysisState: { status: 'done' },
  });
  assert.equal(analyzed.percent, 100);
});

test('arrange progress drops when no track is selected', () => {
  const result = computeStepProgress('arrange', { ...readyContext, selectedTracks: [], orderTouched: false });
  assert.equal(result.percent, 0);
  assert.ok(result.nextAction);
});

test('export progress requires real audio before it can complete', () => {
  const demoOnly = computeStepProgress('export', { ...readyContext, renderState: { status: 'idle' } });
  assert.equal(demoOnly.percent, 50, 'demo metadata cannot be rendered or embedded');
  assert.equal(demoOnly.complete, false);
  assert.equal(demoOnly.checks.find((check) => check.id === 'source').done, false);

  const realTrack = { ...demoSelection[0], demo: false, file: { name: 'a.mp3' } };
  const realOnly = computeStepProgress('export', {
    ...readyContext,
    selectedTracks: [realTrack],
    renderState: { status: 'done' },
  });
  assert.equal(realOnly.percent, 100);
});

test('editor progress tracks transition, crossfade and preview', () => {
  const untouched = computeStepProgress('editor', { ...readyContext, playbackTouched: false });
  assert.equal(untouched.percent, 75);

  const cut = computeStepProgress('editor', { ...readyContext, transition: 'Cắt gọn', crossfade: 0 });
  assert.equal(cut.percent, 100);
});

test('overall progress counts finished steps fully and the active step partially', () => {
  assert.equal(computeOverallProgress('setup', {}), 0);
  assert.equal(computeOverallProgress('setup', readyContext), 25, 'finished setup fills one quarter');
  assert.equal(computeOverallProgress('arrange', readyContext), 50, 'finished setup + finished arrange');
  const realTracks = demoSelection.map((track) => ({ ...track, demo: false, file: { name: `${track.id}.mp3` } }));
  assert.equal(
    computeOverallProgress('export', {
      ...readyContext,
      selectedTracks: realTracks,
      tracks: realTracks,
      renderState: { status: 'done' },
    }),
    100,
    'all four steps complete',
  );
  assert.equal(
    computeOverallProgress('export', { ...readyContext, renderState: { status: 'done' } }),
    94,
    'demo-only export cannot finish the source check',
  );
  assert.equal(computeOverallProgress('unknown', {}), 0);
});

test('overall progress never goes backwards between steps', () => {
  const context = { ...readyContext, analysisState: { status: 'done' } };
  let previous = 0;
  for (const screen of STEP_IDS) {
    const value = computeOverallProgress(screen, context);
    assert.ok(value >= previous, `${screen} should not regress`);
    previous = value;
  }
});

test('stepChecks returns the documented checklist ids per screen', () => {
  assert.deepEqual(stepChecks('setup', {}).map((check) => check.id), ['files', 'duration', 'mood', 'name']);
  assert.deepEqual(stepChecks('arrange', {}).map((check) => check.id), ['in-set', 'target', 'analysis', 'order']);
  assert.deepEqual(stepChecks('editor', {}).map((check) => check.id), ['ready', 'transition', 'crossfade', 'preview']);
  assert.deepEqual(stepChecks('export', {}).map((check) => check.id), ['ready', 'source', 'package', 'render']);
});

test('describeActivity surfaces live analysis and render progress', () => {
  assert.equal(describeActivity({ status: 'idle' }, { status: 'idle' }), null);

  const analysis = describeActivity(
    { status: 'running', progress: 42, trackCount: 5, trackIndex: 2, currentTrackName: 'Bài 2', phaseLabel: 'Đang tìm BPM…' },
    { status: 'idle' },
  );
  assert.equal(analysis.id, 'analysis');
  assert.equal(analysis.percent, 42);
  assert.match(analysis.detail, /bài 2\/5/);

  const render = describeActivity({ status: 'idle' }, { status: 'running', progress: 61, phaseLabel: 'Đang mã hóa MP3…' });
  assert.equal(render.id, 'render');
  assert.equal(render.percent, 61);
  assert.match(render.detail, /mã hóa/);
});
