import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseState, volumeToSend } from '../src/macos';

const S = '\x1f';

test('not running', () => {
  assert.deepEqual(parseState('not running'), { kind: 'notRunning' });
});

test('playing with a track', () => {
  assert.deepEqual(parseState(['playing', '64', 'Song, Pt. 2', 'Artist', 'Album'].join(S)), {
    kind: 'running', playing: true, volume: 64,
    track: { name: 'Song, Pt. 2', artist: 'Artist', album: 'Album' },
  });
});

test('track names keep newlines and tabs', () => {
  const s = parseState(['paused', '10', 'Line\nTwo\tTab', 'A', 'B'].join(S));
  assert.equal(s.kind === 'running' && s.track?.name, 'Line\nTwo\tTab');
  assert.equal(s.kind === 'running' && s.playing, false);
});

test('stopped has no track', () => {
  assert.deepEqual(parseState(['stopped', '0'].join(S)), { kind: 'running', playing: false, volume: 0, track: undefined });
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
  assert.throws(() => parseState(['playing', 'abc'].join(S)));
  assert.throws(() => parseState(['weird', '5'].join(S)));
  assert.throws(() => parseState(['playing', '5', 'only name'].join(S)));
});
