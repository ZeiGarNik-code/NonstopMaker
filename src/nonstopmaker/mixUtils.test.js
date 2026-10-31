import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arrangeTracksByCompatibility,
  buildM3U,
  buildMixPlan,
  formatTime,
  isAudioFile,
  makeImportedTracks,
  sumTrackDuration,
} from './mixUtils.js';

test('formatTime formats minutes and hours without changing source values', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(93), '01:33');
  assert.equal(formatTime(3723), '1:02:03');
  assert.equal(formatTime(undefined), '--:--');
});

test('audio filtering accepts known audio MIME types and common extensions', () => {
  assert.equal(isAudioFile({ name: 'mix.mp3', type: '' }), true);
  assert.equal(isAudioFile({ name: 'voice.bin', type: 'audio/mpeg' }), true);
  assert.equal(isAudioFile({ name: 'cover.jpg', type: 'image/jpeg' }), false);
});

test('imported audio is represented by lightweight local file metadata', () => {
  const tracks = makeImportedTracks([
    { name: 'song_one.mp3', type: 'audio/mpeg', webkitRelativePath: 'Music/song_one.mp3' },
    { name: 'album.jpg', type: 'image/jpeg' },
  ]);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].title, 'song one');
  assert.equal(tracks[0].relativePath, 'Music/song_one.mp3');
  assert.equal(tracks[0].duration, 0);
  assert.equal(sumTrackDuration([{ duration: 100 }, { duration: 60 }]), 160);
});

test('M3U and mix-plan exports contain only playlist metadata', () => {
  const tracks = [{ title: 'Demo Track', artist: 'Demo', duration: 90, relativePath: 'Music/demo.mp3' }];
  const playlist = buildM3U(tracks, 'My Set');
  const plan = buildMixPlan(tracks, { targetMinutes: 30, mood: 'sung' });
  assert.match(playlist, /#PLAYLIST:My Set/);
  assert.match(playlist, /Music\/demo\.mp3/);
  assert.equal(plan.settings.targetMinutes, 30);
  assert.equal(plan.tracks[0].durationSeconds, 90);
  assert.match(plan.note, /MP3 được trộn và mã hóa cục bộ/);
  assert.equal(plan.tracks[0].analysisConfidence, null);
});

test('compatibility ordering uses BPM, Camelot key, and energy while keeping unselected tracks last', () => {
  const tracks = [
    { id: 'peak', selected: true, bpm: 140, camelot: '8A', energy: 6 },
    { id: 'soft', selected: true, bpm: 122, camelot: '8A', energy: 2 },
    { id: 'middle', selected: true, bpm: 123, camelot: '9A', energy: 3 },
    { id: 'outside', selected: false, bpm: 124, camelot: '9A', energy: 1 },
  ];
  const arranged = arrangeTracksByCompatibility(tracks);
  assert.deepEqual(arranged.map((track) => track.id), ['soft', 'middle', 'peak', 'outside']);
});
