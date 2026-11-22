// Drives src/linux.ts through the real busctl and pactl, against test/fake-spotify.py.
// Runs only in CI (see .github/workflows/ci.yml), which provides D-Bus and PulseAudio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as linux from '../src/linux';
import { NotRunningError } from '../src/common';

const enabled = process.env.EARWORM_LINUX_IT === '1';

async function waitFor(check: () => Promise<boolean>, what: string) {
  for (let i = 0; i < 50; i++) {
    if (await check().catch(() => false)) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

test('Linux backend against a fake Spotify', { skip: !enabled && 'set EARWORM_LINUX_IT=1 (CI only)' }, async t => {
  assert.deepEqual(await linux.getState(), { kind: 'notRunning' });
  await assert.rejects(linux.playPause(), NotRunningError);

  // Source path, not out/: tsc does not copy .py files.
  const fake = spawn('python3', [path.join(__dirname, '../../test/fake-spotify.py')], { stdio: 'inherit' });
  const audio = spawn('sh', ['-c', 'exec pacat --playback --client-name=spotify --property=application.name=spotify < /dev/zero'], { stdio: 'inherit' });
  t.after(() => { fake.kill(); audio.kill(); });

  await waitFor(async () => (await linux.getState()).kind === 'running', 'the fake Spotify on D-Bus');
  assert.deepEqual(await linux.getState(), {
    kind: 'running', playing: false, track: { name: 'Say "Hi"', artist: 'Artist A, Artist B', album: 'Album One' },
    progress: { position: 42, duration: 225 },
  });

  await linux.playPause();
  const playing = await linux.getState();
  assert.equal(playing.kind === 'running' && playing.playing, true);

  await linux.next();
  const second = await linux.getState();
  assert.equal(second.kind === 'running' && second.track?.name, 'Second');
  await linux.previous();

  await waitFor(async () => (await linux.getVolume()) >= 0, 'the fake audio stream in pactl');
  await linux.setVolume(30);
  assert.equal(await linux.getVolume(), 30);
  await linux.setVolume(150);
  assert.equal(await linux.getVolume(), 100);

  await assert.rejects(linux.toggleShuffle(), /change shuffle/);
  await assert.rejects(linux.toggleRepeat(), /change repeat/);

  fake.kill();
  await waitFor(async () => (await linux.getState()).kind === 'notRunning', 'Spotify to leave the bus');
});
