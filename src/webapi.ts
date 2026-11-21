// Web API mode: controls Spotify on any of the user's devices through the Spotify Web API.
// Each user signs in with their own Client ID (Spotify caps a development-mode app at 5 users,
// so a shared one cannot work). Sign-in is PKCE with a loopback listener: no client secret and
// no server of ours. Tokens live only in the store the extension passes in (SecretStorage).
// No vscode import here, so the tests can drive the whole flow.
import { createHash, randomBytes } from 'node:crypto';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { NotRunningError, Player, PlayerState } from './common';

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const SCOPES = 'user-read-playback-state user-modify-playback-state';
const CALLBACK = '/callback';
/** What the user registers in the Spotify dashboard. Spotify lets loopback URIs take any port at sign-in. */
export const REDIRECT_URI = `http://127.0.0.1${CALLBACK}`;
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
  constructor(message = 'Sign in to Spotify first: run "Backbeat: Sign In to Spotify".') { super(message); }
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
  };
}

const page = (text: string) =>
  `<!doctype html><meta charset="utf-8"><title>Backbeat</title><body style="font:16px system-ui;padding:3em">${text}</body>`;

export function createWebApi(d: Deps): Player & { signIn(signal?: AbortSignal): Promise<void>; signOut(): Promise<void> } {
  const f = d.fetch ?? fetch;
  const now = d.now ?? Date.now;
  let refreshing: Promise<Tokens> | undefined;
  let blockedUntil = 0;
  let quotaBlocked = false;

  async function tokenRequest(body: Record<string, string>, previous?: Tokens): Promise<Tokens> {
    const res = await f(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (json.error === 'invalid_grant') throw new SignInRequiredError('Your Spotify sign-in has expired or was revoked. Sign in again.');
      if (json.error === 'invalid_client') throw new SignInRequiredError('Spotify does not recognise this Client ID. Run "Backbeat: Set Up Spotify Web API" again.');
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

  function blockedMessage() {
    const seconds = Math.ceil((blockedUntil - now()) / 1000);
    return quotaBlocked
      ? `Your Spotify app has used up its Web API quota. Backbeat will try again in ${Math.ceil(seconds / 60)} min. Local mode still works meanwhile.`
      : `Spotify asked Backbeat to slow down. Trying again in ${seconds} s.`;
  }

  async function api(method: string, path: string, retried = false): Promise<any> {
    if (now() < blockedUntil) throw new Error(blockedMessage());
    const res = await f(API + path, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}` },
      body: method === 'GET' ? undefined : '', // Spotify wants a Content-Length on PUT/POST
    });
    if (res.status === 401 && !retried) {
      await refresh();
      return api(method, path, true);
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
      throw new Error(blockedMessage());
    }
    if (res.status === 404 && reason === 'NO_ACTIVE_DEVICE') throw new NotRunningError(NO_DEVICE);
    if (reason === 'PREMIUM_REQUIRED') {
      throw new Error('Controlling playback through the Web API needs Spotify Premium. Set "backbeat.mode" to "local" to control the desktop app instead.');
    }
    if (reason === 'VOLUME_CONTROL_DISALLOW') throw new Error('This Spotify device does not let other apps change its volume.');
    if (res.status === 403 && /registered|user may not/i.test(message)) {
      throw new Error('Spotify refused this account. In the Spotify dashboard, add your Spotify email under your app\'s User Management.');
    }
    throw new Error(`Spotify Web API: ${message}`);
  }

  const playback = () => api('GET', '/me/player?additional_types=episode');
  async function active() {
    const p = await playback();
    if (!p?.device) throw new NotRunningError(NO_DEVICE);
    return p;
  }

  return {
    async signIn(signal?: AbortSignal) {
      const clientId = d.clientId();
      if (!clientId) throw new Error('Set your Client ID first: run "Backbeat: Set Up Spotify Web API".');
      const verifier = randomBytes(64).toString('base64url');
      const state = randomBytes(16).toString('base64url');
      const server = http.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      try {
        const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}${CALLBACK}`;
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
      } finally {
        server.closeAllConnections();
        server.close();
      }
    },
    signOut: async () => { await d.store.delete(); },

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
