import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateBpm, estimateEnergy, estimateMusicalKey } from './audioDsp.js';

function makeClickTrack({ bpm, duration = 24, sampleRate = 11025 }) {
  const samples = new Float32Array(Math.floor(duration * sampleRate));
  const beatSamples = Math.round(sampleRate * 60 / bpm);
  const clickLength = Math.round(sampleRate * 0.055);
  for (let beat = 0; beat * beatSamples < samples.length; beat += 1) {
    const start = beat * beatSamples;
    for (let index = 0; index < clickLength && start + index < samples.length; index += 1) {
      const envelope = Math.exp(-index / (sampleRate * 0.012));
      samples[start + index] += Math.sin(2 * Math.PI * 1100 * index / sampleRate) * envelope * 0.85;
    }
  }
  return samples;
}

function makeChord({ notes, duration = 8, sampleRate = 22050 }) {
  const samples = new Float32Array(Math.floor(duration * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    let value = 0;
    for (const frequency of notes) value += Math.sin(2 * Math.PI * frequency * time) / (notes.length * 2);
    samples[index] = value;
  }
  return samples;
}

test('BPM analysis detects a steady synthetic 120 BPM beat', () => {
  const estimate = estimateBpm(makeClickTrack({ bpm: 120 }), 11025);
  assert.ok(estimate, 'expected a BPM estimate');
  assert.ok(Math.abs(estimate.bpm - 120) <= 3, `expected about 120 BPM, got ${estimate.bpm}`);
});

test('key analysis identifies a synthetic C major chord', () => {
  const samples = makeChord({ notes: [261.63, 329.63, 392] });
  const estimate = estimateMusicalKey(samples, 22050);
  assert.ok(estimate, 'expected a key estimate');
  assert.equal(estimate.key, 'C major');
  assert.equal(estimate.camelot, '8B');
});

test('analysis estimates relative energy from RMS without assigning a score to silence', () => {
  const quiet = new Float32Array(22050).fill(0.01);
  const loud = new Float32Array(22050).fill(0.3);
  assert.ok(estimateEnergy(loud) > estimateEnergy(quiet));
  assert.equal(estimateEnergy(new Float32Array(22050)), null);
});

test('analysis rejects a silent signal rather than inventing BPM or key', () => {
  const silent = new Float32Array(22050 * 10);
  assert.equal(estimateBpm(silent, 22050), null);
  assert.equal(estimateMusicalKey(silent, 22050), null);
  assert.equal(estimateEnergy(silent), null);
});
