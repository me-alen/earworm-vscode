// Web API mode: controls Spotify on any of the user's devices through the Spotify Web API.
// Each user signs in with their own Client ID (Spotify caps a development-mode app at 5 users,
// so a shared one cannot work). Sign-in is PKCE with a loopback listener: no client secret and
// no server of ours. Tokens live only in the store the extension passes in (SecretStorage).
// No vscode import here, so the tests can drive the whole flow.
import { createHash, randomBytes } from 'node:crypto';
import * as http from 'node:http';
import { NotRunningError, Player, PlayerState, WebApiUnavailableError, withProgress } from './common';

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
// Changing these makes existing users sign in again (a 403 "Insufficient client scope" asks them to).
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-recently-played '
  + 'user-library-read user-library-modify playlist-read-private playlist-read-collaborative';
const CALLBACK = '/callback';
// Spotify's docs allow a portless loopback URI with any port at sign-in, but the dashboard
// rejects it as "not secure", so Earworm uses one fixed, rarely used port.
const PORT = 43117;
/** What the user registers in the Spotify dashboard. */
export const REDIRECT_URI = `http://127.0.0.1:${PORT}${CALLBACK}`;
const NO_DEVICE = 'No Spotify device is active. Start playing on any device (computer, phone, web player), then try again.';

interface Tokens { access: string; refresh: string; expiresAt: number; clientId: string }

export interface Deps {
  clientId(): string;
  store: { get(): PromiseLike<string | undefined>; store(value: string): PromiseLike<void>; delete(): PromiseLike<void> };
  openUrl(url: string): PromiseLike<unknown>;
  open(): Promise<void>;
  fetch?: typeof fetch;
  now?: () => number;
}

export class SignInRequiredError extends Error {
  constructor(message = 'Sign in to Spotify first: run "Earworm: Sign In to Spotify".') { super(message); }
}

export const challengeFor = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** Turns GET /me/player into a PlayerState. No body (204) means no active device. */
export function parsePlayback(p: any): PlayerState {
  if (!p?.device) return { kind: 'notRunning' };
  const item = p.item; // null during ads
  return {
    kind: 'running',
    playing: !!p.is_playing,
    track: item ? {
      name: item.name,
      artist: (item.artists ?? []).map((a: { name: string }) => a.name).join(', ') || item.show?.name || '',
      album: item.album?.name ?? item.show?.name ?? '',
    } : undefined,
    ...(item ? withProgress(p.progress_ms / 1000, item.duration_ms / 1000) : {}),
  };
}

export interface Device {
  id: string;
  name: string;
  type: string;        // Computer, Smartphone, Speaker, TV, ...
  active: boolean;
  restricted: boolean; // Spotify accepts no commands for it
}

/** Turns GET /me/player/devices into a list. Devices without an id cannot be addressed, so they are left out. */
export function parseDevices(r: any): Device[] {
  return ((r?.devices ?? []) as any[]).filter(x => x?.id).map(x => ({
    id: x.id, name: x.name, type: x.type ?? '', active: !!x.is_active, restricted: !!x.is_restricted,
  }));
}

export interface SearchItem {
  kind: 'track' | 'album' | 'playlist';
  uri: string;
  name: string;
  by: string;           // artists, or the playlist's owner
  detail?: string;
  contextUri?: string;  // a song's album, so playback continues after it
}

const names = (list?: { name: string }[]) => (list ?? []).map(x => x.name).join(', ');
const duration = (ms?: number) => (ms ? `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : '');

/** A song or podcast episode, played within contextUri (its album by default). Local files cannot be played remotely. */
export function parseSong(t: any, contextUri: string | undefined = t?.album?.uri): SearchItem | undefined {
  if (!t?.uri || t.is_local) return undefined;
  return {
    kind: 'track', uri: t.uri, name: t.name, by: names(t.artists) || t.show?.name || '',
    detail: [t.album?.name ?? t.show?.name, duration(t.duration_ms)].filter(Boolean).join(' · '),
    contextUri,
  };
}
const songs = (list: any[] | undefined, contextUri?: string) =>
  (list ?? []).map(t => parseSong(t, contextUri ?? t?.album?.uri)).filter((x): x is SearchItem => !!x);
const list = (x: any) => ((x?.items ?? []) as any[]).filter(Boolean);

/** Turns GET /search into a flat list: songs, then albums, then playlists. Spotify can return null entries. */
export function parseSearch(r: any): SearchItem[] {
  return [
    ...songs(list(r?.tracks)),
    ...list(r?.albums).map((a): SearchItem => ({
      kind: 'album', uri: a.uri, name: a.name, by: names(a.artists),
      detail: [a.release_date?.slice(0, 4), a.total_tracks && `${a.total_tracks} songs`].filter(Boolean).join(' · '),
    })),
    ...list(r?.playlists).map((p): SearchItem => ({
      kind: 'playlist', uri: p.uri, name: p.name, by: p.owner?.display_name ? `by ${p.owner.display_name}` : '',
    })),
  ];
}

export interface Playlist extends SearchItem { id: string; readable: boolean }
export interface Album extends SearchItem { songs: SearchItem[] }
export interface Queue { now?: SearchItem; next: SearchItem[] }

/** GET /me/playlists. Since February 2026 Spotify only lists the songs of playlists the user owns or collaborates on. */
export function parsePlaylists(r: any, me: string): Playlist[] {
  return list(r).map(p => {
    const total = (p.items ?? p.tracks)?.total; // "tracks" was renamed "items" in February 2026
    return {
      kind: 'playlist', uri: p.uri, id: p.id, name: p.name,
      by: p.owner?.id === me ? '' : p.owner?.display_name ? `by ${p.owner.display_name}` : '',
      detail: typeof total === 'number' ? `${total} songs` : undefined,
      readable: !!p.collaborative || p.owner?.id === me,
    };
  });
}

/** GET /me/albums: each saved album comes with its songs. */
export function parseAlbums(r: any): Album[] {
  return list(r).map(x => x.album).filter(Boolean).map(a => ({
    kind: 'album', uri: a.uri, name: a.name, by: names(a.artists),
    detail: a.release_date?.slice(0, 4),
    songs: songs(a.tracks?.items, a.uri),
  }));
}

const page = (text: string) =>
  `<!doctype html><meta charset="utf-8"><title>Earworm</title><body style="font:16px system-ui;padding:3em">${text}</body>`;

export interface WebApi extends Player {
  signIn(signal?: AbortSignal): Promise<void>;
  signOut(): Promise<void>;
  signedIn(): Promise<boolean>;
  search(query: string): Promise<SearchItem[]>;
  play(item: SearchItem): Promise<unknown>;
  addToQueue(item: SearchItem): Promise<void>;
  devices(): Promise<Device[]>;
  transfer(deviceId: string): Promise<void>;
  queue(): Promise<Queue>;
  recentlyPlayed(): Promise<SearchItem[]>;
  likedSongs(): Promise<SearchItem[]>;
  playlists(): Promise<Playlist[]>;
  playlistSongs(p: Playlist): Promise<SearchItem[]>;
  albums(): Promise<Album[]>;
  /** Whether the song playing now is in Liked Songs; undefined when nothing is playing. */
  currentLiked(): Promise<{ uri: string; liked: boolean } | undefined>;
  /** Likes or unlikes the song playing now and returns its new state. */
  toggleLike(): Promise<{ name: string; liked: boolean }>;
}

export function createWebApi(d: Deps): WebApi {
  const f = d.fetch ?? fetch;
  const now = d.now ?? Date.now;
  let refreshing: Promise<Tokens> | undefined;
  let blockedUntil = 0;
  let quotaBlocked = false;
  let userId: Promise<string> | undefined; // the signed-in user's Spotify id, asked for once

  // fetch only rejects when Spotify cannot be reached at all (offline, DNS, TLS).
  async function reach(url: string, init: RequestInit): Promise<Response> {
    try {
      return await f(url, init);
    } catch (err) {
      throw new WebApiUnavailableError(`Could not reach Spotify (${err instanceof Error ? err.message : String(err)}). Check your internet connection.`, 'offline');
    }
  }

  async function tokenRequest(body: Record<string, string>, previous?: Tokens): Promise<Tokens> {
    const res = await reach(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (json.error === 'invalid_grant') throw new SignInRequiredError('Your Spotify sign-in has expired or was revoked. Sign in again.');
      if (json.error === 'invalid_client') throw new SignInRequiredError('Spotify does not recognise this Client ID. Run "Earworm: Set Up Spotify Web API" again.');
      throw new Error(`Spotify sign-in failed: ${json.error_description ?? json.error ?? res.status}`);
    }
    return {
      access: json.access_token,
      refresh: json.refresh_token ?? previous?.refresh, // Spotify may or may not rotate it
      expiresAt: now() + json.expires_in * 1000,
      clientId: body.client_id,
    };
  }

  async function stored(): Promise<Tokens> {
    const raw = await d.store.get();
    if (!raw) throw new SignInRequiredError();
    return JSON.parse(raw);
  }

  // One refresh at a time, even when several calls find the token expired together.
  function refresh(): Promise<Tokens> {
    return refreshing ??= (async () => {
      try {
        const old = await stored();
        const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: old.refresh, client_id: old.clientId }, old);
        await d.store.store(JSON.stringify(t));
        return t;
      } catch (err) {
        if (err instanceof SignInRequiredError) await d.store.delete();
        throw err;
      } finally {
        refreshing = undefined;
      }
    })();
  }

  async function accessToken(): Promise<string> {
    const t = await stored();
    return t.expiresAt - 60_000 > now() ? t.access : (await refresh()).access;
  }

  function blocked() {
    const seconds = Math.ceil((blockedUntil - now()) / 1000);
    return quotaBlocked
      ? new WebApiUnavailableError(`Your Spotify app has used up its Web API quota. Earworm will try again in ${Math.ceil(seconds / 60)} min.`, 'quota')
      : new WebApiUnavailableError(`Spotify asked Earworm to slow down. Trying again in ${seconds} s.`, 'rateLimit');
  }

  async function api(method: string, path: string, body?: unknown, retried = false): Promise<any> {
    if (now() < blockedUntil) throw blocked();
    const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await reach(API + path, {
      method,
      headers,
      // Spotify wants a Content-Length on PUT/POST, so send an empty body rather than none.
      body: method === 'GET' ? undefined : body === undefined ? '' : JSON.stringify(body),
    });
    if (res.status === 401 && !retried) {
      await refresh();
      return api(method, path, body, true);
    }
    const text = await res.text();
    let json: any;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    if (res.ok) return json;

    const reason: string | undefined = json?.error?.reason;
    const message: string = json?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 429) {
      quotaBlocked = reason === 'QUOTA_EXCEEDED';
      // shortcut: 10 minutes when a quota 429 has no Retry-After; Spotify does not document the reset.
      const wait = Number(res.headers.get('Retry-After')) || (quotaBlocked ? 600 : 30);
      blockedUntil = now() + wait * 1000;
      throw blocked();
    }
    if (res.status === 404 && reason === 'NO_ACTIVE_DEVICE') throw new NotRunningError(NO_DEVICE);
    if (reason === 'PREMIUM_REQUIRED') {
      throw new WebApiUnavailableError('Controlling playback through the Web API needs Spotify Premium.', 'premium');
    }
    if (reason === 'VOLUME_CONTROL_DISALLOW') throw new Error('This Spotify device does not let other apps change its volume.');
    if (res.status === 403 && /scope/i.test(message)) {
      throw new SignInRequiredError('Earworm needs more Spotify permissions for this. Sign in again to grant them.');
    }
    if (res.status === 403 && /registered|user may not/i.test(message)) {
      throw new Error('Spotify refused this account. In the Spotify dashboard, add your Spotify email under your app\'s User Management.');
    }
    throw new Error(`Spotify Web API: ${message}`);
  }

  // Spotify's desktop app often sits idle with no "active" device. When it is the only device,
  // send the command to it by id instead of failing.
  async function onDevice(method: string, path: string, body?: unknown) {
    try {
      return await api(method, path, body);
    } catch (err) {
      if (!(err instanceof NotRunningError)) throw err;
      const devices = parseDevices(await api('GET', '/me/player/devices')).filter(x => !x.restricted);
      if (devices.length !== 1) {
        throw new NotRunningError(devices.length
          ? 'Several Spotify devices are available but none is playing. Start playing on the one you want, then try again.'
          : NO_DEVICE);
      }
      return api(method, `${path}${path.includes('?') ? '&' : '?'}device_id=${encodeURIComponent(devices[0].id)}`, body);
    }
  }

  function me(): Promise<string> {
    userId ??= api('GET', '/me').then(u => u.id);
    userId.catch(() => { userId = undefined; });
    return userId;
  }

  const playback = () => api('GET', '/me/player?additional_types=episode');
  async function currentLiked() {
    const item = (await playback())?.item;
    if (!item?.uri || item.is_local) return undefined; // local files cannot be liked through the API
    const [liked] = await api('GET', `/me/library/contains?uris=${encodeURIComponent(item.uri)}`);
    return { uri: item.uri as string, name: item.name as string, liked: !!liked };
  }
  async function active() {
    const p = await playback();
    if (!p?.device) throw new NotRunningError(NO_DEVICE);
    return p;
  }

  return {
    async signIn(signal?: AbortSignal) {
      const clientId = d.clientId();
      if (!clientId) throw new Error('Set your Client ID first: run "Earworm: Set Up Spotify Web API".');
      const verifier = randomBytes(64).toString('base64url');
      const state = randomBytes(16).toString('base64url');
      const server = http.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', (err: NodeJS.ErrnoException) => reject(err.code === 'EADDRINUSE'
          ? new Error(`Port ${PORT} is in use, so Spotify cannot hand the sign-in back to VS Code. Close whatever uses it (or another VS Code window that is signing in), then try again.`)
          : err));
        server.listen(PORT, '127.0.0.1', resolve);
      });
      try {
        const redirectUri = REDIRECT_URI;
        const code = new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Sign-in timed out. Try again.')), 5 * 60_000);
          signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Sign-in was cancelled.')); });
          server.on('request', (req, res) => {
            const url = new URL(req.url ?? '/', redirectUri);
            if (url.pathname !== CALLBACK) { res.writeHead(404).end(); return; }
            const got = url.searchParams.get('code');
            const ok = !!got && url.searchParams.get('state') === state;
            res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
              .end(page(ok ? 'Signed in to Spotify. You can close this tab and go back to VS Code.' : 'Sign-in did not finish. Go back to VS Code and try again.'));
            clearTimeout(timer);
            if (ok) resolve(got);
            else reject(new Error(url.searchParams.get('error') === 'access_denied' ? 'Sign-in was cancelled in Spotify.' : 'Spotify sign-in failed.'));
          });
        });
        code.catch(() => undefined); // handled below; avoids an unhandled rejection while the browser opens
        const query = new URLSearchParams({
          client_id: clientId,
          response_type: 'code',
          redirect_uri: redirectUri,
          code_challenge_method: 'S256',
          code_challenge: challengeFor(verifier),
          scope: SCOPES,
          state,
        });
        await d.openUrl(`${ACCOUNTS}/authorize?${query.toString().replace(/\+/g, '%20')}`);
        const tokens = await tokenRequest({
          grant_type: 'authorization_code',
          code: await code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: verifier,
        });
        await d.store.store(JSON.stringify(tokens));
        blockedUntil = 0;
        userId = undefined; // may be another account
      } finally {
        server.closeAllConnections();
        server.close();
      }
    },
    signOut: async () => { await d.store.delete(); userId = undefined; },
    signedIn: async () => !!(await d.store.get()),

    // Development-mode apps get at most 10 results per type since February 2026.
    search: async (query: string) => parseSearch(await api('GET',
      `/search?${new URLSearchParams({ q: query, type: 'track,album,playlist', limit: '10' }).toString().replace(/\+/g, '%20')}`)),
    // A song plays within its album, so playback carries on after it like in the Spotify app.
    play: (item: SearchItem) => onDevice('PUT', '/me/player/play', item.kind !== 'track'
      ? { context_uri: item.uri }
      : item.contextUri ? { context_uri: item.contextUri, offset: { uri: item.uri } } : { uris: [item.uri] }),
    devices: async () => parseDevices(await api('GET', '/me/player/devices')),
    // Without "play", Spotify keeps the current state: playing stays playing, paused stays paused.
    transfer: async (deviceId: string) => { await api('PUT', '/me/player', { device_ids: [deviceId] }); },
    async addToQueue(item: SearchItem) {
      if (item.kind !== 'track') throw new Error('Only songs can be added to the queue.');
      await onDevice('POST', `/me/player/queue?uri=${encodeURIComponent(item.uri)}`);
    },

    // shortcut: lists stop at the first 50 entries; add paging if people miss the rest.
    async queue() {
      const r = await api('GET', '/me/player/queue');
      return { now: parseSong(r?.currently_playing), next: songs(r?.queue) };
    },
    recentlyPlayed: async () => songs(list(await api('GET', '/me/player/recently-played?limit=50')).map(x => x.track)),
    likedSongs: async () => songs(list(await api('GET', '/me/tracks?limit=50')).map(x => x.track), `spotify:user:${await me()}:collection`),
    playlists: async () => parsePlaylists(await api('GET', '/me/playlists?limit=50'), await me()),
    playlistSongs: async (p: Playlist) =>
      songs(list(await api('GET', `/playlists/${encodeURIComponent(p.id)}/items?limit=50`)).map(x => x.item ?? x.track), p.uri),
    albums: async () => parseAlbums(await api('GET', '/me/albums?limit=50')),
    async currentLiked() {
      const c = await currentLiked();
      return c && { uri: c.uri, liked: c.liked };
    },
    async toggleLike() {
      const c = await currentLiked();
      if (!c) throw new NotRunningError('Nothing is playing on Spotify right now, so there is no song to like.');
      await api(c.liked ? 'DELETE' : 'PUT', `/me/library?uris=${encodeURIComponent(c.uri)}`);
      return { name: c.name, liked: !c.liked };
    },

    getState: async () => parsePlayback(await playback()),
    playPause: async () => api('PUT', (await active()).is_playing ? '/me/player/pause' : '/me/player/play'),
    next: () => api('POST', '/me/player/next'),
    previous: () => api('POST', '/me/player/previous'),
    toggleShuffle: async () => api('PUT', `/me/player/shuffle?state=${!(await active()).shuffle_state}`),
    toggleRepeat: async () => api('PUT', `/me/player/repeat?state=${(await active()).repeat_state === 'off' ? 'context' : 'off'}`),
    async getVolume() {
      const v = (await active()).device.volume_percent;
      if (typeof v !== 'number') throw new Error('This Spotify device does not report its volume.');
      return v;
    },
    setVolume: v => api('PUT', `/me/player/volume?volume_percent=${Math.round(Math.min(100, Math.max(0, v)))}`),
    open: () => d.open(),
  };
}
