/**
 * DJ-grade DSP building blocks used by the offline mix renderer.
 *
 * Everything here is pure array processing (no Web Audio, no DOM) so it can be
 * unit tested in Node. The renderer decodes tracks, then runs them through:
 *   BeatGrid  ->  TempoSync  ->  EQ3 (bass swap)  ->  cue windows  ->  crossfade
 */

export const TEMPO_SYNC_LIMITS = { min: -0.06, max: 0.06 };

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Signed relative tempo difference, e.g. 124 -> 128 gives +0.032. */
export function tempoRatio(fromBpm, toBpm) {
  const from = Number(fromBpm);
  const to = Number(toBpm);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) return null;
  return to / from - 1;
}

/** Octave-fold two tempos so 70 and 140 BPM are treated as the same groove. */
export function foldTempo(fromBpm, toBpm) {
  const from = Number(fromBpm);
  let to = Number(toBpm);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) return null;
  while (to / from > 1.5) to /= 2;
  while (to / from < 0.66) to *= 2;
  return to;
}

/**
 * Decides whether an incoming track can be beat-matched to the outgoing one.
 * A limit of ±6% keeps vocals natural; anything wider is a different groove.
 */
export function planTempoSync(outgoingBpm, incomingBpm, limit = 0.06) {
  const folded = foldTempo(outgoingBpm, incomingBpm);
  if (folded === null) return { playable: false, ratio: null, outOfRange: false, reason: 'BPM chưa xác định' };
  const ratio = folded / Number(outgoingBpm) - 1;
  const max = Number.isFinite(limit) ? Math.abs(limit) : 0.06;
  const outOfRange = Math.abs(ratio) > max;
  return {
    playable: true,
    ratio,
    targetBpm: folded,
    outOfRange,
    withinLimit: !outOfRange,
    reason: outOfRange
      ? `Lệch ${(ratio * 100).toFixed(1)}% (giới hạn ±${Math.round(max * 100)}%)`
      : `Khớp ${(ratio * 100 >= 0 ? '+' : '')}${(ratio * 100).toFixed(1)}%`,
  };
}

/** Linear-interpolating resampler: the pitch/tempo shift behind tempo sync. */
export function resampleLinear(input, ratio) {
  if (!(input instanceof Float32Array)) return new Float32Array(0);
  const safeRatio = Number(ratio);
  if (!Number.isFinite(safeRatio) || safeRatio <= 0) return input.slice();
  if (Math.abs(safeRatio - 1) < 1e-9) return input.slice();
  const outputLength = Math.max(1, Math.round(input.length / safeRatio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * safeRatio;
    const lower = Math.floor(position);
    const fraction = position - lower;
    const a = input[lower] || 0;
    const b = input[lower + 1] ?? a;
    output[index] = a + (b - a) * fraction;
  }
  return output;
}

/* ------------------------------------------------------------------ */
/* Beat grid                                                          */
/* ------------------------------------------------------------------ */

/**
 * Causal onset follower. A short-window energy compared against a decaying
 * long-window average marks attacks: every kick, snare and hat transient.
 */
export function onsetEnvelope(samples, sampleRate) {
  if (!(samples instanceof Float32Array) || samples.length < 64) return { envelope: new Float32Array(0), frameRate: 0 };
  const frameSize = Math.max(64, Math.round(sampleRate * 0.0058));
  const hop = Math.max(32, Math.round(sampleRate * 0.0029));
  const frameCount = Math.max(1, Math.floor((samples.length - frameSize) / hop) + 1);
  const envelope = new Float32Array(frameCount);
  let average = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hop;
    let sum = 0;
    for (let offset = 0; offset < frameSize; offset += 1) {
      const sample = samples[start + offset] || 0;
      sum += sample * sample;
    }
    const energy = Math.sqrt(sum / frameSize);
    average = average * 0.92 + energy * 0.08;
    envelope[frame] = Math.max(0, energy - average);
  }
  return { envelope, frameRate: sampleRate / hop, hop, frameSize };
}

/**
 * Finds the downbeat by scoring the four phases of a 4/4 bar and keeping the one
 * whose beats carry the most onset energy (the kick usually sits on beat one).
 */
export function estimateDownbeat(envelope, frameRate, bpm) {
  if (!(envelope instanceof Float32Array) || envelope.length === 0) return null;
  const safeBpm = Number(bpm);
  if (!Number.isFinite(safeBpm) || safeBpm < 50 || safeBpm > 220) return null;
  const beatFrames = frameRate * 60 / safeBpm;
  if (!Number.isFinite(beatFrames) || beatFrames < 4) return null;
  const barFrames = beatFrames * 4;
  const bars = Math.floor(envelope.length / barFrames);
  if (bars < 2) return null;

  let best = { phase: 0, score: -Infinity };
  for (let phase = 0; phase < 4; phase += 1) {
    let score = 0;
    let weight = 0;
    for (let bar = 0; bar < bars; bar += 1) {
      const index = Math.round(phase * beatFrames + bar * barFrames);
      if (index >= envelope.length) break;
      const accent = envelope[index] || 0;
      // Echo of the previous two beats tells us whether this is a "new bar" hit.
      const before = envelope[Math.max(0, index - Math.round(beatFrames))] || 0;
      score += accent - before * 0.45;
      weight += 1;
    }
    if (weight > 0 && score / weight > best.score) best = { phase, score: score / weight };
  }
  return { phase: best.phase, firstBeatSeconds: (best.phase * beatFrames) / frameRate, beatSeconds: beatFrames / frameRate, bars };
}

/**
 * Picks the first bar boundary at or after `fromSeconds` so a mix enters on a
 * downbeat instead of mid-phrase.
 */
export function snapToBar(seconds, grid, { bars = 1 } = {}) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return 0;
  if (!grid || !Number.isFinite(grid.beatSeconds) || grid.beatSeconds <= 0) return Math.max(0, value);
  const barSeconds = grid.beatSeconds * 4 * Math.max(1, bars);
  const offset = Number(grid.firstBeatSeconds) || 0;
  const relative = value - offset;
  if (relative <= 0) return Math.max(0, offset);
  const steps = Math.ceil(relative / barSeconds - 1e-9);
  return offset + steps * barSeconds;
}

/** Steps the grid forward from an anchor so cue points stay beat-locked. */
export function beatOffset(seconds, beats, bpm) {
  const value = Number(seconds) || 0;
  const safeBpm = Number(bpm);
  if (!Number.isFinite(safeBpm) || safeBpm <= 0) return Math.max(0, value);
  return Math.max(0, value + (Number(beats) || 0) * 60 / safeBpm);
}

/**
 * Detects the strongest downbeat-aligned onset inside a search window, used for
 * the automatic cue points (mix-in / mix-out).
 */
export function findOnsetNear(envelope, frameRate, targetSeconds, searchSeconds = 1.5) {
  if (!(envelope instanceof Float32Array) || envelope.length === 0 || !Number.isFinite(frameRate) || frameRate <= 0) return null;
  const center = Math.round((Number(targetSeconds) || 0) * frameRate);
  const radius = Math.max(1, Math.round(searchSeconds * frameRate));
  const from = Math.max(0, center - radius);
  const to = Math.min(envelope.length - 1, center + radius);
  let bestIndex = -1;
  let bestValue = 0;
  for (let index = from; index <= to; index += 1) {
    const value = envelope[index] || 0;
    if (value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  }
  if (bestIndex < 0 || bestValue <= 0) return null;
  return { seconds: bestIndex / frameRate, strength: bestValue };
}

/* ------------------------------------------------------------------ */
/* 3-band EQ (bass swap)                                              */
/* ------------------------------------------------------------------ */

/** RBJ biquad coefficients (low-pass, high-pass, peaking). */
export function biquadCoefficients(type, frequency, sampleRate, q = 0.7071, gainDb = 0) {
  const sr = Number(sampleRate);
  const f = clamp(Number(frequency) || 0, 10, sr * 0.45);
  const safeQ = Math.max(0.1, Number(q) || 0.7071);
  const w0 = 2 * Math.PI * f / sr;
  const cosW = Math.cos(w0);
  const sinW = Math.sin(w0);
  const alpha = sinW / (2 * safeQ);

  let b0; let b1; let b2;
  if (type === 'highpass') {
    b0 = (1 + cosW) / 2;
    b1 = -(1 + cosW);
    b2 = (1 + cosW) / 2;
  } else if (type === 'lowpass') {
    b0 = (1 - cosW) / 2;
    b1 = 1 - cosW;
    b2 = (1 - cosW) / 2;
  } else {
    const A = Math.pow(10, (Number(gainDb) || 0) / 40);
    b0 = 1 + alpha * A;
    b1 = -2 * cosW;
    b2 = 1 - alpha * A;
  }
  const a0 = type === 'peaking' ? 1 + alpha / (Math.pow(10, (Number(gainDb) || 0) / 40)) : 1 + alpha;
  const a1 = -2 * cosW;
  const a2 = 1 - alpha;
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

/** In-place single biquad pass with direct form I. */
export function applyBiquad(samples, coefficients) {
  if (!(samples instanceof Float32Array) || !coefficients) return samples;
  const { b0, b1, b2, a1, a2 } = coefficients;
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const x0 = samples[index];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
    samples[index] = y0;
  }
  return samples;
}

/**
 * Splits a buffer into low / mid / high and mixes them back with a per-band gain,
 * which is how a real DJ channel EQ works. Bands are guaranteed to sum back to the
 * original signal when every gain is 1.
 */
export function splitBands(left, right, sampleRate, { lowHz = 200, highHz = 2500 } = {}) {
  const lowCoefficients = biquadCoefficients('lowpass', lowHz, sampleRate, 0.7071);
  const highCoefficients = biquadCoefficients('highpass', highHz, sampleRate, 0.7071);
  return {
    lowLeft: applyBiquad(left.slice(), lowCoefficients),
    lowRight: applyBiquad(right.slice(), lowCoefficients),
    highLeft: applyBiquad(left.slice(), highCoefficients),
    highRight: applyBiquad(right.slice(), highCoefficients),
    midLeft: left.slice(),
    midRight: right.slice(),
  };
}

/**
 * Builds the per-sample gain curves for a bass swap during a crossfade:
 * the outgoing track's lows close while the incoming track's lows open. Mid and
 * high use plain equal-power fades so the hand-over stays seamless.
 */
export function bassSwapGains(overlapFrames, { start = 0, end = 1, lowOutEnd = 0.45, lowInStart = 0.55 } = {}) {
  const count = Math.max(0, Math.floor(overlapFrames));
  const gains = {
    outLow: new Float32Array(count),
    inLow: new Float32Array(count),
    outMid: new Float32Array(count),
    outHigh: new Float32Array(count),
    inMid: new Float32Array(count),
    inHigh: new Float32Array(count),
  };
  const from = clamp(start, 0, 1);
  const to = clamp(end, from, 1);
  // A real bass swap leaves a short hole: the outgoing lows are gone before the
  // incoming lows arrive, so two different basslines never sum into mud.
  const outSpan = Math.max(1e-6, clamp(lowOutEnd, 0.05, 0.95));
  const inStart = clamp(lowInStart, outSpan, 0.99);
  const inSpan = Math.max(1e-6, 1 - inStart);
  for (let index = 0; index < count; index += 1) {
    const amount = (index + 0.5) / count;
    const lowAmount = clamp((amount - from) / Math.max(1e-6, to - from), 0, 1);
    const equalPowerOut = Math.cos(amount * Math.PI * 0.5);
    const equalPowerIn = Math.sin(amount * Math.PI * 0.5);
    gains.outLow[index] = Math.cos(clamp(lowAmount / outSpan, 0, 1) * Math.PI * 0.5);
    gains.inLow[index] = Math.sin(clamp((lowAmount - inStart) / inSpan, 0, 1) * Math.PI * 0.5);
    gains.outMid[index] = equalPowerOut;
    gains.outHigh[index] = equalPowerOut;
    gains.inMid[index] = equalPowerIn;
    gains.inHigh[index] = equalPowerIn;
  }
  return gains;
}

/**
 * Renders one crossfade block. Each track contributes low + mid + high with the
 * bass-swap curves applied, then the block is soft-limited to stay inside ±1.
 */
export function mixBands({
  outLow, outMid, outHigh, outRightLow, outRightMid, outRightHigh,
  inLow, inMid, inHigh, inRightLow, inRightMid, inRightHigh,
  gains, count, bassSwap = true,
}) {
  const length = Math.max(0, Math.floor(count));
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const outLowGain = bassSwap ? gains.outLow[index] : gains.outMid[index];
    const inLowGain = bassSwap ? gains.inLow[index] : gains.inMid[index];
    const leftSum = (outLow[index] * outLowGain) + (outMid[index] * gains.outMid[index]) + (outHigh[index] * gains.outHigh[index])
      + (inLow[index] * inLowGain) + (inMid[index] * gains.inMid[index]) + (inHigh[index] * gains.inHigh[index]);
    const rightSum = (outRightLow[index] * outLowGain) + (outRightMid[index] * gains.outMid[index]) + (outRightHigh[index] * gains.outHigh[index])
      + (inRightLow[index] * inLowGain) + (inRightMid[index] * gains.inMid[index]) + (inRightHigh[index] * gains.inHigh[index]);
    left[index] = Math.tanh(leftSum * 0.82) / 0.82;
    right[index] = Math.tanh(rightSum * 0.82) / 0.82;
  }
  return { left, right };
}

/* ------------------------------------------------------------------ */
/* Cue points                                                         */
/* ------------------------------------------------------------------ */

/**
 * Resolves where a track starts and ends in the mix. Manual values win; otherwise
 * the automatic cue points keep the whole track.
 */
export function resolveCueWindow(track, duration, maxFrames) {
  const total = Math.max(0, Math.floor(Number(duration) * 44100));
  const start = clamp(Number(track?.cueIn) || 0, 0, Math.max(0, duration - 0.5));
  const rawOut = Number.isFinite(Number(track?.cueOut)) && Number(track.cueOut) > 0 ? Number(track.cueOut) : duration;
  const end = clamp(rawOut, start + 0.5, duration);
  const startFrames = Math.round(start * 44100);
  const endFrames = Math.min(total, Math.round(end * 44100));
  return {
    startSeconds: start,
    endSeconds: end,
    startFrames: Math.min(startFrames, Math.max(0, maxFrames - 1)),
    endFrames: Math.max(startFrames + 1, endFrames),
    lengthFrames: Math.max(1, endFrames - startFrames),
  };
}
