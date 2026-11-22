// Controls the Spotify desktop app on macOS through its AppleScript dictionary.
// Kept free of the `vscode` module so the parser can be unit-tested with plain Node.
import { execFile } from 'node:child_process';
import { NotRunningError, PlayerState, withProgress } from './common';

export class PermissionError extends Error {
  constructor() {
    super('VS Code is not allowed to control Spotify. Allow it in System Settings → Privacy & Security → Automation.');
  }
}

const NOT_RUNNING = 'not running';
// Unit separator: cannot appear in track metadata, unlike newlines or tabs.
const SEP = '\x1f';

// Every script checks `is running` first: a bare `tell application "Spotify"` would launch it.
function guarded(body: string): string {
  return `if application "Spotify" is running then
  tell application "Spotify"
    ${body}
  end tell
end if
return "${NOT_RUNNING}"`;
}

const STATE_SCRIPT = guarded(`set s to character id 31
    set out to (player state as string)
    if player state is not stopped then
      set t to current track
      -- whole seconds: "as string" on a real uses the locale's decimal separator
      set pos to player position
      set out to out & s & (name of t) & s & (artist of t) & s & (album of t) & s & ((duration of t) as string) & s & ((round pos) as string)
    end if
    return out`);

export function parseState(out: string): PlayerState {
  if (out === NOT_RUNNING) return { kind: 'notRunning' };
  const parts = out.split(SEP);
  if (!['playing', 'paused', 'stopped'].includes(parts[0]) || (parts.length !== 1 && parts.length !== 6)) {
    throw new Error(`Unexpected reply from Spotify: ${JSON.stringify(out)}`);
  }
  const [state, name, artist, album, durationMs, position] = parts;
  if (name === undefined) return { kind: 'running', playing: state === 'playing', track: undefined };
  return { kind: 'running', playing: state === 'playing', track: { name, artist, album }, ...withProgress(Number(position), Number(durationMs) / 1000) };
}

function osascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 5000 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout.trim());
      // -1743: the user denied (or has not yet granted) Automation permission.
      if (stderr.includes('-1743')) return reject(new PermissionError());
      // A timeout usually means macOS is still showing the "allow VS Code to control Spotify" prompt.
      if (err.killed) return reject(new Error('Spotify did not respond within 5 seconds. If macOS is asking for permission to control Spotify, allow it.'));
      reject(new Error(stderr.trim() || 'osascript failed.'));
    });
  });
}

export async function getState(): Promise<PlayerState> {
  return parseState(await osascript(STATE_SCRIPT));
}

async function control(body: string): Promise<string> {
  const out = await osascript(guarded(body));
  if (out === NOT_RUNNING) throw new NotRunningError();
  return out;
}

export async function getVolume(): Promise<number> {
  return Number(await control('return sound volume as string'));
}

export const playPause = () => control('playpause\n    return "ok"');
export const next = () => control('next track\n    return "ok"');
export const previous = () => control('previous track\n    return "ok"');
export const toggleShuffle = () => control('set shuffling to not shuffling\n    return "ok"');
export const toggleRepeat = () => control('set repeating to not repeating\n    return "ok"');
// Spotify stores one less than it is given (set 55, read 54), so send one more. 0 stays 0.
export const volumeToSend = (v: number) => {
  const target = Math.round(Math.min(100, Math.max(0, v)));
  return target === 0 ? 0 : Math.min(100, target + 1);
};
export const setVolume = (v: number) => control(`set sound volume to ${volumeToSend(v)}\n    return "ok"`);
export const open = () => osascript('tell application "Spotify" to activate').then(() => undefined);
