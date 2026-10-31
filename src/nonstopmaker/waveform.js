export function extractWaveform(audioBuffer, bucketCount = 112, samplesPerBucket = 64) {
  if (!audioBuffer || !Number.isInteger(audioBuffer.length) || audioBuffer.length < 1 || bucketCount < 1) return null;
  const leftChannel = audioBuffer.getChannelData(0);
  const rightChannel = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : leftChannel;
  const left = new Uint8Array(bucketCount);
  const right = new Uint8Array(bucketCount);

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * audioBuffer.length / bucketCount);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * audioBuffer.length / bucketCount));
    const stride = Math.max(1, Math.floor((end - start) / samplesPerBucket));
    let leftPeak = 0;
    let rightPeak = 0;
    for (let index = start; index < end; index += stride) {
      leftPeak = Math.max(leftPeak, Math.abs(leftChannel[index] || 0));
      rightPeak = Math.max(rightPeak, Math.abs(rightChannel[index] || 0));
    }
    left[bucket] = Math.round(Math.min(1, leftPeak) * 255);
    right[bucket] = Math.round(Math.min(1, rightPeak) * 255);
  }

  return { left, right };
}
