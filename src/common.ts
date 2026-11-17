// Shared by the platform backends (macos.ts, linux.ts) and extension.ts.

export interface Track { name: string; artist: string; album: string }

export type PlayerState =
  | { kind: 'notRunning' }
  | { kind: 'running'; playing: boolean; track?: Track };

export class NotRunningError extends Error {
  constructor() { super('Spotify is not running.'); }
}
