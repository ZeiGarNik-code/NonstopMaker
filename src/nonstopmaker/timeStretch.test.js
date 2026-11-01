import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFft,
  dominantFrequency,
  findSpectralPeaks,
  hannWindow,
  nextPowerOfTwo,
  principalArgument,
  timeStretchChannel,
  timeStretchStereo,
} from './timeStretch.js';

const SR = 44100;

function sine(frequency, seconds, sampleRate = SR, amplitude = 0.5) {
  const samples = new Float32Array(Math.floor(seconds * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin(2 * Math.PI * frequency * index / sampleRate) * amplitude;
  }
  return samples;
}

function rms(samples) {
  let power = 0;
  for (let index = 0; index < samples.length; index += 1) power += samples[index] * samples[index];
  return Math.sqrt(power / Math.max(1, samples.length));
}

test('nextPowerOfTwo rounds up and never goes below 2', () => {
  assert.equal(nextPowerOfTwo(1), 2);
  assert.equal(nextPowerOfTwo(2), 2);
  assert.equal(nextPowerOfTwo(3), 4);
  assert.equal(nextPowerOfTwo(2048), 2048);
  assert.equal(nextPowerOfTwo(2049), 4096);
});

test('principalArgument wraps phases into [-pi, pi)', () => {
  assert.ok(Math.abs(principalArgument(0)) < 1e-12);
  assert.ok(Math.abs(Math.abs(principalArgument(Math.PI)) - Math.PI) < 1e-12);
  // Odd multiples of pi are the wrap boundary and settle on -pi.
  assert.ok(Math.abs(principalArgument(3 * Math.PI) + Math.PI) < 1e-9);
  assert.ok(Math.abs(principalArgument(-3 * Math.PI) + Math.PI) < 1e-9);
  assert.ok(Math.abs(principalArgument(2 * Math.PI + 0.5) - 0.5) < 1e-9);
  assert.ok(Math.abs(principalArgument(-2 * Math.PI + 0.75) - 0.75) < 1e-9);
});

test('hannWindow tapers to silence at both ends', () => {
  const window = hannWindow(64);
  assert.equal(window.length, 64);
  assert.ok(window[0] < 1e-9);
  assert.ok(Math.abs(window[63]) < 1e-9);
  assert.ok(window[32] > 0.99);
});

test('FFT round-trips exactly through the inverse transform', () => {
  const size = 256;
  const fft = createFft(size);
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  const original = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    real[index] = Math.sin(index * 0.37) + Math.cos(index * 0.11);
    original[index] = real[index];
  }
  fft.forward(real, imaginary);
  fft.inverse(real, imaginary);
  for (let index = 0; index < size; index += 1) {
    assert.ok(Math.abs(real[index] - original[index]) < 1e-9, `sample ${index} did not round-trip`);
  }
});

test('FFT of a pure tone puts its energy in the expected bin', () => {
  const size = 1024;
  const fft = createFft(size);
  const bin = 40;
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let index = 0; index < size; index += 1) real[index] = Math.cos(2 * Math.PI * bin * index / size);
  fft.forward(real, imaginary);
  let bestBin = 0;
  let best = 0;
  for (let index = 1; index < size / 2; index += 1) {
    const magnitude = Math.hypot(real[index], imaginary[index]);
    if (magnitude > best) {
      best = magnitude;
      bestBin = index;
    }
  }
  assert.equal(bestBin, bin);
});

test('findSpectralPeaks returns local maxima only', () => {
  const magnitudes = new Float64Array([0, 1, 0.2, 0.5, 0.1, 0.9, 0.3]);
  assert.deepEqual(findSpectralPeaks(magnitudes), [1, 3, 5]);
  assert.deepEqual(findSpectralPeaks(new Float64Array([0, 0, 0])), []);
});

test('dominantFrequency measures a sine accurately', () => {
  const measured = dominantFrequency(sine(440, 0.5), SR);
  assert.ok(Math.abs(measured - 440) < 2, `expected about 440 Hz, got ${measured}`);
  const low = dominantFrequency(sine(110, 0.5), SR);
  assert.ok(Math.abs(low - 110) < 1.5, `expected about 110 Hz, got ${low}`);
});

test('key lock: stretching a tone changes length but NOT pitch', () => {
  const tone = sine(440, 1.2);
  const target = 1.05;
  const stretched = timeStretchChannel(tone, target);
  const lengthRatio = stretched.length / tone.length;
  assert.ok(Math.abs(lengthRatio - target) < 0.02, `length ratio should be ${target}, got ${lengthRatio}`);

  const pitchBefore = dominantFrequency(tone, SR);
  const pitchAfter = dominantFrequency(stretched, SR);
  assert.ok(Math.abs(pitchBefore - 440) < 2);
  assert.ok(
    Math.abs(pitchAfter - pitchBefore) < 6,
    `key lock failed: pitch moved from ${pitchBefore} Hz to ${pitchAfter} Hz`,
  );
});

test('key lock holds pitch for a downward stretch too', () => {
  const tone = sine(220, 1);
  const stretched = timeStretchChannel(tone, 0.95);
  const pitch = dominantFrequency(stretched, SR);
  assert.ok(Math.abs(pitch - 220) < 4, `expected about 220 Hz after stretching, got ${pitch}`);
});

test('contrast: naive resampling WOULD move the pitch (why key lock matters)', () => {
  const tone = sine(440, 1);
  const factor = 1.05;
  const resampledLength = Math.round(tone.length / factor);
  const resampled = new Float32Array(resampledLength);
  for (let index = 0; index < resampledLength; index += 1) {
    const position = index * factor;
    const lower = Math.floor(position);
    const fraction = position - lower;
    const a = tone[lower] || 0;
    const b = tone[lower + 1] ?? a;
    resampled[index] = a + (b - a) * fraction;
  }
  // The shorter buffer already reads 462 Hz, and playing it 5% faster shifts it
  // again, so the listener hears 485 Hz instead of 440 Hz.
  const bufferPitch = dominantFrequency(resampled, SR);
  assert.ok(Math.abs(bufferPitch - 440 * factor) < 6, `expected ${440 * factor} Hz in the buffer, got ${bufferPitch}`);
  const heardPitch = bufferPitch * factor;
  assert.ok(heardPitch > 480, `resampling should be heard around 485 Hz, got ${heardPitch}`);
  assert.ok(Math.abs(heardPitch - 440) > 30, 'and that shift is exactly what key lock removes');
});

test('stretched audio keeps a usable level instead of collapsing', () => {
  const tone = sine(330, 1.5, SR, 0.4);
  const stretched = timeStretchChannel(tone, 1.1);
  const level = rms(stretched.subarray(2000, stretched.length - 2000));
  assert.ok(level > 0.15, `level collapsed to ${level}`);
  assert.ok(level < 0.65, `level blew up to ${level}`);
  assert.ok(stretched.every((value) => Number.isFinite(value)), 'no NaN or Infinity in output');
});

test('identity transform is a pass-through', () => {
  const tone = sine(300, 0.2);
  const same = timeStretchChannel(tone, 1);
  assert.equal(same.length, tone.length);
  assert.ok(Math.abs(same[100] - tone[100]) < 1e-9);
});

test('stereo stretch keeps channels separate and phase-coherent', () => {
  const left = sine(440, 0.8);
  const right = sine(660, 0.8);
  const out = timeStretchStereo(left, right, 1.05);
  assert.ok(Math.abs(out.left.length / left.length - 1.05) < 0.02);
  assert.equal(out.left.length, out.right.length);
  assert.ok(Math.abs(dominantFrequency(out.left, SR) - 440) < 6);
  assert.ok(Math.abs(dominantFrequency(out.right, SR) - 660) < 8);
  // Identity must not colour the signal at all.
  const identical = timeStretchStereo(left, right, 1);
  assert.ok(Math.abs(identical.left[50] - left[50]) < 1e-9);
  assert.ok(Math.abs(identical.right[50] - right[50]) < 1e-9);
});

test('mono input is mirrored instead of crashing the stereo path', () => {
  const mono = sine(440, 0.4);
  const out = timeStretchStereo(mono, null, 1.05);
  assert.equal(out.left.length, out.right.length);
  assert.ok(out.left.every((value) => Number.isFinite(value)));
});

test('bad input is rejected without throwing', () => {
  assert.equal(timeStretchChannel('nope', 1.05).length, 0);
  assert.equal(timeStretchChannel(null, 1.05).length, 0);
  const tone = sine(440, 0.1);
  assert.equal(timeStretchChannel(tone, 0).length, tone.length);
  assert.equal(timeStretchChannel(tone, Number.NaN).length, tone.length);
  assert.equal(timeStretchStereo(null, null, 1.05).left.length, 0);
});

test('transient handling keeps a click sharp rather than smearing it', () => {
  const samples = new Float32Array(Math.floor(SR * 0.5));
  // Silence, then a single sharp click at 0.2s.
  const clickAt = Math.floor(SR * 0.2);
  for (let index = 0; index < 200; index += 1) {
    samples[clickAt + index] = Math.exp(-index / 12) * (index % 2 === 0 ? 0.9 : -0.9);
  }
  const stretched = timeStretchChannel(samples, 1.15);
  let peakIndex = 0;
  let peak = 0;
  for (let index = 0; index < stretched.length; index += 1) {
    const magnitude = Math.abs(stretched[index]);
    if (magnitude > peak) {
      peak = magnitude;
      peakIndex = index;
    }
  }
  const expected = clickAt * 1.15;
  const driftMs = Math.abs(peakIndex - expected) / SR * 1000;
  assert.ok(peak > 0.2, `click lost too much energy (peak ${peak})`);
  assert.ok(driftMs < 60, `click drifted ${driftMs.toFixed(1)}ms, which would sound like flamming`);
});
