import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeFor, createWebApi, parseDevices, parsePlayback, parseSearch, SignInRequiredError } from '../src/webapi';
import { NotRunningError } from '../src/common';

const json = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

const PLAYING = {
  device: { id: 'd1', volume_percent: 40 },
  is_playing: true,
  shuffle_state: false,
  repeat_state: 'off',
  item: { name: 'Say "Hi"', artists: [{ name: 'Artist A' }, { name: 'Artist B' }], album: { name: 'Album One' } },
};

// Shaped like a real GET /search reply, trimmed. Spotify does return null playlist entries.
const SEARCH = {
  tracks: { items: [{
    uri: 'spotify:track:t1', name: 'Say "Hi"', duration_ms: 225_000,
    artists: [{ name: 'Artist A' }, { name: 'Artist B' }], album: { uri: 'spotify:album:a1', name: 'Album One' },
  }] },
  albums: { items: [{ uri: 'spotify:album:a1', name: 'Album One', artists: [{ name: 'Artist A' }], release_date: '2021-05-07', total_tracks: 12 }] },
  playlists: { items: [null, { uri: 'spotify:playlist:p1', name: 'Focus', owner: { display_name: 'Alen' } }] },
};

/** A fake Spotify (accounts + Web API) and a fake browser that completes the sign-in. */
function fake(browser?: (redirect: string, state: string) => string) {
  const s = {
    now: 1_000_000,
    secret: undefined as string | undefined,
    calls: [] as string[],
    challenge: '',
    issued: 0,
    revoked: false,
    player: PLAYING as any,
    devices: [] as { id: string; is_restricted?: boolean }[],
    next: undefined as Response | undefined, // one-off reply for the next API call
  };
  const fetchFake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.host === 'accounts.spotify.com') {
      const body = new URLSearchParams(String(init?.body));
      const grant = body.get('grant_type');
      s.calls.push(`token ${grant}`);
      const ok = grant === 'authorization_code'
        ? body.get('code') === 'the-code' && challengeFor(body.get('code_verifier')!) === s.challenge
        : !s.revoked && body.get('refresh_token') === 'refresh-1';
      if (!ok) return json(400, { error: 'invalid_grant' });
      s.issued++;
      // Like Spotify, a refresh may come back without a new refresh token.
      return json(200, { access_token: `access-${s.issued}`, expires_in: 3600, ...(grant === 'authorization_code' && { refresh_token: 'refresh-1' }) });
    }
    const auth = (init?.headers as Record<string, string>).Authorization;
    s.calls.push(`${init?.method} ${url.pathname.replace('/v1', '')}${url.search} ${auth}${init?.body ? ` ${init.body}` : ''}`);
    const once = s.next;
    s.next = undefined;
    if (once) return once;
    if (url.pathname === '/v1/me/player/devices') return json(200, { devices: s.devices });
    if (url.pathname === '/v1/search') return json(200, SEARCH);
    if (init?.method === 'GET') return s.player ? json(200, s.player) : json(204);
    return json(204);
  }) as typeof fetch;

  const api = createWebApi({
    clientId: () => '0123456789abcdef0123456789abcdef',
    store: {
      get: async () => s.secret,
      store: async v => { s.secret = v; },
      delete: async () => { s.secret = undefined; },
    },
    openUrl: async url => {
      const q = new URL(url).searchParams;
      assert.equal(q.get('code_challenge_method'), 'S256');
      assert.equal(q.get('scope'), 'user-read-playback-state user-modify-playback-state');
      assert.match(q.get('redirect_uri')!, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      assert.doesNotMatch(url, /\+/); // spaces as %20
      s.challenge = q.get('code_challenge')!;
      const redirect = q.get('redirect_uri')!;
      const query = browser ? browser(redirect, q.get('state')!) : `code=the-code&state=${q.get('state')}`;
      await fetch(`${redirect}?${query}`); // the browser landing on the loopback listener
    },
    open: async () => undefined,
    fetch: fetchFake,
    now: () => s.now,
  });
  return { s, api };
}

async function signedIn() {
  const f = fake();
  await f.api.signIn();
  f.s.calls.length = 0;
  return f;
}

test('PKCE challenge matches the RFC 7636 example', () => {
  assert.equal(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('parsePlayback', () => {
  assert.deepEqual(parsePlayback(undefined), { kind: 'notRunning' });
  assert.deepEqual(parsePlayback(PLAYING), {
    kind: 'running', playing: true, track: { name: 'Say "Hi"', artist: 'Artist A, Artist B', album: 'Album One' },
  });
  assert.deepEqual(parsePlayback({ device: {}, is_playing: true, item: null }), { kind: 'running', playing: true, track: undefined });
  assert.deepEqual(
    parsePlayback({ device: {}, is_playing: false, item: { name: 'Ep 1', show: { name: 'A Podcast' } } }),
    { kind: 'running', playing: false, track: { name: 'Ep 1', artist: 'A Podcast', album: 'A Podcast' } },
  );
});

test('not signed in', async () => {
  const { api } = fake();
  await assert.rejects(api.getState(), SignInRequiredError);
});

test('sign-in stores tokens; controls call the right endpoints', async () => {
  const { s, api } = await signedIn();
  assert.equal(JSON.parse(s.secret!).refresh, 'refresh-1');
  assert.deepEqual(await api.getState(), parsePlayback(PLAYING));
  await api.playPause();
  s.player = { ...PLAYING, is_playing: false };
  await api.playPause();
  await api.next();
  await api.previous();
  await api.toggleShuffle();
  await api.toggleRepeat();
  assert.equal(await api.getVolume(), 40);
  await api.setVolume(150);
  assert.deepEqual(s.calls.filter(c => !c.startsWith('GET')), [
    'PUT /me/player/pause Bearer access-1',
    'PUT /me/player/play Bearer access-1',
    'POST /me/player/next Bearer access-1',
    'POST /me/player/previous Bearer access-1',
    'PUT /me/player/shuffle?state=true Bearer access-1',
    'PUT /me/player/repeat?state=context Bearer access-1',
    'PUT /me/player/volume?volume_percent=100 Bearer access-1',
  ]);
});

test('expired token is refreshed once and the refresh token kept', async () => {
  const { s, api } = await signedIn();
  s.now += 3600_000;
  await Promise.all([api.getState(), api.getState()]);
  assert.equal(s.calls.filter(c => c === 'token refresh_token').length, 1);
  assert.ok(s.calls.at(-1)!.endsWith('Bearer access-2'));
  s.now += 3600_000;
  await api.getState(); // works again with the kept refresh token
  assert.ok(s.calls.at(-1)!.endsWith('Bearer access-3'));
});

test('a 401 refreshes and retries', async () => {
  const { s, api } = await signedIn();
  s.next = json(401, { error: { status: 401, message: 'The access token expired' } });
  assert.equal((await api.getState()).kind, 'running');
  assert.ok(s.calls.includes('token refresh_token'));
});

test('revoked sign-in clears the tokens', async () => {
  const { s, api } = await signedIn();
  s.revoked = true;
  s.now += 3600_000;
  await assert.rejects(api.getState(), SignInRequiredError);
  assert.equal(s.secret, undefined);
});

test('quota exceeded backs off without calling Spotify', async () => {
  const { s, api } = await signedIn();
  s.next = json(429, { error: { status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' } });
  await assert.rejects(api.getState(), /quota.*10 min/);
  const before = s.calls.length;
  await assert.rejects(api.next(), /quota/);
  assert.equal(s.calls.length, before);
  s.now += 601_000;
  assert.equal((await api.getState()).kind, 'running');
});

test('rate limit honours Retry-After', async () => {
  const { s, api } = await signedIn();
  s.next = json(429, undefined, { 'Retry-After': '7' });
  await assert.rejects(api.getState(), /slow down.*7 s/);
  s.now += 7_000;
  assert.equal((await api.getState()).kind, 'running');
});

test('no active device and Premium errors', async () => {
  const { s, api } = await signedIn();
  s.player = undefined;
  assert.deepEqual(await api.getState(), { kind: 'notRunning' });
  await assert.rejects(api.playPause(), NotRunningError);
  s.next = json(404, { error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } });
  await assert.rejects(api.next(), NotRunningError);
  s.next = json(403, { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } });
  await assert.rejects(api.next(), /Premium/);
});

test('sign-in rejects a wrong state and a denied consent', async () => {
  await assert.rejects(fake(() => 'code=the-code&state=forged').api.signIn(), /sign-in failed/);
  await assert.rejects(fake(() => 'error=access_denied').api.signIn(), /cancelled/);
});

test('sign-in can be cancelled', async () => {
  const abort = new AbortController();
  const { api } = fake(() => { abort.abort(); return 'unrelated=1'; });
  await assert.rejects(api.signIn(abort.signal), /cancelled/);
});

test('parseSearch keeps songs, albums and playlists, and skips null entries', () => {
  assert.deepEqual(parseSearch(SEARCH), [
    { kind: 'track', uri: 'spotify:track:t1', name: 'Say "Hi"', by: 'Artist A, Artist B', detail: 'Album One · 3:45', contextUri: 'spotify:album:a1' },
    { kind: 'album', uri: 'spotify:album:a1', name: 'Album One', by: 'Artist A', detail: '2021 · 12 songs' },
    { kind: 'playlist', uri: 'spotify:playlist:p1', name: 'Focus', by: 'by Alen' },
  ]);
  assert.deepEqual(parseSearch({}), []);
});

test('search, play and add to queue call the right endpoints', async () => {
  const { s, api } = await signedIn();
  const [song, album, playlist] = await api.search('say hi + more');
  await api.play(song);
  await api.play(album);
  await api.play(playlist);
  await api.addToQueue(song);
  await assert.rejects(api.addToQueue(album), /Only songs/);
  assert.deepEqual(s.calls, [
    'GET /search?q=say%20hi%20%2B%20more&type=track%2Calbum%2Cplaylist&limit=10 Bearer access-1',
    'PUT /me/player/play Bearer access-1 {"context_uri":"spotify:album:a1","offset":{"uri":"spotify:track:t1"}}',
    'PUT /me/player/play Bearer access-1 {"context_uri":"spotify:album:a1"}',
    'PUT /me/player/play Bearer access-1 {"context_uri":"spotify:playlist:p1"}',
    'POST /me/player/queue?uri=spotify%3Atrack%3At1 Bearer access-1',
  ]);
});

test('with no active device, play and queue use the only available one', async () => {
  const { s, api } = await signedIn();
  const [song] = await api.search('hi');
  const noDevice = () => json(404, { error: { status: 404, message: 'No active device found', reason: 'NO_ACTIVE_DEVICE' } });
  s.devices = [{ id: 'mac 1' }, { id: 'tv', is_restricted: true }];
  s.next = noDevice();
  await api.addToQueue(song);
  assert.equal(s.calls.at(-1), 'POST /me/player/queue?uri=spotify%3Atrack%3At1&device_id=mac%201 Bearer access-1');
  s.devices.push({ id: 'phone' });
  s.next = noDevice();
  await assert.rejects(api.play(song), /Several Spotify devices/);
  s.devices = [];
  s.next = noDevice();
  await assert.rejects(api.play(song), NotRunningError);
});

test('parseDevices skips devices without an id', () => {
  assert.deepEqual(parseDevices({ devices: [
    { id: 'mac', name: 'MacBook', type: 'Computer', is_active: true, is_restricted: false, volume_percent: 50 },
    { id: null, name: 'Ghost', type: 'Speaker' },
    { id: 'tv', name: 'Living Room', type: 'TV', is_active: false, is_restricted: true },
  ] }), [
    { id: 'mac', name: 'MacBook', type: 'Computer', active: true, restricted: false },
    { id: 'tv', name: 'Living Room', type: 'TV', active: false, restricted: true },
  ]);
  assert.deepEqual(parseDevices(undefined), []);
});

test('devices and transfer call the right endpoints', async () => {
  const { s, api } = await signedIn();
  s.devices = [{ id: 'phone' }];
  assert.deepEqual((await api.devices()).map(d => d.id), ['phone']);
  await api.transfer('phone');
  assert.deepEqual(s.calls, [
    'GET /me/player/devices Bearer access-1',
    'PUT /me/player Bearer access-1 {"device_ids":["phone"]}',
  ]);
});
