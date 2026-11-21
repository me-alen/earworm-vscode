import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReply, parseState } from '../src/windows';
import { NotRunningError } from '../src/common';

test('not running', () => {
  assert.deepEqual(parseState({ session: false, process: false }), { kind: 'notRunning' });
});

test('open but not yet in media controls', () => {
  assert.deepEqual(parseState({ session: false, process: true }), { kind: 'running', playing: false });
});

test('playing', () => {
  assert.deepEqual(
    parseState({ session: true, status: 'Playing', title: 'Say "Hi"\nNow', artist: 'A, B', album: 'Alb' }),
    { kind: 'running', playing: true, track: { name: 'Say "Hi"\nNow', artist: 'A, B', album: 'Alb' } },
  );
});

test('paused with no artist or album', () => {
  assert.deepEqual(
    parseState({ session: true, status: 'Paused', title: 'Ad', artist: '', album: '' }),
    { kind: 'running', playing: false, track: { name: 'Ad', artist: '', album: '' } },
  );
});

test('stopped or empty title means no track', () => {
  assert.deepEqual(parseState({ session: true, status: 'Stopped', title: 'Old' }), { kind: 'running', playing: false, track: undefined });
  assert.deepEqual(parseState({ session: true, status: 'Playing', title: '' }), { kind: 'running', playing: true, track: undefined });
});

test('helper replies', () => {
  assert.equal(parseReply('{"ok":true,"value":42}'), 42);
  assert.equal(parseReply('{"ok":true,"value":null}'), null);
  assert.throws(() => parseReply('{"ok":false,"error":"NOT_RUNNING"}'), NotRunningError);
  assert.throws(() => parseReply('{"ok":false,"error":"Spotify has no audio stream right now."}'), /no audio stream/);
  assert.throws(() => parseReply('not json'), SyntaxError);
});
