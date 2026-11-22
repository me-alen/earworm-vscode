// Controls the Spotify desktop app on Linux.
// Playback and track info go over MPRIS (D-Bus) through `busctl`, whose JSON output is safe
// to parse (`dbus-send` prints strings unescaped). Spotify's Linux app ignores MPRIS volume,
// so volume goes through `pactl`, which works on both PulseAudio and PipeWire.
import { execFile, spawn } from 'node:child_process';
import { NotRunningError, PlayerState, withProgress } from './common';

const DEST = 'org.mpris.MediaPlayer2.spotify';
const PATH = '/org/mpris/MediaPlayer2';
const IFACE = 'org.mpris.MediaPlayer2.Player';

const INSTALL_HINT: Record<string, string> = {
  busctl: 'It ships with systemd.',
  pactl: 'Install pulseaudio-utils (Debian/Ubuntu), pulseaudio-utils or pipewire-pulseaudio (Fedora), or libpulse (Arch).',
};

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reject(new Error(`Earworm needs \`${cmd}\` on Linux. ${INSTALL_HINT[cmd] ?? ''}`));
      }
      reject(new Error(stderr.trim() || `${cmd} failed.`));
    });
  });
}

const busctl = (...args: string[]) => run('busctl', ['--user', '--json=short', ...args]);

async function isRunning(): Promise<boolean> {
  const out = await busctl('call', 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner', 's', DEST);
  return JSON.parse(out).data[0] === true;
}

// Turns a failure into NotRunningError when the cause is that Spotify is not on the bus.
async function mpris<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(await isRunning())) throw new NotRunningError();
    throw err;
  }
}

/** Parses `busctl --json=short get-property … PlaybackStatus Metadata Position`: one JSON value per line. Times are in µs. */
export function parseState(out: string): PlayerState {
  const [status, meta, position] = out.trim().split('\n').map(line => JSON.parse(line));
  const s = status?.data;
  if (!['Playing', 'Paused', 'Stopped'].includes(s) || meta?.type !== 'a{sv}') {
    throw new Error(`Unexpected reply from Spotify: ${JSON.stringify(out)}`);
  }
  const m = meta.data;
  const name: string | undefined = m['xesam:title']?.data;
  if (s === 'Stopped' || !name) return { kind: 'running', playing: s === 'Playing', track: undefined };
  return {
    kind: 'running',
    playing: s === 'Playing',
    track: { name, artist: (m['xesam:artist']?.data ?? []).join(', '), album: m['xesam:album']?.data ?? '' },
    ...withProgress(Number(position?.data) / 1e6, Number(m['mpris:length']?.data) / 1e6),
  };
}

export async function getState(): Promise<PlayerState> {
  try {
    return parseState(await busctl('get-property', DEST, PATH, IFACE, 'PlaybackStatus', 'Metadata', 'Position'));
  } catch (err) {
    if (!(await isRunning())) return { kind: 'notRunning' };
    throw err;
  }
}

const call = (method: string) => mpris(() => busctl('call', DEST, PATH, IFACE, method));
export const playPause = () => call('PlayPause');
export const next = () => call('Next');
export const previous = () => call('Previous');

// Spotify's Linux app has long refused MPRIS shuffle/repeat writes. Try anyway, then read back
// so the user gets a clear message instead of a silent no-op.
async function toggle(prop: 'Shuffle' | 'LoopStatus', signature: string, flip: (v: unknown) => string) {
  const read = async () => JSON.parse(await busctl('get-property', DEST, PATH, IFACE, prop)).data;
  const before = await mpris(read);
  await busctl('set-property', DEST, PATH, IFACE, prop, signature, flip(before)).catch(() => undefined);
  await new Promise(r => setTimeout(r, 200));
  if ((await read()) === before) {
    throw new Error(`Spotify's Linux app does not let other apps change ${prop === 'Shuffle' ? 'shuffle' : 'repeat'}. Use the Spotify window.`);
  }
}
export const toggleShuffle = () => toggle('Shuffle', 'b', v => String(!v));
export const toggleRepeat = () => toggle('LoopStatus', 's', v => (v === 'None' ? 'Playlist' : 'None'));

interface SinkInput {
  index: number;
  properties?: Record<string, string>;
  volume?: Record<string, { value_percent?: string }>;
}

/** Finds Spotify's audio stream in `pactl -f json list sink-inputs` output. */
export function findSpotifyStream(list: SinkInput[]): { index: number; volume: number } | undefined {
  const s = list.find(i => /spotify/i.test(i.properties?.['application.name'] ?? '')
    || /spotify/i.test(i.properties?.['application.process.binary'] ?? ''));
  if (!s) return undefined;
  const firstChannel = Object.values(s.volume ?? {})[0];
  return { index: s.index, volume: parseInt(firstChannel?.value_percent ?? '', 10) };
}

async function spotifyStream() {
  const stream = findSpotifyStream(JSON.parse(await run('pactl', ['-f', 'json', 'list', 'sink-inputs'])));
  if (stream) return stream;
  if (!(await isRunning())) throw new NotRunningError();
  throw new Error('Spotify has no audio stream right now. Start playback, then try again.');
}

export async function getVolume(): Promise<number> {
  return (await spotifyStream()).volume;
}

export async function setVolume(v: number): Promise<void> {
  const { index } = await spotifyStream();
  await run('pactl', ['set-sink-input-volume', String(index), `${Math.round(Math.min(100, Math.max(0, v)))}%`]);
}

// Native/snap installs put `spotify` on PATH; Flatpak does not.
export function open(): Promise<void> {
  const launch = (cmd: string, args: string[]) => new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    p.once('error', reject);
    p.once('spawn', () => { p.unref(); resolve(); });
  });
  return launch('spotify', [])
    .catch(() => launch('flatpak', ['run', 'com.spotify.Client']))
    .catch(() => { throw new Error('Could not start Spotify. Is it installed?'); });
}
