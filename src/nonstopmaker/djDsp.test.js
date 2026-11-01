import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBiquad,
  bassSwapGains,
  beatOffset,
  biquadCoefficients,
  estimateDownbeat,
  findOnsetNear,
  foldTempo,
  mixBands,
  onsetEnvelope,
  planTempoSync,
  resampleLinear,
  resolveCueWindow,
  snapToBar,
  splitBands,
  tempoRatio,
} from './djDsp.js';

const SR = 44100;

function sine(frequency, duration, sampleRate = SR, amplitude = 0.5) {
  const samples = new Float32Array(Math.floor(duration * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin(2 * Math.PI * frequency * index / sampleRate) * amplitude;
  }
  return samples;
}

/** Peak energy of a band, used to prove EQ moves the right frequencies. */
function bandEnergy(samples) {
  let power = 0;
  for (let index = 0; index < samples.length; index += 1) power += samples[index] * samples[index];
  return Math.sqrt(power / Math.max(1, samples.length));
}

/** 4/4 click track where beat one of every bar is louder than beats 2-4. */
function makeBarTrack({ bpm = 120, bars = 8, sampleRate = SR, accentFirstBeat = true } = {}) {
  const beatSamples = Math.round(sampleRate * 60 / bpm);
  const samples = new Float32Array(beatSamples * 4 * bars);
  const clickLength = Math.round(sampleRate * 0.02);
  for (let beat = 0; beat < bars * 4; beat += 1) {
    const start = beat * beatSamples;
    const isFirst = beat % 4 === 0;
    const amplitude = !accentFirstBeat ? 0.4 : (isFirst ? 0.9 : 0.22);
    for (let index = 0; index < clickLength && start + index < samples.length; index += 1) {
      const envelope = Math.exp(-index / (sampleRate * 0.0035));
      samples[start + index] += Math.sin(2 * Math.PI * 1000 * index / sampleRate) * envelope * amplitude;
    }
  }
  return samples;
}

test('tempoRatio reports the signed relative difference', () => {
  assert.ok(Math.abs(tempoRatio(124, 128) - 0.032258) < 1e-4);
  assert.ok(Math.abs(tempoRatio(128, 124) + 0.03125) < 1e-4);
  assert.equal(tempoRatio(0, 128), null);
  assert.equal(tempoRatio('x', 128), null);
});

test('foldTempo matches half/double time grooves', () => {
  assert.equal(foldTempo(70, 140), 70, '140 folded down to the 70 BPM range');
  assert.equal(foldTempo(140, 70), 140, '70 folded up to the 140 BPM range');
  assert.ok(Math.abs(foldTempo(124, 124) - 124) < 1e-9);
});

test('planTempoSync keeps ratios inside the ±6% window and flags wider gaps', () => {
  const inside = planTempoSync(124, 128);
  assert.equal(inside.withinLimit, true);
  assert.ok(Math.abs(inside.ratio - 0.032258) < 1e-4);

  const tooWide = planTempoSync(120, 136);
  assert.equal(tooWide.withinLimit, false);
  assert.equal(tooWide.outOfRange, true);
  assert.match(tooWide.reason, /giới hạn/);

  const halfTime = planTempoSync(140, 70);
  assert.equal(halfTime.withinLimit, true, 'half-time must be treated as matching');

  const unknown = planTempoSync(null, 128);
  assert.equal(unknown.playable, false);
});

test('resampleLinear changes length by 1/ratio and preserves a sine shape', () => {
  const input = sine(220, 0.5);
  const faster = resampleLinear(input, 1.05);
  assert.equal(faster.length, Math.round(input.length / 1.05));
  const slower = resampleLinear(input, 0.95);
  assert.equal(slower.length, Math.round(input.length / 0.95));
  const same = resampleLinear(input, 1);
  assert.equal(same.length, input.length);
  assert.ok(Math.abs(same[100] - input[100]) < 1e-9);
  assert.equal(resampleLinear('nope', 1).length, 0);
});

test('biquad filters pass their own band and reject the opposite one', () => {
  const low = sine(80, 0.4);
  const high = sine(6000, 0.4);
  const lowPass = biquadCoefficients('lowpass', 300, SR, 0.7071);
  const highPass = biquadCoefficients('highpass', 300, SR, 0.7071);

  const lowThroughLowPass = bandEnergy(applyBiquad(low.slice(), lowPass));
  const lowThroughHighPass = bandEnergy(applyBiquad(low.slice(), highPass));
  assert.ok(lowThroughLowPass > lowThroughHighPass * 4, '80 Hz must survive the low-pass');

  const highThroughHighPass = bandEnergy(applyBiquad(high.slice(), highPass));
  const highThroughLowPass = bandEnergy(applyBiquad(high.slice(), lowPass));
  assert.ok(highThroughHighPass > highThroughLowPass * 4, '6 kHz must survive the high-pass');
});

test('splitBands keeps low/mid/high separated', () => {
  const bass = sine(60, 0.3);
  const mid = sine(1000, 0.3);
  const treble = sine(8000, 0.3);
  const bands = splitBands(bass, mid, SR, { lowHz: 200, highHz: 2500 });
  assert.ok(bandEnergy(bands.lowLeft) > bandEnergy(bands.lowRight) * 2, '60 Hz lands in the low band');
  assert.ok(bandEnergy(bands.highRight) > bandEnergy(bands.highLeft) * 2, '1 kHz does not leak into the high band');
  assert.ok(bandEnergy(splitBands(treble, treble, SR).highLeft) > 0.1);
});

test('bassSwapGains hands the low end over with a clean hole', () => {
  const gains = bassSwapGains(1000);
  assert.ok(gains.outLow[0] > 0.98, 'outgoing keeps its lows at the start');
  assert.ok(gains.outLow[999] < 0.02, 'outgoing lows are gone by the end');
  assert.ok(gains.inLow[999] > 0.98, 'incoming owns the lows at the end');
  assert.ok(gains.inLow[0] < 0.02);

  // The whole point: at the hand-over point neither track pushes low end.
  assert.ok(gains.outLow[500] < 0.05, 'outgoing lows are closed at the crossover');
  assert.ok(gains.inLow[500] < 0.05, 'incoming lows have not opened yet');
  assert.ok(gains.outMid[500] > 0.6, 'mids keep the equal-power fade through the crossover');

  const equalPowerMid = Math.cos(0.5005 * Math.PI * 0.5);
  assert.ok(Math.abs(gains.outMid[500] - equalPowerMid) < 0.01);

  const narrow = bassSwapGains(100, { start: 0.25, end: 0.75 });
  assert.ok(narrow.outLow[10] > 0.98, 'before the window the outgoing track keeps lows');
  assert.ok(narrow.inLow[10] < 0.12);
  assert.ok(narrow.outLow[70] < 0.5, 'the swap still completes inside the window');
});

test('mixBands avoids bass build-up where old and new lows overlap', () => {
  const count = 400;
  const flat = () => new Float32Array(count).fill(0.25);
  const gains = bassSwapGains(count);
  const swapped = mixBands({
    outLow: flat(), outMid: flat(), outHigh: flat(),
    outRightLow: flat(), outRightMid: flat(), outRightHigh: flat(),
    inLow: flat(), inMid: flat(), inHigh: flat(),
    inRightLow: flat(), inRightMid: flat(), inRightHigh: flat(),
    gains, count, bassSwap: true,
  });
  const plain = mixBands({
    outLow: flat(), outMid: flat(), outHigh: flat(),
    outRightLow: flat(), outRightMid: flat(), outRightHigh: flat(),
    inLow: flat(), inMid: flat(), inHigh: flat(),
    inRightLow: flat(), inRightMid: flat(), inRightHigh: flat(),
    gains, count, bassSwap: false,
  });
  const midIndex = count / 2;
  assert.ok(Math.abs(swapped.left[midIndex]) < Math.abs(plain.left[midIndex]), 'bass swap must lower the mid-fade level');
  assert.ok(Number.isFinite(swapped.left[0]) && Number.isFinite(swapped.right[count - 1]));
  assert.ok(Math.abs(swapped.left[0]) <= 1 && Math.abs(swapped.right[0]) <= 1, 'output stays limited');
});

test('onsetEnvelope finds transients in a click track', () => {
  const track = makeBarTrack({ bpm: 120, bars: 2 });
  const { envelope, frameRate } = onsetEnvelope(track, SR);
  assert.ok(envelope.length > 0);
  assert.ok(frameRate > 0);
  const peak = Math.max(...envelope);
  assert.ok(peak > 0);
  const onset = findOnsetNear(envelope, frameRate, 0.5, 0.2);
  assert.ok(onset, 'expected an onset near the first beat');
  assert.ok(Math.abs(onset.seconds - 0.5) < 0.09);
});

test('estimateDownbeat locks onto the accented beat one of each bar', () => {
  const bpm = 120;
  const track = makeBarTrack({ bpm, bars: 8 });
  const { envelope, frameRate } = onsetEnvelope(track, SR);
  const grid = estimateDownbeat(envelope, frameRate, bpm);
  assert.ok(grid, 'expected a beat grid');
  assert.ok(Math.abs(grid.beatSeconds - 0.5) < 0.01, `beat length should be 0.5s, got ${grid.beatSeconds}`);
  assert.ok(Math.abs(grid.firstBeatSeconds - 0) < 0.08, `accent is on the first beat, got ${grid.firstBeatSeconds}`);
});

test('estimateDownbeat rejects unusable input instead of guessing', () => {
  assert.equal(estimateDownbeat(new Float32Array(0), 100, 120), null);
  assert.equal(estimateDownbeat(new Float32Array(1000).fill(1), 100, 0), null);
  const tiny = onsetEnvelope(new Float32Array(4000), SR);
  assert.equal(estimateDownbeat(tiny.envelope, tiny.frameRate, 120), null, 'one bar is not enough');
});

test('snapToBar moves to a bar boundary and never goes backwards', () => {
  const grid = { beatSeconds: 0.5, firstBeatSeconds: 0 };
  assert.equal(snapToBar(0, grid), 0);
  assert.equal(snapToBar(0.1, grid), 2, '0.1s snaps forward to bar 1 (2s)');
  assert.equal(snapToBar(2, grid), 2, 'already on a bar stays put');
  assert.equal(snapToBar(2.1, grid), 4);
  assert.equal(snapToBar(5, grid, { bars: 2 }), 8, 'two-bar phrase snapping');
  assert.equal(snapToBar(11.7, { beatSeconds: 0.5, firstBeatSeconds: 0.3 }), 12.3);
  assert.equal(snapToBar(7, null), 7, 'no grid means a plain pass-through');
});

test('beatOffset steps whole beats and guards bad BPM', () => {
  assert.ok(Math.abs(beatOffset(10, 16, 120) - 18) < 1e-9);
  assert.equal(beatOffset(10, 0, 120), 10);
  assert.equal(beatOffset(10, 4, 0), 10);
  assert.equal(beatOffset(-5, 1, 120) >= 0, true);
});

test('resolveCueWindow honours manual cue points and clamps them safely', () => {
  const full = resolveCueWindow({}, 200, 200 * SR);
  assert.equal(full.startSeconds, 0);
  assert.equal(full.endSeconds, 200);

  const manual = resolveCueWindow({ cueIn: 32, cueOut: 180 }, 200, 200 * SR);
  assert.equal(manual.startSeconds, 32);
  assert.equal(manual.endSeconds, 180);
  assert.equal(manual.lengthFrames, (180 - 32) * SR);

  const inverted = resolveCueWindow({ cueIn: 150, cueOut: 20 }, 200, 200 * SR);
  assert.ok(inverted.endSeconds > inverted.startSeconds, 'an inverted window is repaired');
  assert.ok(inverted.endSeconds >= inverted.startSeconds + 0.5);

  const negative = resolveCueWindow({ cueIn: -10, cueOut: 9999 }, 200, 200 * SR);
  assert.equal(negative.startSeconds, 0);
  assert.equal(negative.endSeconds, 200);
});

test('tempo sync resamples by the inverse ratio so the output lands on the target BPM', () => {
  // Regression: 128 BPM against 124 BPM must come OUT at 124, not at 132.
  const plan = planTempoSync(124, 128);
  assert.ok(plan.withinLimit);
  const outgoing = 124;
  const incoming = 128;
  // Resampling by 1/ratio stretches the buffer; playback then covers the same
  // musical material at the outgoing tempo.
  const resampleRatio = 1 / (1 + plan.ratio);
  const stretched = resampleLinear(new Float32Array(128 * 1000), resampleRatio);
  const stretchFactor = stretched.length / (128 * 1000);
  const resultingBpm = incoming / stretchFactor;
  assert.ok(Math.abs(resultingBpm - outgoing) < 0.5, `expected about ${outgoing} BPM, got ${resultingBpm}`);
});

test('tempo sync leaves out-of-range tracks untouched', () => {
  const plan = planTempoSync(120, 136);
  assert.equal(plan.withinLimit, false);
  const length = 44100;
  const input = new Float32Array(length);
  // The renderer only resamples when withinLimit, so the buffer keeps its length.
  const untouched = plan.withinLimit ? resampleLinear(input, 1 / (1 + plan.ratio)) : input;
  assert.equal(untouched.length, length);
});
