import { estimateBpm, estimateEnergy, estimateMusicalKey } from '../audioDsp.js';

self.addEventListener('message', async (event) => {
  const data = event.data || {};
  if (data.type !== 'analyze') return;

  try {
    const samples = new Float32Array(data.samples);
    self.postMessage({ type: 'progress', stage: 'bpm' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const tempo = estimateBpm(samples, data.sampleRate);
    self.postMessage({ type: 'progress', stage: 'key' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const musicalKey = estimateMusicalKey(samples, data.sampleRate);
    const energy = estimateEnergy(samples);
    self.postMessage({ type: 'result', result: { tempo, musicalKey, energy } });
  } catch (error) {
    self.postMessage({ type: 'error', error: error?.message || 'Không phân tích được tệp audio.' });
  }
});
