// Shared by the backends (macos.ts, linux.ts, windows.ts, webapi.ts) and extension.ts.

export interface Track { name: string; artist: string; album: string }

export type PlayerState =
  | { kind: 'notRunning' }
  | { kind: 'running'; playing: boolean; track?: Track };

export class NotRunningError extends Error {
  constructor(message = 'Spotify is not running.') { super(message); }
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
