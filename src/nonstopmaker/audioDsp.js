const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_CAMELOT = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const MINOR_CAMELOT = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pearsonCorrelation(left, right) {
  const length = left.length;
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / length;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / length;
  let numerator = 0;
  let leftPower = 0;
  let rightPower = 0;
  for (let index = 0; index < length; index += 1) {
    const a = left[index] - meanLeft;
    const b = right[index] - meanRight;
    numerator += a * b;
    leftPower += a * a;
    rightPower += b * b;
  }
  const denominator = Math.sqrt(leftPower * rightPower);
  return denominator > 0 ? numerator / denominator : 0;
}

function fft(real, imaginary) {
  const size = real.length;
  let j = 0;
  for (let index = 1; index < size; index += 1) {
    let bit = size >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (index < j) {
      [real[index], real[j]] = [real[j], real[index]];
      [imaginary[index], imaginary[j]] = [imaginary[j], imaginary[index]];
    }
  }

  for (let blockSize = 2; blockSize <= size; blockSize <<= 1) {
    const angle = -2 * Math.PI / blockSize;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    const half = blockSize >> 1;
    for (let start = 0; start < size; start += blockSize) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        const evenReal = real[even];
        const evenImaginary = imaginary[even];
        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
}

export function estimateBpm(samples, sampleRate) {
  if (!(samples instanceof Float32Array) || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  const analysisLength = Math.min(samples.length, Math.floor(sampleRate * 120));
  if (analysisLength < sampleRate * 8) return null;

  const blockSize = Math.max(256, Math.round(sampleRate * 0.046));
  const hopSize = Math.max(128, Math.floor(blockSize / 2));
  const frameCount = Math.floor((analysisLength - blockSize) / hopSize);
  if (frameCount < 48) return null;
  const energy = new Float32Array(frameCount);
  let previousRms = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize;
    let sum = 0;
    for (let offset = 0; offset < blockSize; offset += 1) {
      const sample = samples[start + offset] || 0;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / blockSize);
    energy[frame] = Math.max(0, rms - previousRms * 0.86);
    previousRms = rms;
  }

  let mean = 0;
  for (const value of energy) mean += value;
  mean /= energy.length;
  let variance = 0;
  for (let index = 0; index < energy.length; index += 1) {
    energy[index] = Math.max(0, energy[index] - mean * 0.42);
    variance += energy[index] * energy[index];
  }
  if (variance < 1e-10) return null;

  const framesPerSecond = sampleRate / hopSize;
  const minLag = Math.max(2, Math.floor(framesPerSecond * 60 / 180));
  const maxLag = Math.min(Math.ceil(framesPerSecond * 60 / 65), Math.floor(frameCount / 2));
  const scores = new Float64Array(maxLag + 1);
  const energyPrefix = new Float64Array(frameCount + 1);
  for (let index = 0; index < frameCount; index += 1) {
    energyPrefix[index + 1] = energyPrefix[index] + energy[index] * energy[index];
  }

  let bestLag = -1;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let product = 0;
    for (let index = lag; index < frameCount; index += 1) product += energy[index] * energy[index - lag];
    const leftEnergy = energyPrefix[frameCount] - energyPrefix[lag];
    const rightEnergy = energyPrefix[frameCount - lag];
    const score = product / Math.sqrt(Math.max(leftEnergy * rightEnergy, 1e-12));
    scores[lag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || bestScore <= 0) return null;

  const before = scores[Math.max(minLag, bestLag - 1)];
  const after = scores[Math.min(maxLag, bestLag + 1)];
  const curvature = before - 2 * bestScore + after;
  const correction = Math.abs(curvature) > 1e-9 ? clamp(0.5 * (before - after) / curvature, -0.5, 0.5) : 0;
  let bpm = 60 * framesPerSecond / (bestLag + correction);
  if (bpm < 78) bpm *= 2;
  if (bpm > 170) bpm /= 2;
  if (bpm < 55 || bpm > 210) return null;

  const alternatives = [];
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    if (scores[lag] >= scores[lag - 1] && scores[lag] >= scores[lag + 1] && lag !== bestLag) alternatives.push(scores[lag]);
  }
  alternatives.sort((left, right) => right - left);
  const secondScore = alternatives[0] || 0;
  const confidence = Math.round(clamp((bestScore - secondScore) / Math.max(bestScore, 1e-9) * 1.8, 0.12, 0.96) * 100);
  return { bpm: Math.round(bpm * 10) / 10, confidence };
}

export function estimateMusicalKey(samples, sampleRate) {
  if (!(samples instanceof Float32Array) || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  const fftSize = 4096;
  const hopSize = 2048;
  const analysisLength = Math.min(samples.length, Math.floor(sampleRate * 75));
  if (analysisLength < fftSize) return null;

  const frameCount = Math.min(420, Math.floor((analysisLength - fftSize) / hopSize) + 1);
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  const window = new Float32Array(fftSize);
  for (let index = 0; index < fftSize; index += 1) window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (fftSize - 1));
  const chroma = new Float64Array(12);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize;
    for (let index = 0; index < fftSize; index += 1) {
      real[index] = (samples[start + index] || 0) * window[index];
      imaginary[index] = 0;
    }
    fft(real, imaginary);

    for (let bin = 10; bin < fftSize / 2; bin += 1) {
      const frequency = bin * sampleRate / fftSize;
      if (frequency < 55 || frequency > 5000) continue;
      const magnitude = Math.hypot(real[bin], imaginary[bin]);
      if (magnitude < 1e-5) continue;
      const midi = 69 + 12 * Math.log2(frequency / 440);
      const nearestNote = Math.round(midi);
      const pitchDistance = Math.abs(midi - nearestNote);
      const pitchClass = ((nearestNote % 12) + 12) % 12;
      const frequencyWeight = 1 / Math.sqrt(Math.max(frequency / 110, 1));
      const tuningWeight = Math.max(0.15, 1 - pitchDistance * 1.2);
      chroma[pitchClass] += Math.pow(magnitude, 0.72) * frequencyWeight * tuningWeight;
    }
  }

  const total = chroma.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  for (let index = 0; index < 12; index += 1) chroma[index] /= total;

  const candidates = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const observed = Array.from({ length: 12 }, (_, degree) => chroma[(tonic + degree) % 12]);
    candidates.push({ tonic, mode: 'major', score: pearsonCorrelation(observed, MAJOR_PROFILE) });
    candidates.push({ tonic, mode: 'minor', score: pearsonCorrelation(observed, MINOR_PROFILE) });
  }
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const second = candidates[1]?.score ?? best.score;
  const confidence = Math.round(clamp((best.score - second) * 2.6, 0.08, 0.96) * 100);
  const camelot = best.mode === 'major' ? MAJOR_CAMELOT[best.tonic] : MINOR_CAMELOT[best.tonic];
  const camelotLetter = best.mode === 'major' ? 'B' : 'A';

  return {
    key: `${NOTE_NAMES[best.tonic]} ${best.mode}`,
    note: NOTE_NAMES[best.tonic],
    mode: best.mode,
    camelot: `${camelot}${camelotLetter}`,
    confidence,
  };
}

export function estimateEnergy(samples) {
  if (!(samples instanceof Float32Array) || samples.length < 1024) return null;
  const stride = Math.max(1, Math.floor(samples.length / 50000));
  let power = 0;
  let count = 0;
  for (let index = 0; index < samples.length; index += stride) {
    const sample = samples[index] || 0;
    power += sample * sample;
    count += 1;
  }
  const rms = Math.sqrt(power / Math.max(1, count));
  if (rms < 0.0005) return null;
  const decibels = 20 * Math.log10(rms);
  return Math.round(clamp((decibels + 36) / 4, 1, 6));
}

export function analyzeSamples(samples, sampleRate) {
  return {
    tempo: estimateBpm(samples, sampleRate),
    musicalKey: estimateMusicalKey(samples, sampleRate),
    energy: estimateEnergy(samples),
  };
}
