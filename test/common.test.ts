import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  feedbackUrl, NotRunningError, Player, PlayerState, progressText, reviewUrl, shouldAskFeedback, statusBarShown,
  WebApiUnavailableError, withFallback,
} from '../src/common';

test('feedback form link fills in the details, spaces as %20', () => {
  const url = feedbackUrl({ earworm: '0.6.0', editor: 'Visual Studio Code 1.106.0', os: 'darwin arm64', mode: 'Spotify Web API' });
  assert.equal(url, 'https://github.com/me-alen/earworm-vscode/issues/new?template=feedback.yml&earworm=0.6.0'
    + '&editor=Visual%20Studio%20Code%201.106.0&os=darwin%20arm64&mode=Spotify%20Web%20API');
});

test('rating goes to the store the editor installs from', () => {
  assert.match(reviewUrl('vscode'), /marketplace\.visualstudio\.com/);
  assert.match(reviewUrl('vscode-insiders'), /marketplace\.visualstudio\.com/);
  for (const other of ['cursor', 'vscodium', 'windsurf']) assert.match(reviewUrl(other), /open-vsx\.org/);
});

test('feedback is asked once, after two weeks and ten songs', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 100 * day;
  assert.equal(shouldAskFeedback({ firstSong: now - 15 * day, songs: 10, asked: false }, now), true);
  assert.equal(shouldAskFeedback({ firstSong: now - 15 * day, songs: 9, asked: false }, now), false, 'too few songs');
  assert.equal(shouldAskFeedback({ firstSong: now - 13 * day, songs: 50, asked: false }, now), false, 'too soon');
  assert.equal(shouldAskFeedback({ firstSong: now - 15 * day, songs: 50, asked: true }, now), false, 'never twice');
});

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

test('status bar items: defaults, user choices, and the old showButtons setting', () => {
  assert.deepEqual(statusBarShown(undefined, undefined), {
    previous: true, playPause: true, next: true, nowPlaying: true, like: true, progress: true, progressWhenPaused: false,
  });
  assert.equal(statusBarShown({ nowPlaying: false }, undefined).nowPlaying, false);
  const legacy = statusBarShown(undefined, false);
  assert.deepEqual([legacy.previous, legacy.playPause, legacy.next, legacy.like, legacy.nowPlaying], [false, false, false, false, true]);
  assert.equal(statusBarShown({ next: true }, false).next, true); // a new choice wins over the old setting
});
