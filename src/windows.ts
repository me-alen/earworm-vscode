// Controls the Spotify desktop app on Windows through scripts/windows-host.ps1, a Windows
// PowerShell process started on first use and kept running, so the regular refresh does not
// pay PowerShell's start-up cost each time. One request is in flight at a time.
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { NotRunningError, PlayerState } from './common';

const SCRIPT = path.join(__dirname, '../../scripts/windows-host.ps1');
// Execution policy does not apply to a script block built from a string, so this runs even
// where .ps1 files are blocked.
const BOOT = '& ([scriptblock]::Create([IO.File]::ReadAllText($env:EARWORM_HOST)))';
const TIMEOUT_MS = 10_000; // the first request also waits for PowerShell to start

interface Host { proc: ChildProcessWithoutNullStreams; stderr: string; waiting?: (reply: string | Error) => void }
let host: Host | undefined;
let queue: Promise<unknown> = Promise.resolve();

function start(): Host {
  const proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', BOOT], {
    env: { ...process.env, EARWORM_HOST: SCRIPT },
    windowsHide: true,
  });
  const h: Host = { proc, stderr: '' };
  const settle = (reply: string | Error) => { const w = h.waiting; h.waiting = undefined; w?.(reply); };
  const fail = (err: Error) => { if (host === h) host = undefined; settle(err); };
  readline.createInterface({ input: proc.stdout }).on('line', settle);
  proc.stderr.on('data', d => { h.stderr = (h.stderr + d).slice(-2000); });
  proc.stdin.on('error', () => undefined); // writes after exit; the exit handler reports it
  proc.on('error', err => fail((err as NodeJS.ErrnoException).code === 'ENOENT'
    ? new Error('Earworm needs Windows PowerShell (powershell.exe), which ships with Windows.')
    : err));
  proc.on('exit', () => fail(new Error(h.stderr.trim() || 'The Earworm helper stopped unexpectedly.')));
  return h;
}

/** Turns one reply line from the helper into a value or an error. */
export function parseReply(line: string): unknown {
  const reply = JSON.parse(line) as { ok: boolean; value?: unknown; error?: string };
  if (reply.ok) return reply.value;
  if (reply.error === 'NOT_RUNNING') throw new NotRunningError();
  throw new Error(reply.error || 'The Earworm helper failed.');
}

function request(command: string): Promise<unknown> {
  const send = () => new Promise<unknown>((resolve, reject) => {
    const h = (host ??= start());
    const timer = setTimeout(() => {
      h.waiting = undefined;
      h.proc.kill(); // a stuck helper is replaced on the next request
      reject(new Error('Spotify did not respond within 10 seconds.'));
    }, TIMEOUT_MS);
    h.waiting = reply => {
      clearTimeout(timer);
      if (reply instanceof Error) return reject(reply);
      try { resolve(parseReply(reply)); } catch (err) { reject(err); }
    };
    h.proc.stdin.write(command + '\n');
  });
  const result = queue.then(send, send);
  queue = result.catch(() => undefined);
  return result;
}

interface RawState { session: boolean; process?: boolean; status?: string; title?: string; artist?: string; album?: string }

/** Turns the helper's `state` reply into a PlayerState. */
export function parseState(raw: RawState): PlayerState {
  if (!raw.session) return raw.process ? { kind: 'running', playing: false } : { kind: 'notRunning' };
  return {
    kind: 'running',
    playing: raw.status === 'Playing',
    track: raw.status === 'Stopped' || !raw.title ? undefined : {
      name: raw.title,
      artist: raw.artist ?? '',
      album: raw.album ?? '',
    },
  };
}

export const getState = async () => parseState(await request('state') as RawState);
export const playPause = () => request('playPause');
export const next = () => request('next');
export const previous = () => request('previous');
export const toggleShuffle = () => request('shuffle');
export const toggleRepeat = () => request('repeat');
export const getVolume = async () => await request('getVolume') as number;
export const setVolume = (v: number) => request(`setVolume ${Math.round(Math.min(100, Math.max(0, v)))}`);

// The spotify: link opens both the desktop and the Microsoft Store app.
export function open(): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('explorer.exe', ['spotify:'], { detached: true, stdio: 'ignore' });
    p.once('error', () => reject(new Error('Could not start Spotify. Is it installed?')));
    p.once('spawn', () => { p.unref(); resolve(); });
  });
}

/** Stops the helper; closing its stdin ends its read loop. */
export function dispose() {
  host?.proc.stdin.end();
  host = undefined;
}
