import { extractWaveform } from './waveform.js';

const ANALYSIS_WINDOW_SECONDS = 120;
const MAX_ANALYSIS_FILE_BYTES = 200 * 1024 * 1024;

function makeAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Trình duyệt này không hỗ trợ giải mã audio để phân tích.');
  try {
    return new AudioContextClass({ sampleRate: 22050 });
  } catch {
    return new AudioContextClass();
  }
}

function monoAnalysisWindow(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const length = Math.min(audioBuffer.length, Math.floor(sampleRate * ANALYSIS_WINDOW_SECONDS));
  const mono = new Float32Array(length);
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
  const scale = audioBuffer.numberOfChannels > 1 ? 0.5 : 1;
  for (let index = 0; index < length; index += 1) mono[index] = (left[index] + right[index]) * scale;
  return mono;
}

export async function analyzeAudioFile(file, { signal, onProgress } = {}) {
  if (!file) throw new Error('Không có tệp audio để phân tích.');
  if (file.size > MAX_ANALYSIS_FILE_BYTES) throw new Error(`Tệp “${file.name}” quá lớn để giải mã an toàn trên trình duyệt (giới hạn 200 MB mỗi bài).`);
  if (signal?.aborted) throw new DOMException('Đã hủy phân tích.', 'AbortError');

  let context;
  let worker;
  try {
    context = makeAudioContext();
    onProgress?.({ stage: 'decode', progress: 8 });
    const encoded = await file.arrayBuffer();
    if (signal?.aborted) throw new DOMException('Đã hủy phân tích.', 'AbortError');
    const audioBuffer = await context.decodeAudioData(encoded);
    onProgress?.({ stage: 'prepare', progress: 36, duration: audioBuffer.duration, sampleRate: audioBuffer.sampleRate });
    const samples = monoAnalysisWindow(audioBuffer);
    const sampleRate = audioBuffer.sampleRate;

    const result = await new Promise((resolve, reject) => {
      worker = new Worker(new URL('./workers/audioAnalysis.worker.js', import.meta.url), { type: 'module' });
      const cleanup = () => {
        signal?.removeEventListener('abort', handleAbort);
        worker?.terminate();
        worker = null;
      };
      const handleAbort = () => {
        cleanup();
        reject(new DOMException('Đã hủy phân tích.', 'AbortError'));
      };
      signal?.addEventListener('abort', handleAbort, { once: true });
      worker.onmessage = (event) => {
        if (event.data?.type === 'progress') {
          onProgress?.({ stage: event.data.stage, progress: event.data.stage === 'key' ? 72 : 54 });
        } else if (event.data?.type === 'result') {
          cleanup();
          resolve({ ...event.data.result, waveform: extractWaveform(audioBuffer), duration: audioBuffer.duration, sampleRate });
        } else if (event.data?.type === 'error') {
          cleanup();
          reject(new Error(event.data.error));
        }
      };
      worker.onerror = (event) => {
        cleanup();
        reject(new Error(event.message || 'Worker phân tích audio gặp lỗi.'));
      };
      worker.postMessage({ type: 'analyze', samples: samples.buffer, sampleRate }, [samples.buffer]);
    });
    onProgress?.({ stage: 'done', progress: 100, duration: audioBuffer.duration });
    return result;
  } catch (error) {
    if (signal?.aborted && error?.name !== 'AbortError') throw new DOMException('Đã hủy phân tích.', 'AbortError');
    throw error;
  } finally {
    worker?.terminate();
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  }
}
