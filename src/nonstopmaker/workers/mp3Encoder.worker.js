import { Mp3Encoder } from '@breezystack/lamejs';

let encoder = null;

function toInt16(samples) {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    output[index] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
  }
  return output;
}

function sendEncodedChunk(id, data) {
  if (!data?.length) return;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  self.postMessage({ type: 'chunk', id, buffer: bytes.buffer }, [bytes.buffer]);
}

self.addEventListener('message', (event) => {
  const message = event.data || {};
  try {
    if (message.type === 'init') {
      encoder = new Mp3Encoder(2, message.sampleRate, message.bitrate);
      self.postMessage({ type: 'ready' });
      return;
    }
    if (!encoder) throw new Error('MP3 encoder chưa khởi tạo.');

    if (message.type === 'encode') {
      const left = toInt16(new Float32Array(message.left));
      const right = toInt16(new Float32Array(message.right));
      sendEncodedChunk(message.id, encoder.encodeBuffer(left, right));
      self.postMessage({ type: 'done', id: message.id });
      return;
    }

    if (message.type === 'flush') {
      sendEncodedChunk(message.id, encoder.flush());
      self.postMessage({ type: 'done', id: message.id });
      encoder = null;
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: message.id, error: error?.message || 'Không mã hóa được MP3.' });
  }
});
