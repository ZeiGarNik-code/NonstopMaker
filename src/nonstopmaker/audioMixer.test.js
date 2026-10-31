import test from 'node:test';
import assert from 'node:assert/strict';
import { Mp3Encoder } from '@breezystack/lamejs';
import { getTransitionFrames, mixOverlap, normalizeChannels } from './audioMixer.js';

test('equal-power crossfade raises the midpoint and preserves opposing-channel cancellation', () => {
  const outgoing = new Float32Array([0.5, 0.5, 0.5, 0.5]);
  const incoming = new Float32Array([0.5, 0.5, 0.5, 0.5]);
  const mixed = mixOverlap(outgoing, outgoing, incoming, incoming, 4);
  assert.ok(mixed.left[1] > mixed.left[0]);
  assert.equal(mixed.left[1], mixed.right[1]);

  const inverted = mixOverlap(new Float32Array(3).fill(0.5), new Float32Array(3).fill(0.5), new Float32Array(3).fill(-0.5), new Float32Array(3).fill(-0.5), 3);
  assert.ok(Math.abs(inverted.left[1]) < 0.01);
});

test('beat-aware crossfade length rounds to whole beats and leaves fixed fades unchanged without BPM', () => {
  assert.equal(getTransitionFrames({ bpm: 120 }, { bpm: 120 }, 8, 44100, true), 8 * 44100);
  const rounded = getTransitionFrames({ bpm: 128 }, { bpm: 128 }, 8, 44100, true);
  assert.equal(rounded, Math.round((17 * 60 / 128) * 44100));
  assert.equal(getTransitionFrames({}, {}, 8, 44100, true), 8 * 44100);
  assert.equal(getTransitionFrames({ bpm: 128 }, { bpm: 128 }, 8, 44100, false), 8 * 44100);
});

test('RMS normalizer targets a safe average level and leaves silence intact', () => {
  const left = new Float32Array(2048).fill(0.1);
  const right = new Float32Array(2048).fill(-0.1);
  const gain = normalizeChannels(left, right);
  assert.ok(Math.abs(gain - 1.7) < 0.01);
  assert.ok(Math.abs(left[0] - 0.17) < 0.01);
  assert.ok(Math.abs(right[0] + 0.17) < 0.01);

  const silenceLeft = new Float32Array(32);
  const silenceRight = new Float32Array(32);
  assert.equal(normalizeChannels(silenceLeft, silenceRight), 1);
  assert.equal(silenceLeft[0], 0);
});

test('installed LAME encoder emits an MP3 frame for browser worker PCM chunks', () => {
  const encoder = new Mp3Encoder(2, 44100, 128);
  const silence = new Int16Array(1152);
  const encoded = encoder.encodeBuffer(silence, silence);
  const flushed = encoder.flush();
  assert.ok((encoded?.length || 0) + (flushed?.length || 0) > 0);
});
