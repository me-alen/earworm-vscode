import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseState, findSpotifyStream } from '../src/linux';

const line = (v: unknown) => JSON.stringify(v);
const meta = (data: Record<string, unknown>) => line({ type: 'a{sv}', data });

test('playing with several artists', () => {
  const out = [
    line({ type: 's', data: 'Playing' }),
    meta({
      'xesam:title': { type: 's', data: 'Say "Hi"\nNow' },
      'xesam:artist': { type: 'as', data: ['A', 'B'] },
      'xesam:album': { type: 's', data: 'Alb' },
    }),
  ].join('\n') + '\n';
  assert.deepEqual(parseState(out), {
    kind: 'running', playing: true, track: { name: 'Say "Hi"\nNow', artist: 'A, B', album: 'Alb' },
  });
});

test('paused with missing artist and album', () => {
  const out = [line({ type: 's', data: 'Paused' }), meta({ 'xesam:title': { type: 's', data: 'T' } })].join('\n');
  assert.deepEqual(parseState(out), { kind: 'running', playing: false, track: { name: 'T', artist: '', album: '' } });
});

test('stopped or empty metadata has no track', () => {
  assert.deepEqual(parseState([line({ type: 's', data: 'Stopped' }), meta({})].join('\n')),
    { kind: 'running', playing: false, track: undefined });
  assert.deepEqual(parseState([line({ type: 's', data: 'Playing' }), meta({})].join('\n')),
    { kind: 'running', playing: true, track: undefined });
});

test('rejects malformed output', () => {
  assert.throws(() => parseState(''));
  assert.throws(() => parseState(line({ type: 's', data: 'Playing' })));
  assert.throws(() => parseState([line({ type: 's', data: 'Weird' }), meta({})].join('\n')));
});

test('finds the Spotify stream by app name or binary', () => {
  const list: Parameters<typeof findSpotifyStream>[0] = [
    { index: 3, properties: { 'application.name': 'Firefox' }, volume: { 'front-left': { value_percent: '100%' } } },
    { index: 7, properties: { 'application.name': 'spotify' }, volume: { 'front-left': { value_percent: '55%' }, 'front-right': { value_percent: '55%' } } },
  ];
  assert.deepEqual(findSpotifyStream(list), { index: 7, volume: 55 });
  assert.deepEqual(findSpotifyStream([{ index: 2, properties: { 'application.process.binary': 'spotify' }, volume: { mono: { value_percent: '30%' } } }]),
    { index: 2, volume: 30 });
  assert.equal(findSpotifyStream([list[0]]), undefined);
  assert.equal(findSpotifyStream([]), undefined);
});
