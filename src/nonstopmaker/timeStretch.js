/**
 * Key-locked time stretching.
 *
 * Tempo sync used to resample the incoming track, which shifted its pitch with
 * the tempo (a 3% speed-up also raised everything by ~half a semitone). This
 * module stretches time without touching pitch, using a phase vocoder with
 * identity phase locking (Laroche & Dolson) plus transient resets so drum
 * attacks are not smeared.
 *
 * Everything here is plain array maths so it can be unit tested in Node.
 */

const TWO_PI = Math.PI * 2;

export function nextPowerOfTwo(value) {
  const number = Math.max(2, Math.ceil(Number(value) || 2));
  return 2 ** Math.ceil(Math.log2(number));
}

/** Wraps a phase into (-pi, pi]. */
export function principalArgument(phase) {
  const value = Number(phase) || 0;
  return value - TWO_PI * Math.round(value / TWO_PI);
}

export function hannWindow(size) {
  const window = new Float32Array(size);
  if (size === 1) {
    window[0] = 1;
    return window;
  }
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos(TWO_PI * index / (size - 1));
  }
  return window;
}

/**
 * Iterative radix-2 FFT with cached twiddles and bit-reversal, so the vocoder
 * can run it tens of thousands of times without recomputing trigonometry.
 */
export function createFft(size) {
  const length = Number(size);
  if (!Number.isInteger(length) || length < 2 || (length & (length - 1)) !== 0) {
    throw new Error('FFT size must be a power of two');
  }
  const bits = Math.round(Math.log2(length));
  const reversed = new Uint32Array(length);
  for (let index = 0; index < length; index += 1) {
    let value = 0;
    for (let bit = 0; bit < bits; bit += 1) value = (value << 1) | ((index >> bit) & 1);
    reversed[index] = value;
  }
  const cosTable = new Float64Array(length / 2);
  const sinTable = new Float64Array(length / 2);
  for (let index = 0; index < length / 2; index += 1) {
    cosTable[index] = Math.cos(TWO_PI * index / length);
    sinTable[index] = Math.sin(TWO_PI * index / length);
  }

  function transform(real, imaginary, inverse) {
    for (let index = 0; index < length; index += 1) {
      const target = reversed[index];
      if (target > index) {
        const realSwap = real[index];
        real[index] = real[target];
        real[target] = realSwap;
        const imaginarySwap = imaginary[index];
        imaginary[index] = imaginary[target];
        imaginary[target] = imaginarySwap;
      }
    }
    for (let span = 2; span <= length; span <<= 1) {
      const half = span >> 1;
      const step = length / span;
      for (let start = 0; start < length; start += span) {
        for (let offset = 0; offset < half; offset += 1) {
          const tableIndex = offset * step;
          const wr = cosTable[tableIndex];
          const wi = inverse ? sinTable[tableIndex] : -sinTable[tableIndex];
          const a = start + offset;
          const b = a + half;
          const tr = real[b] * wr - imaginary[b] * wi;
          const ti = real[b] * wi + imaginary[b] * wr;
          real[b] = real[a] - tr;
          imaginary[b] = imaginary[a] - ti;
          real[a] += tr;
          imaginary[a] += ti;
        }
      }
    }
    if (inverse) {
      for (let index = 0; index < length; index += 1) {
        real[index] /= length;
        imaginary[index] /= length;
      }
    }
  }

  return {
    size: length,
    forward: (real, imaginary) => transform(real, imaginary, false),
    inverse: (real, imaginary) => transform(real, imaginary, true),
  };
}

/** Local maxima used as phase-locking anchors. */
export function findSpectralPeaks(magnitudes, threshold = 1e-7) {
  const peaks = [];
  const limit = magnitudes.length - 1;
  for (let bin = 1; bin < limit; bin += 1) {
    if (magnitudes[bin] > magnitudes[bin - 1] && magnitudes[bin] >= magnitudes[bin + 1] && magnitudes[bin] > threshold) {
      peaks.push(bin);
    }
  }
  return peaks;
}

function frameRms(samples, start, size) {
  let sum = 0;
  for (let index = 0; index < size; index += 1) {
    const value = samples[start + index] || 0;
    sum += value * value;
  }
  return Math.sqrt(sum / size);
}

/**
 * Stretches one channel. `stretch` is the length multiplier: 1.05 makes the
 * audio 5% longer (and therefore 5% slower) without moving any pitch.
 */
export function timeStretchChannel(input, stretch, options = {}) {
  if (!(input instanceof Float32Array)) return new Float32Array(0);
  const factor = Number(stretch);
  if (!Number.isFinite(factor) || factor <= 0) return input.slice();
  if (Math.abs(factor - 1) < 1e-6) return input.slice();

  const fftSize = nextPowerOfTwo(options.fftSize ?? 2048);
  const analysisHop = Math.max(1, Math.round(options.analysisHop ?? fftSize / 4));
  const synthesisHop = Math.max(1, Math.round(analysisHop * factor));
  const halfSize = fftSize / 2;
  const bins = halfSize + 1;
  const fft = createFft(fftSize);
  const window = hannWindow(fftSize);

  const padLeft = fftSize;
  const padded = new Float32Array(input.length + fftSize * 2);
  padded.set(input, padLeft);
  const frameCount = Math.max(1, Math.floor((padded.length - fftSize) / analysisHop) + 1);
  const outputLength = Math.max(1, Math.round(input.length * factor));
  const outLength = Math.round(padded.length * factor) + fftSize;
  const output = new Float32Array(outLength);
  const weight = new Float32Array(outLength);

  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  const magnitudes = new Float64Array(bins);
  const analysisPhase = new Float64Array(bins);
  const previousPhase = new Float64Array(bins);
  const synthesisPhase = new Float64Array(bins);
  const expectedAdvance = new Float64Array(bins);
  for (let bin = 0; bin < bins; bin += 1) expectedAdvance[bin] = TWO_PI * analysisHop * bin / fftSize;

  const transientSensitivity = Number(options.transientSensitivity ?? 1.7);
  let previousRms = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const analysisStart = frame * analysisHop;
    for (let index = 0; index < fftSize; index += 1) {
      real[index] = (padded[analysisStart + index] || 0) * window[index];
      imaginary[index] = 0;
    }
    fft.forward(real, imaginary);

    for (let bin = 0; bin < bins; bin += 1) {
      const re = real[bin];
      const im = imaginary[bin];
      magnitudes[bin] = Math.hypot(re, im);
      analysisPhase[bin] = Math.atan2(im, re);
    }

    const rms = frameRms(padded, analysisStart, fftSize);
    const isTransient = frame > 0 && rms > previousRms * transientSensitivity && rms > 1e-4;
    previousRms = rms;

    if (frame === 0 || isTransient) {
      // Keep the attack's original phases: this is what stops drums sounding
      // like they were smeared with a brush instead of hit with a stick.
      for (let bin = 0; bin < bins; bin += 1) synthesisPhase[bin] = analysisPhase[bin];
    } else {
      for (let bin = 0; bin < bins; bin += 1) {
        const deviation = principalArgument(analysisPhase[bin] - previousPhase[bin] - expectedAdvance[bin]);
        const instantFrequency = (expectedAdvance[bin] + deviation) / analysisHop;
        synthesisPhase[bin] += instantFrequency * synthesisHop;
      }
    }

    // Identity phase locking: bins around a spectral peak inherit that peak's
    // phase offset, which removes most of the "phasey" warble of a plain vocoder.
    const peaks = findSpectralPeaks(magnitudes);
    if (peaks.length > 0) {
      for (let peakIndex = 0; peakIndex < peaks.length; peakIndex += 1) {
        const peak = peaks[peakIndex];
        const previousPeak = peakIndex > 0 ? peaks[peakIndex - 1] : -1;
        const nextPeak = peakIndex + 1 < peaks.length ? peaks[peakIndex + 1] : bins;
        const from = previousPeak < 0 ? 0 : Math.ceil((previousPeak + peak) / 2);
        const to = nextPeak >= bins ? bins : Math.ceil((peak + nextPeak) / 2);
        const peakPhase = synthesisPhase[peak];
        const analysisPeakPhase = analysisPhase[peak];
        for (let bin = from; bin < to; bin += 1) {
          synthesisPhase[bin] = peakPhase + principalArgument(analysisPhase[bin] - analysisPeakPhase);
        }
      }
    }

    for (let bin = 0; bin < bins; bin += 1) {
      const magnitude = magnitudes[bin];
      const phase = synthesisPhase[bin];
      real[bin] = magnitude * Math.cos(phase);
      imaginary[bin] = magnitude * Math.sin(phase);
      if (bin > 0 && bin < halfSize) {
        real[fftSize - bin] = real[bin];
        imaginary[fftSize - bin] = -imaginary[bin];
      }
    }
    imaginary[0] = 0;
    imaginary[halfSize] = 0;
    fft.inverse(real, imaginary);

    for (let bin = 0; bin < bins; bin += 1) previousPhase[bin] = analysisPhase[bin];

    const synthesisStart = frame * synthesisHop;
    for (let index = 0; index < fftSize; index += 1) {
      const target = synthesisStart + index;
      if (target >= outLength) break;
      const gain = window[index];
      output[target] += real[index] * gain;
      weight[target] += gain * gain;
    }
  }

  const offset = Math.round(padLeft * factor);
  const result = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const source = offset + index;
    const norm = source < outLength ? weight[source] : 0;
    result[index] = norm > 1e-6 ? output[source] / norm : (source < outLength ? output[source] : 0);
  }
  return result;
}

/**
 * Stretches a stereo pair through mid/side so the stereo image and the mono
 * compatibility of the low end survive the vocoder.
 */
export function timeStretchStereo(left, right, stretch, options = {}) {
  if (!(left instanceof Float32Array)) return { left: new Float32Array(0), right: new Float32Array(0) };
  const sourceRight = right instanceof Float32Array && right.length === left.length ? right : left;
  const factor = Number(stretch);
  if (!Number.isFinite(factor) || factor <= 0) return { left: left.slice(), right: sourceRight.slice() };
  if (Math.abs(factor - 1) < 1e-6) return { left: left.slice(), right: sourceRight.slice() };

  const mid = new Float32Array(left.length);
  const side = new Float32Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] || 0;
    const r = sourceRight[index] || 0;
    mid[index] = (l + r) * 0.5;
    side[index] = (l - r) * 0.5;
  }

  const midStretched = timeStretchChannel(mid, factor, options);
  const sideStretched = timeStretchChannel(side, factor, options);
  const length = Math.min(midStretched.length, sideStretched.length);
  const outLeft = new Float32Array(length);
  const outRight = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const m = midStretched[index];
    const s = sideStretched[index];
    outLeft[index] = m + s;
    outRight[index] = m - s;
  }
  return { left: outLeft, right: outRight };
}

/**
 * Dominant frequency of a buffer, used to prove pitch is preserved.
 * Returns Hz rounded to two decimals.
 */
export function dominantFrequency(samples, sampleRate, options = {}) {
  if (!(samples instanceof Float32Array) || samples.length < 64) return null;
  const fftSize = nextPowerOfTwo(Math.min(options.fftSize ?? 16384, samples.length));
  const fft = createFft(fftSize);
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  const window = hannWindow(fftSize);
  const offset = Math.max(0, Math.floor((samples.length - fftSize) / 2));
  for (let index = 0; index < fftSize; index += 1) {
    real[index] = (samples[offset + index] || 0) * window[index];
  }
  fft.forward(real, imaginary);
  let bestBin = 1;
  let bestMagnitude = 0;
  const minBin = Math.max(1, Math.floor((options.minHz ?? 20) * fftSize / sampleRate));
  const maxBin = Math.min(fftSize / 2 - 1, Math.ceil((options.maxHz ?? 8000) * fftSize / sampleRate));
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    const magnitude = Math.hypot(real[bin], imaginary[bin]);
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      bestBin = bin;
    }
  }
  // Parabolic interpolation over the log magnitudes for sub-bin accuracy.
  const before = Math.log(Math.hypot(real[bestBin - 1], imaginary[bestBin - 1]) + 1e-12);
  const centre = Math.log(bestMagnitude + 1e-12);
  const after = Math.log(Math.hypot(real[bestBin + 1], imaginary[bestBin + 1]) + 1e-12);
  const curvature = before - 2 * centre + after;
  const shift = Math.abs(curvature) > 1e-12 ? 0.5 * (before - after) / curvature : 0;
  return Math.round((bestBin + shift) * sampleRate / fftSize * 100) / 100;
}
