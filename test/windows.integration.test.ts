// Drives src/windows.ts and scripts/windows-host.ps1 for real, against test/fake-spotify.ps1.
// Runs only in CI (see .github/workflows/ci.yml), on a Windows runner.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as windows from '../src/windows';
import { NotRunningError, PlayerState } from '../src/common';

const enabled = process.env.EARWORM_WINDOWS_IT === '1';
const skip = !enabled && 'set EARWORM_WINDOWS_IT=1 (CI only)';
after(() => windows.dispose());

async function waitFor(check: () => Promise<boolean>, what: string) {
  for (let i = 0; i < 150; i++) {
    if (await check().catch(() => false)) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const trackName = (s: PlayerState) => (s.kind === 'running' ? s.track?.name : undefined);

test('Windows backend without Spotify', { skip }, async () => {
  assert.deepEqual(await windows.getState(), { kind: 'notRunning' });
  await assert.rejects(windows.playPause(), NotRunningError);
  // Also compiles the volume code, so a C# mistake fails here.
  await assert.rejects(windows.getVolume(), NotRunningError);
});

test('Windows backend against a fake Spotify', { skip }, async t => {
  const exe = path.join(mkdtempSync(path.join(os.tmpdir(), 'earworm-')), 'Spotify.exe');
  copyFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), exe);
  // Source path, not out/: tsc does not copy .ps1 files.
  const fake = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../../test/fake-spotify.ps1')], { stdio: 'inherit' });
  t.after(() => { fake.kill(); });

  await waitFor(async () => trackName(await windows.getState()) !== undefined, 'the fake Spotify in media controls');
  assert.deepEqual(await windows.getState(), {
    kind: 'running', playing: false, track: { name: 'Say "Hi"', artist: 'Artist A, Artist B', album: 'Album One' },
  });

  await windows.playPause();
  await waitFor(async () => { const s = await windows.getState(); return s.kind === 'running' && s.playing; }, 'playing');
  await windows.next();
  await waitFor(async () => trackName(await windows.getState()) === 'Second', 'the next track');
  await windows.previous();
  await waitFor(async () => trackName(await windows.getState()) === 'Say "Hi"', 'the previous track');

  // Whether Spotify accepts these is up to Spotify; either way the call must not break.
  await windows.toggleShuffle().catch(err => assert.match(err.message, /change shuffle/));
  await windows.toggleRepeat().catch(err => assert.match(err.message, /change repeat/));

  // The fake plays no audio, so it has no entry in the volume mixer.
  await assert.rejects(windows.getVolume(), /no audio stream/);
  await assert.rejects(windows.setVolume(30), /no audio stream/);

  fake.kill();
  await waitFor(async () => (await windows.getState()).kind === 'notRunning', 'Spotify to quit');
});
