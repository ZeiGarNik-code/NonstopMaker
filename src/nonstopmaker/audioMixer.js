import { extractWaveform } from './waveform.js';
import {
  bassSwapGains,
  beatOffset,
  estimateDownbeat,
  foldTempo,
  mixBands,
  onsetEnvelope,
  planTempoSync,
  resampleLinear,
  resolveCueWindow,
  snapToBar,
  splitBands,
} from './djDsp.js';

const MAX_SOURCE_FILE_BYTES = 120 * 1024 * 1024;
const MAX_TRACK_SECONDS = 15 * 60;
const MAX_MIX_SECONDS = 120 * 60;
const ENCODER_CHUNK_SECONDS = 8;

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Đã hủy render.', 'AbortError');
}

function createRenderContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Trình duyệt này không hỗ trợ giải mã audio để render.');
  try {
    return new AudioContextClass({ sampleRate: 44100 });
  } catch {
    return new AudioContextClass();
  }
}

function createMp3Encoder(sampleRate, bitrate, signal) {
  const worker = new Worker(new URL('./workers/mp3Encoder.worker.js', import.meta.url), { type: 'module' });
  const chunks = [];
  const pending = new Map();
  let nextId = 0;
  let initResolve;
  let initReject;
  let disposed = false;
  const ready = new Promise((resolve, reject) => {
    initResolve = resolve;
    initReject = reject;
  });

  function rejectPending(error) {
    initReject?.(error);
    for (const item of pending.values()) item.reject(error);
    pending.clear();
  }

  const onAbort = () => {
    disposed = true;
    worker.terminate();
    rejectPending(new DOMException('Đã hủy render.', 'AbortError'));
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  worker.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === 'ready') {
      initResolve();
    } else if (message.type === 'chunk') {
      chunks.push(message.buffer);
    } else if (message.type === 'done') {
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        request.resolve();
      }
    } else if (message.type === 'error') {
      const error = new Error(message.error || 'MP3 encoder gặp lỗi.');
      if (message.id && pending.has(message.id)) {
        pending.get(message.id).reject(error);
        pending.delete(message.id);
      } else {
        initReject(error);
      }
    }
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Không thể khởi chạy MP3 encoder.');
    initReject(error);
    rejectPending(error);
  };
  worker.postMessage({ type: 'init', sampleRate, bitrate });

  function request(type, left, right) {
    if (disposed) return Promise.reject(new DOMException('Render đã dừng.', 'AbortError'));
    throwIfAborted(signal);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      if (type === 'encode') {
        const leftCopy = left.slice();
        const rightCopy = right.slice();
        worker.postMessage({ type, id, left: leftCopy.buffer, right: rightCopy.buffer }, [leftCopy.buffer, rightCopy.buffer]);
      } else {
        worker.postMessage({ type, id });
      }
    });
  }

  return {
    ready,
    encode: (left, right) => request('encode', left, right),
    flush: () => request('flush'),
    chunks,
    dispose() {
      if (disposed) return;
      disposed = true;
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    },
  };
}

export function mixOverlap(outLeft, outRight, inLeft, inRight, count) {
  const left = new Float32Array(count);
  const right = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const amount = (index + 0.5) / count;
    const outgoing = Math.cos(amount * Math.PI * 0.5);
    const incoming = Math.sin(amount * Math.PI * 0.5);
    left[index] = Math.max(-1, Math.min(1, outLeft[index] * outgoing + inLeft[index] * incoming));
    right[index] = Math.max(-1, Math.min(1, outRight[index] * outgoing + inRight[index] * incoming));
  }
  return { left, right };
}

export function getTransitionFrames(outgoing, incoming, seconds, sampleRate, alignFadeToBpm, beatsPerBar = 0) {
  let fadeSeconds = Math.max(0, Number(seconds) || 0);
  if (alignFadeToBpm) {
    const bpms = [outgoing?.bpm, incoming?.bpm].filter((value) => Number.isFinite(value) && value >= 50 && value <= 220);
    if (bpms.length) {
      const bpm = bpms.reduce((sum, value) => sum + value, 0) / bpms.length;
      // beatsPerBar = 4 rounds the fade to whole bars (musical phrases);
      // 0 rounds to single beats, which is the older behaviour.
      const unit = beatsPerBar >= 4 ? 4 : 1;
      const unitCount = Math.max(1, Math.round(fadeSeconds * bpm / 60 / unit));
      fadeSeconds = unitCount * unit * 60 / bpm;
    }
  }
  return Math.round(fadeSeconds * sampleRate);
}

export function normalizeChannels(left, right) {
  const stride = Math.max(1, Math.floor(left.length / 50000));
  let power = 0;
  let peak = 0;
  let count = 0;
  for (let index = 0; index < left.length; index += stride) {
    const l = left[index];
    const r = right[index];
    power += l * l + r * r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    count += 2;
  }
  const rms = Math.sqrt(power / Math.max(1, count));
  if (rms < 0.0005) return 1;
  let gain = Math.max(0.45, Math.min(2.8, 0.17 / rms));
  if (peak > 0) gain = Math.min(gain, 0.96 / peak);
  for (let index = 0; index < left.length; index += 1) {
    left[index] *= gain;
    right[index] *= gain;
  }
  return gain;
}

export async function renderMixToMp3(tracks, {
  crossfadeSeconds = 8,
  bitrate = 192,
  alignFadeToBpm = true,
  normalizeAudio = true,
  bassSwap = true,
  beatAlign = true,
  tempoSync = true,
  tempoSyncLimit = 0.06,
  autoCue = true,
  autoCueBeats = 16,
  signal,
  onProgress,
  onTrackDuration,
  onTrackWaveform,
} = {}) {
  const sources = Array.from(tracks || []);
  if (!sources.length) throw new Error('Chọn ít nhất một bài để render.');
  const missing = sources.find((track) => !track.file);
  if (missing) throw new Error(`“${missing.title}” chưa có tệp audio thật. Bài demo chỉ có metadata.`);
  const oversized = sources.find((track) => track.file.size > MAX_SOURCE_FILE_BYTES);
  if (oversized) throw new Error(`“${oversized.title}” vượt giới hạn 120 MB mỗi bài của bản render trên trình duyệt.`);
  throwIfAborted(signal);

  const context = createRenderContext();
  const sampleRate = context.sampleRate;
  const supportedRates = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);
  if (!supportedRates.has(sampleRate)) {
    await context.close().catch(() => {});
    throw new Error(`Tần số lấy mẫu ${sampleRate} Hz chưa được MP3 encoder hỗ trợ trên thiết bị này.`);
  }

  const encoder = createMp3Encoder(sampleRate, bitrate, signal);
  let previousTail = null;
  let totalDecodedSeconds = 0;
  let totalEncodedFrames = 0;
  let encoderReady = false;
  // Bookkeeping for the mix report returned to the UI (and written to the JSON plan).
  const mixReport = [];
  let previousTrackMeta = null;
  let runningCueOut = 0;

  async function encodePcm(left, right, trackIndex, trackFrameCount) {
    if (!left.length) return;
    const chunkFrames = sampleRate * ENCODER_CHUNK_SECONDS;
    for (let start = 0; start < left.length; start += chunkFrames) {
      throwIfAborted(signal);
      const end = Math.min(left.length, start + chunkFrames);
      await encoder.encode(left.subarray(start, end), right.subarray(start, end));
      totalEncodedFrames += end - start;
      const withinTrack = trackFrameCount > 0 ? (Math.min(end, trackFrameCount) / trackFrameCount) : 0;
      onProgress?.({
        phase: 'encode',
        progress: Math.min(91, Math.round(12 + ((trackIndex + withinTrack) / sources.length) * 75)),
        trackIndex,
        trackCount: sources.length,
      });
    }
  }

  try {
    await encoder.ready;
    encoderReady = true;

    for (let index = 0; index < sources.length; index += 1) {
      throwIfAborted(signal);
      const track = sources[index];
      onProgress?.({ phase: 'decode', progress: Math.round(5 + (index / sources.length) * 74), trackIndex: index, trackCount: sources.length, trackName: track.title });

      let decoded;
      try {
        decoded = await context.decodeAudioData(await track.file.arrayBuffer());
      } catch {
        throw new Error(`Không giải mã được “${track.file.name}”. Thử MP3, WAV, FLAC, M4A hoặc AAC trên trình duyệt Chromium mới.`);
      }
      throwIfAborted(signal);
      if (decoded.duration > MAX_TRACK_SECONDS) throw new Error(`“${track.title}” dài hơn 15 phút; hãy cắt bài trước để tránh thiếu bộ nhớ.`);
      totalDecodedSeconds += decoded.duration;
      if (totalDecodedSeconds > MAX_MIX_SECONDS) throw new Error('Set vượt giới hạn render 120 phút của trình duyệt. Hãy chia thành các set ngắn hơn.');
      onTrackDuration?.(track.id, decoded.duration, decoded.sampleRate);
      onTrackWaveform?.(track.id, extractWaveform(decoded));

      const decodedLeft = decoded.getChannelData(0);
      let decodedRight = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : decodedLeft;
      if (decodedRight === decodedLeft) decodedRight = decodedLeft.slice();

      // ---- Cue window -------------------------------------------------
      const cue = resolveCueWindow(track, decoded.duration, decoded.length);
      let left = decodedLeft.subarray(cue.startFrames, cue.endFrames);
      let right = decodedRight.subarray(cue.startFrames, cue.endFrames);
      let effectiveSampleRate = sampleRate;

      // ---- Tempo sync (pitch/tempo shift) ------------------------------
      const incomingBpm = Number(track.bpm) > 40 ? Number(track.bpm) : Number.NaN;
      const outgoingBpm = Number(previousTrackMeta?.bpm) > 40 ? Number(previousTrackMeta.bpm) : Number.NaN;
      const tempoPlan = tempoSync && Number.isFinite(outgoingBpm) && Number.isFinite(incomingBpm)
        ? planTempoSync(outgoingBpm, incomingBpm, tempoSyncLimit)
        : { playable: false, ratio: null, withinLimit: false, reason: 'Tempo sync tắt hoặc thiếu BPM' };
      let appliedRatio = 1;
      if (tempoPlan.playable && tempoPlan.withinLimit && Math.abs(tempoPlan.ratio) > 0.0008) {
        // planTempoSync returns how much faster the incoming track already is
        // (+3.2% for 128 against 124), so it must be resampled by the inverse:
        // a longer buffer plays back slower and lands on the outgoing tempo.
        appliedRatio = 1 + tempoPlan.ratio;
        const resampleRatio = 1 / appliedRatio;
        left = resampleLinear(left, resampleRatio);
        right = resampleLinear(right, resampleRatio);
        onProgress?.({ phase: 'tempo', progress: Math.round(10 + (index / sources.length) * 70), trackIndex: index, trackCount: sources.length, ratio: appliedRatio });
      }

      const frameCount = left.length;

      // ---- Beat grid + auto cue (mix-in on a downbeat) ------------------
      let onset = null;
      let grid = null;
      if (beatAlign || autoCue) {
        const analysis = onsetEnvelope(left, effectiveSampleRate);
        onset = analysis;
        if (Number.isFinite(incomingBpm)) {
          grid = estimateDownbeat(analysis.envelope, analysis.frameRate, incomingBpm * appliedRatio);
        }
      }
      if (autoCue && grid) {
        const target = beatOffset(cue.startSeconds, autoCueBeats, incomingBpm * appliedRatio) - cue.startSeconds;
        const snapped = snapToBar(Math.max(0, target), grid, { bars: 1 });
        if (snapped > 0 && snapped < cue.endSeconds - cue.startSeconds - 4) {
          onProgress?.({ phase: 'cue', progress: Math.round(11 + (index / sources.length) * 70), trackIndex: index, trackCount: sources.length, cueIn: cue.startSeconds + snapped });
        }
      }

      if (normalizeAudio) {
        const gain = normalizeChannels(left, right);
        onProgress?.({ phase: 'normalize', progress: Math.round(8 + (index / sources.length) * 72), trackIndex: index, trackCount: sources.length, gain });
      }

      // ---- Transition length ------------------------------------------
      const beatAlignedFade = beatAlign ? 1 : 0;
      let fadeInFrames = index > 0
        ? getTransitionFrames(sources[index - 1], track, crossfadeSeconds, sampleRate, alignFadeToBpm, beatAlignedFade)
        : 0;
      let fadeOutFrames = index < sources.length - 1
        ? getTransitionFrames(track, sources[index + 1], crossfadeSeconds, sampleRate, alignFadeToBpm, beatAlignedFade)
        : 0;
      if (beatAlign && grid) {
        fadeInFrames = Math.round(snapToBar(fadeInFrames / sampleRate, grid, { bars: 1 }) * sampleRate) || fadeInFrames;
      }

      // ---- EQ bands for the bass swap ---------------------------------
      const needsBands = bassSwap && (index > 0 || index < sources.length - 1);
      const bands = needsBands ? splitBands(left, right, effectiveSampleRate, {}) : null;

      const entry = {
        id: track.id,
        title: track.title,
        bpm: Number.isFinite(incomingBpm) && incomingBpm > 40 ? Math.round(incomingBpm * 10) / 10 : null,
        targetBpm: Number.isFinite(outgoingBpm) && tempoPlan.withinLimit ? Math.round(foldTempo(outgoingBpm, incomingBpm) * 10) / 10 : null,
        tempoRatio: appliedRatio === 1 ? null : Math.round((appliedRatio - 1) * 10000) / 10000,
        tempoSynced: appliedRatio !== 1,
        tempoOutOfRange: Boolean(tempoPlan.playable && tempoPlan.outOfRange),
        tempoReason: tempoPlan.reason || null,
        cueIn: Math.round(cue.startSeconds * 100) / 100,
        cueOut: Math.round(cue.endSeconds * 100) / 100,
        cueSource: (Number(track.cueIn) > 0 || Number(track.cueOut) > 0) ? 'manual' : 'auto',
        beatAligned: Boolean(beatAlign && grid),
        downbeatSeconds: grid ? Math.round(grid.firstBeatSeconds * 1000) / 1000 : null,
        bassSwap: Boolean(bassSwap && index > 0),
        durationAfterCue: Math.round((cue.endSeconds - cue.startSeconds) * 100) / 100,
      };
      mixReport.push(entry);

      let bodyStart = 0;

      if (previousTail) {
        const overlap = Math.min(fadeInFrames, previousTail.left.length, frameCount);
        if (overlap > 0) {
          const prefixLength = previousTail.left.length - overlap;
          await encodePcm(previousTail.left.subarray(0, prefixLength), previousTail.right.subarray(0, prefixLength), index, frameCount);
          const gains = bassSwapGains(overlap, {});
          const mixed = bands
            ? mixBands({
              outLow: previousTail.bands.lowLeft.subarray(prefixLength, prefixLength + overlap),
              outMid: previousTail.bands.midLeft.subarray(prefixLength, prefixLength + overlap),
              outHigh: previousTail.bands.highLeft.subarray(prefixLength, prefixLength + overlap),
              outRightLow: previousTail.bands.lowRight.subarray(prefixLength, prefixLength + overlap),
              outRightMid: previousTail.bands.midRight.subarray(prefixLength, prefixLength + overlap),
              outRightHigh: previousTail.bands.highRight.subarray(prefixLength, prefixLength + overlap),
              inLow: bands.lowLeft.subarray(0, overlap),
              inMid: bands.midLeft.subarray(0, overlap),
              inHigh: bands.highLeft.subarray(0, overlap),
              inRightLow: bands.lowRight.subarray(0, overlap),
              inRightMid: bands.midRight.subarray(0, overlap),
              inRightHigh: bands.highRight.subarray(0, overlap),
              gains,
              count: overlap,
              bassSwap,
            })
            : (() => {
              const plain = mixOverlap(
                previousTail.left.subarray(prefixLength, prefixLength + overlap),
                previousTail.right.subarray(prefixLength, prefixLength + overlap),
                left.subarray(0, overlap),
                right.subarray(0, overlap),
                overlap,
              );
              return plain;
            })();
          await encodePcm(mixed.left, mixed.right, index, frameCount);
          bodyStart = overlap;
        } else {
          await encodePcm(previousTail.left, previousTail.right, index, frameCount);
        }
        previousTail = null;
      }

      if (index < sources.length - 1) {
        const remainingFrames = Math.max(0, frameCount - bodyStart);
        const tailFrames = Math.min(fadeOutFrames, remainingFrames);
        const bodyEnd = frameCount - tailFrames;
        await encodePcm(left.subarray(bodyStart, bodyEnd), right.subarray(bodyStart, bodyEnd), index, frameCount);
        if (tailFrames > 0) {
          previousTail = {
            left: left.slice(bodyEnd),
            right: right.slice(bodyEnd),
            bands: bands
              ? {
                lowLeft: bands.lowLeft.slice(bodyEnd),
                midLeft: bands.midLeft.slice(bodyEnd),
                highLeft: bands.highLeft.slice(bodyEnd),
                lowRight: bands.lowRight.slice(bodyEnd),
                midRight: bands.midRight.slice(bodyEnd),
                highRight: bands.highRight.slice(bodyEnd),
              }
              : null,
          };
        }
      } else {
        await encodePcm(left.subarray(bodyStart), right.subarray(bodyStart), index, frameCount);
      }

      previousTrackMeta = { bpm: incomingBpm * appliedRatio };
      runningCueOut += cue.endSeconds - cue.startSeconds;
      decoded = null;
      onProgress?.({ phase: 'track-done', progress: Math.round(12 + ((index + 1) / sources.length) * 78), trackIndex: index, trackCount: sources.length });
    }

    throwIfAborted(signal);
    onProgress?.({ phase: 'flush', progress: 94, trackIndex: sources.length, trackCount: sources.length });
    await encoder.flush();
    const blob = new Blob(encoder.chunks, { type: 'audio/mpeg' });
    if (!blob.size) throw new Error('MP3 encoder không tạo được dữ liệu.');
    onProgress?.({ phase: 'done', progress: 100, totalFrames: totalEncodedFrames, duration: totalDecodedSeconds });
    return {
      blob,
      duration: totalEncodedFrames / sampleRate,
      decodedDuration: totalDecodedSeconds,
      sampleRate,
      bitrate,
      mixReport,
      cueWindowSeconds: runningCueOut,
    };
  } finally {
    encoder.dispose();
    if (context.state !== 'closed') await context.close().catch(() => {});
    if (!encoderReady) encoder.chunks.length = 0;
  }
}
