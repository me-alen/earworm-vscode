import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseState, volumeToSend } from '../src/macos';

const S = '\x1f';

test('not running', () => {
  assert.deepEqual(parseState('not running'), { kind: 'notRunning' });
});

test('playing with a track', () => {
  assert.deepEqual(parseState(['playing', 'Song, Pt. 2', 'Artist', 'Album', '225000', '42'].join(S)), {
    kind: 'running', playing: true, track: { name: 'Song, Pt. 2', artist: 'Artist', album: 'Album' },
    progress: { position: 42, duration: 225 },
  });
});

test('track names keep newlines and tabs', () => {
  const s = parseState(['paused', 'Line\nTwo\tTab', 'A', 'B', '1000', '0'].join(S));
  assert.equal(s.kind === 'running' && s.track?.name, 'Line\nTwo\tTab');
  assert.equal(s.kind === 'running' && s.playing, false);
});

test('stopped has no track', () => {
  assert.deepEqual(parseState('stopped'), { kind: 'running', playing: false, track: undefined });
});

test('volume is clamped and offset for the Spotify off-by-one', () => {
  assert.equal(volumeToSend(55), 56);
  assert.equal(volumeToSend(0), 0);
  assert.equal(volumeToSend(-20), 0);
  assert.equal(volumeToSend(100), 100);
  assert.equal(volumeToSend(140), 100);
});

test('rejects malformed output', () => {
  assert.throws(() => parseState(''));
  assert.throws(() => parseState('weird'));
  assert.throws(() => parseState(['playing', 'only name'].join(S)));
});

test('an ad or stream without a length has no progress', () => {
  const s = parseState(['playing', 'Ad', '', '', '0', '3'].join(S));
  assert.equal(s.kind === 'running' && s.progress, undefined);
});
