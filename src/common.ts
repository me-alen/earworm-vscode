// Shared by the backends (macos.ts, linux.ts, windows.ts, webapi.ts) and extension.ts.

export interface Track { name: string; artist: string; album: string }

/** Seconds into the track, and its length. */
export interface Progress { position: number; duration: number }

export type PlayerState =
  | { kind: 'notRunning' }
  | { kind: 'running'; playing: boolean; track?: Track; progress?: Progress };

/** Spread into a running state. No length (ads, live streams) means no progress to show. */
export const withProgress = (position: number, duration: number): { progress?: Progress } =>
  duration > 0 && Number.isFinite(position) ? { progress: { position: Math.min(Math.max(position, 0), duration), duration } } : {};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The status bar's progress bar: "1:23 ━━━━────── 3:45". */
export function progressText(position: number, duration: number, cells = 10) {
  const done = Math.round((position / duration) * cells);
  return { text: `${clock(position)} ${'━'.repeat(done)}${'─'.repeat(cells - done)} ${clock(duration)}`, label: `${clock(position)} of ${clock(duration)}` };
}

export class NotRunningError extends Error {
  constructor(message = 'Spotify is not running.') { super(message); }
}

/** The Web API cannot be used right now, but the Spotify app on this computer may still be. */
export class WebApiUnavailableError extends Error {
  constructor(message: string, readonly reason: 'quota' | 'rateLimit' | 'premium' | 'offline') { super(message); }
}

/** What every backend offers; extension.ts talks only to this. */
export interface Player {
  getState(): Promise<PlayerState>;
  playPause(): Promise<unknown>;
  next(): Promise<unknown>;
  previous(): Promise<unknown>;
  toggleShuffle(): Promise<unknown>;
  toggleRepeat(): Promise<unknown>;
  getVolume(): Promise<number>;
  setVolume(volume: number): Promise<unknown>;
  open(): Promise<void>;
}

const PLAYER_METHODS = ['getState', 'playPause', 'next', 'previous', 'toggleShuffle', 'toggleRepeat', 'getVolume', 'setVolume', 'open'] as const;

/**
 * Runs each call on `web`; when the Web API cannot be used, runs it on `local` instead and tells
 * `onFallback` why. If the local app is not running either, the Web API's reason is the error.
 */
export function withFallback(web: Player, local: Player, onFallback: (err: WebApiUnavailableError) => void): Player {
  const wrap = (name: typeof PLAYER_METHODS[number]) => async (...args: unknown[]) => {
    try {
      return await (web[name] as (...a: unknown[]) => Promise<unknown>)(...args);
    } catch (err) {
      if (!(err instanceof WebApiUnavailableError)) throw err;
      let result: unknown;
      try {
        result = await (local[name] as (...a: unknown[]) => Promise<unknown>)(...args);
      } catch (localErr) {
        throw localErr instanceof NotRunningError ? err : localErr;
      }
      if (name === 'getState' && (result as PlayerState).kind === 'notRunning') throw err;
      onFallback(err);
      return result;
    }
  };
  return Object.fromEntries(PLAYER_METHODS.map(m => [m, wrap(m)])) as unknown as Player;
}

/** The status bar items a user can show or hide, with the names the settings UI uses. */
export const STATUS_BAR_ITEMS = {
  previous: 'Previous button',
  playPause: 'Play/Pause button',
  next: 'Next button',
  nowPlaying: 'Song name',
  like: 'Like button (heart)',
  progress: 'Progress bar',
  progressWhenPaused: 'Progress bar while paused',
} as const;
export type StatusBarKey = keyof typeof STATUS_BAR_ITEMS;
export type StatusBarShown = Record<StatusBarKey, boolean>;

/**
 * Which status bar items to show. `user` is what the user set in earworm.statusBar.items.
 * The older earworm.showButtons: false still hides the buttons until the user sets them again.
 */
export function statusBarShown(user: Partial<StatusBarShown> | undefined, showButtons: boolean | undefined): StatusBarShown {
  const buttons = showButtons !== false;
  return {
    previous: buttons, playPause: buttons, next: buttons, nowPlaying: true, like: buttons, progress: true, progressWhenPaused: false,
    ...user,
  };
}

/** The GitHub feedback form, with the facts that help read the feedback already filled in. */
export function feedbackUrl(fields: { earworm: string; editor: string; os: string; mode: string }) {
  const query = Object.entries({ template: 'feedback.yml', ...fields })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); // %20, not URLSearchParams' +, survives vscode.Uri
  return `https://github.com/me-alen/earworm-vscode/issues/new?${query}`;
}

/** VS Code installs from the Marketplace; Cursor, VSCodium, Windsurf and others from Open VSX. */
export const reviewUrl = (uriScheme: string) => (uriScheme === 'vscode' || uriScheme === 'vscode-insiders'
  ? 'https://marketplace.visualstudio.com/items?itemName=alenfrancis.earworm&ssr=false#review-details'
  : 'https://open-vsx.org/extension/alenfrancis/earworm/reviews');

/** Songs played since the first one, for the single "Enjoying Earworm?" note. */
export interface FeedbackAsk { firstSong: number; songs: number; asked: boolean }

/** Ask once ever, and only after two weeks and ten songs of real use. */
export const shouldAskFeedback = (s: FeedbackAsk, now: number) =>
  !s.asked && s.songs >= 10 && now - s.firstSong >= 14 * 24 * 60 * 60 * 1000;
