import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWaveform } from './waveform.js';

function mockBuffer(left, right = null) {
  const channels = right ? [Float32Array.from(left), Float32Array.from(right)] : [Float32Array.from(left)];
  return {
    length: channels[0].length,
    numberOfChannels: channels.length,
    getChannelData: (index) => channels[index],
  };
}

test('waveform extraction summarizes stereo amplitude into compact peak arrays', () => {
  const left = [0.1, -0.1, 0.1, -0.1, 0.25, -0.25, 0.25, -0.25, 0.5, -0.5, 0.5, -0.5, 1, -1, 1, -1];
  const right = left.map((sample) => sample * 0.5);
  const waveform = extractWaveform(mockBuffer(left, right), 4, 8);
  assert.deepEqual(Array.from(waveform.left), [26, 64, 128, 255]);
  assert.deepEqual(Array.from(waveform.right), [13, 32, 64, 128]);
});

test('mono waveform is mirrored to both channels and empty buffers are ignored', () => {
  const waveform = extractWaveform(mockBuffer([0, 0.5, -0.25, 1]), 2);
  assert.deepEqual(Array.from(waveform.left), Array.from(waveform.right));
  assert.equal(extractWaveform(mockBuffer([])), null);
});
