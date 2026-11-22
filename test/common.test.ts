import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotRunningError, Player, PlayerState, progressText, WebApiUnavailableError, withFallback } from '../src/common';

test('progress bar text', () => {
  assert.deepEqual(progressText(83, 225), { text: '1:23 ━━━━────── 3:45', label: '1:23 of 3:45' });
  assert.equal(progressText(0, 59.9).text, '0:00 ────────── 0:59');
  assert.equal(progressText(3725, 3725).text, '62:05 ━━━━━━━━━━ 62:05');
});

function fakePlayer(name: string, calls: string[], fail?: () => Error, state: PlayerState = { kind: 'running', playing: true }): Player {
  return new Proxy({} as Player, {
    get: (_, method) => async (...args: unknown[]) => {
      calls.push(`${name}.${String(method)}(${args.join(',')})`);
      if (fail) throw fail();
      return method === 'getState' ? state : 'ok';
    },
  });
}

test('withFallback uses the local app only when the Web API cannot be used', async () => {
  const calls: string[] = [];
  const told: string[] = [];
  const quota = () => new WebApiUnavailableError('Quota used up.', 'quota');
  const p = withFallback(fakePlayer('web', calls, quota), fakePlayer('local', calls), e => told.push(e.reason));
  await p.setVolume(30);
  assert.deepEqual(await p.getState(), { kind: 'running', playing: true });
  assert.deepEqual(calls, ['web.setVolume(30)', 'local.setVolume(30)', 'web.getState()', 'local.getState()']);
  assert.deepEqual(told, ['quota', 'quota']);

  // Other Web API errors are not hidden.
  const other = withFallback(fakePlayer('web', [], () => new Error('Bad request')), fakePlayer('local', []), () => undefined);
  await assert.rejects(other.next(), /Bad request/);
});

test('withFallback reports the Web API problem when the local app is not running either', async () => {
  const offline = () => new WebApiUnavailableError('Could not reach Spotify.', 'offline');
  const p = withFallback(fakePlayer('web', [], offline), fakePlayer('local', [], () => new NotRunningError(), { kind: 'notRunning' }), () => undefined);
  await assert.rejects(p.next(), /Could not reach Spotify/);
  const q = withFallback(fakePlayer('web', [], offline), fakePlayer('local', [], undefined, { kind: 'notRunning' }), () => undefined);
  await assert.rejects(q.getState(), /Could not reach Spotify/);
});
