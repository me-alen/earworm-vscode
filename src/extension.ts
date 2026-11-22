import * as vscode from 'vscode';
import { NotRunningError, Player, PlayerState, Progress, progressText, StatusBarShown, statusBarShown, WebApiUnavailableError, withFallback } from './common';
import { customizeStatusBar, StatusBarView } from './statusbarSettings';
import * as macos from './macos';
import * as linux from './linux';
import * as windows from './windows';
import { createWebApi, REDIRECT_URI, SignInRequiredError } from './webapi';
import { showSearch } from './search';
import { pickDevice } from './devices';
import { Library, Node } from './library';

const config = () => vscode.workspace.getConfiguration('earworm');
const locals: Partial<Record<NodeJS.Platform, Player>> = { darwin: macos, linux, win32: windows };
const TOKENS_KEY = 'earworm.spotifyTokens';
const DASHBOARD = 'https://developer.spotify.com/dashboard';

export function activate(context: vscode.ExtensionContext) {
  const local = locals[process.platform];
  const webMode = () => config().get('mode') === 'webApi';

  const web = createWebApi({
    clientId: () => config().get<string>('clientId', '').trim(),
    store: {
      get: () => context.secrets.get(TOKENS_KEY),
      store: v => context.secrets.store(TOKENS_KEY, v),
      delete: () => context.secrets.delete(TOKENS_KEY),
    },
    openUrl: url => vscode.env.openExternal(vscode.Uri.parse(url)),
    // The desktop app where Earworm can start it, otherwise Spotify's web player.
    open: async () => {
      if (local) return local.open();
      await vscode.env.openExternal(vscode.Uri.parse('https://open.spotify.com'));
    },
  });

  const library = new Library(web);
  const statusBarView = new StatusBarView(() => shown());
  // Shows the sidebar's sign-in welcome instead of the tree when there are no tokens.
  let signedIn = false;
  const syncSignedIn = async () => {
    signedIn = await web.signedIn();
    likedFor = undefined; // check the heart again: the account or its permissions may have changed
    await vscode.commands.executeCommand('setContext', 'earworm.signedIn', signedIn);
    library.refresh();
  };

  const unsupported: Player = new Proxy({} as Player, {
    get: () => () => Promise.reject(new Error('Earworm cannot control the Spotify app on this OS. Run "Earworm: Set Up Spotify Web API" to use the Web API instead.')),
  });
  // In Web API mode, playback falls back to the Spotify app on this computer when the Web API
  // cannot be used (quota, rate limit, no Premium, offline). Each reason is explained once per session.
  const toldAbout = new Set<string>();
  const webOrLocal = local ? withFallback(web, local, (err: WebApiUnavailableError) => {
    if (toldAbout.has(err.reason)) return;
    toldAbout.add(err.reason);
    void vscode.window.showInformationMessage(`${err.message} Earworm is controlling the Spotify app on this computer instead.`);
  }) : web;
  const player = (): Player => (webMode() ? webOrLocal : local ?? unsupported);

  // What the user chose to show (earworm.statusBar.items), read fresh on every render.
  const shown = (): StatusBarShown => {
    const i = config().inspect<Partial<StatusBarShown>>('statusBar.items');
    return statusBarShown({ ...i?.globalValue, ...i?.workspaceValue }, config().get<boolean>('showButtons'));
  };

  // An item's side is fixed when it is created, so moving sides recreates them all.
  // Higher priority sits further left on either side.
  function createBar() {
    const side = config().get('statusBar.alignment') === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
    const item = (priority: number, command: string | undefined, label: string, text?: string) => {
      const i = vscode.window.createStatusBarItem(`earworm.${label}`, side, priority);
      i.name = `Earworm: ${label}`;
      i.command = command;
      i.tooltip = label;
      i.accessibilityInformation = { label };
      if (text) i.text = text;
      return i;
    };
    return {
      prev: item(103, 'earworm.previous', 'Previous Track', '$(chevron-left)'),
      play: item(102, 'earworm.playPause', 'Play/Pause'),
      next: item(101, 'earworm.next', 'Next Track', '$(chevron-right)'),
      track: item(100, 'earworm.openSpotify', 'Now Playing'),
      like: item(99.5, 'earworm.toggleLike', 'Like Song'),
      progress: item(99, undefined, 'Playback Progress'),
    };
  }
  let bar = createBar();
  context.subscriptions.push({ dispose: () => Object.values(bar).forEach(i => i.dispose()) });
  const showIf = (i: vscode.StatusBarItem, visible: boolean) => (visible ? i.show() : i.hide());

  // Spotify reports the position only every few seconds, so count forward between reports.
  let progress: (Progress & { at: number; playing: boolean }) | undefined;
  function renderProgress() {
    const s = shown();
    if (!progress || !s.progress || (!progress.playing && !s.progressWhenPaused)) return bar.progress.hide();
    const elapsed = progress.playing ? (Date.now() - progress.at) / 1000 : 0;
    const { text, label } = progressText(Math.min(progress.duration, progress.position + elapsed), progress.duration);
    bar.progress.text = text;
    bar.progress.tooltip = label;
    bar.progress.accessibilityInformation = { label: `Played ${label}` };
    bar.progress.show();
  }
  const ticker = setInterval(() => { if (progress?.playing) renderProgress(); }, 1000);

  // The heart needs the Web API, so it shows only when signed in, in either mode. Spotify is asked
  // once per song, not on every poll.
  let likedFor: string | undefined;
  let liked: boolean | undefined;
  function showLike(value: boolean | undefined) {
    liked = value;
    bar.like.text = liked ? '$(heart-filled)' : '$(heart)';
    bar.like.tooltip = liked ? 'Remove from Liked Songs' : 'Save to Liked Songs';
    bar.like.accessibilityInformation = { label: bar.like.tooltip };
    showIf(bar.like, shown().like);
  }
  async function updateLike(state: PlayerState) {
    if (!signedIn || state.kind !== 'running' || !state.track) { likedFor = undefined; bar.like.hide(); return; }
    const key = `${state.track.name}\n${state.track.artist}`;
    if (key === likedFor) return showLike(liked); // same song: only the user's show/hide choice may have changed
    likedFor = key;
    showLike((await web.currentLiked().catch(() => undefined))?.liked);
  }

  let lastVolume: number | undefined; // volume before muting, restored on unmute

  function render(state: PlayerState) {
    const s = shown();
    const { prev, play, next, track } = bar;
    showIf(track, s.nowPlaying);
    track.command = 'earworm.openSpotify';
    void updateLike(state);
    progress = state.kind === 'running' && state.progress ? { ...state.progress, at: Date.now(), playing: state.playing } : undefined;
    renderProgress();
    if (state.kind === 'notRunning') {
      [prev, play, next].forEach(b => b.hide());
      track.text = '$(music) Spotify';
      track.tooltip = webMode() ? 'No Spotify device is active. Click to open Spotify.' : 'Spotify is not running. Click to open it.';
      track.accessibilityInformation = { label: `${track.tooltip}` };
      return;
    }
    play.text = state.playing ? '$(debug-pause)' : '$(play)';
    play.tooltip = state.playing ? 'Pause' : 'Play';
    play.accessibilityInformation = { label: play.tooltip };
    showIf(prev, s.previous);
    showIf(play, s.playPause);
    showIf(next, s.next);
    const t = state.track;
    const label = t ? `${t.name} — ${t.artist}` : 'Not playing';
    track.text = `$(music) ${label.length > 50 ? label.slice(0, 49) + '…' : label}`;
    track.tooltip = t ? `${t.name}\n${t.artist} — ${t.album}` : 'Nothing is playing';
    track.accessibilityInformation = { label: t ? `Now playing ${t.name} by ${t.artist}` : 'Nothing is playing' };
  }

  // Shown even when the song name is hidden: it is how the user learns that something needs fixing.
  function renderError(err: unknown) {
    const { prev, play, next, track } = bar;
    [prev, play, next, bar.like].forEach(b => b.hide());
    progress = undefined;
    renderProgress();
    likedFor = undefined;
    const signIn = err instanceof SignInRequiredError;
    track.text = signIn ? '$(account) Sign in to Spotify' : '$(warning) Spotify';
    track.command = signIn ? 'earworm.signIn' : 'earworm.openSpotify';
    track.tooltip = err instanceof Error ? err.message : String(err);
    track.accessibilityInformation = { label: `Earworm: ${track.tooltip}` };
    track.show();
  }

  let busy = false;
  async function refresh() {
    if (busy) return;
    busy = true;
    try { render(await player().getState()); } catch (err) { renderError(err); } finally { busy = false; }
  }

  let timer: NodeJS.Timeout | undefined;
  function schedule() {
    clearInterval(timer);
    // Each Web API refresh is a request against the user's quota, so poll less often there.
    const seconds = Math.max(webMode() ? 5 : 1, config().get('refreshInterval', 2));
    timer = setInterval(() => { if (vscode.window.state.focused) void refresh(); }, seconds * 1000);
  }

  async function showError(err: unknown) {
    if (err instanceof NotRunningError) {
      if (await vscode.window.showInformationMessage(err.message, 'Open Spotify') === 'Open Spotify') await player().open();
    } else if (err instanceof SignInRequiredError) {
      if (await vscode.window.showInformationMessage(err.message, 'Sign In') === 'Sign In') await signIn();
    } else {
      void vscode.window.showErrorMessage(`Earworm: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function requireSignIn(feature: string) {
    if (!(await web.signedIn())) throw new SignInRequiredError(`${feature} uses the Spotify Web API. Sign in to Spotify first.`);
  }

  async function signIn() {
    if (!config().get<string>('clientId', '').trim()) return setUpWebApi();
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Finish signing in to Spotify in your browser…', cancellable: true },
      (_, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        return web.signIn(abort.signal);
      },
    );
    await syncSignedIn();
    await config().update('mode', 'webApi', vscode.ConfigurationTarget.Global);
    const state = await web.getState();
    void vscode.window.showInformationMessage(state.kind === 'notRunning'
      ? 'Signed in. Earworm now uses the Spotify Web API. Start playing on any device to see it here.'
      : 'Signed in. Earworm now uses the Spotify Web API.');
  }

  async function setUpWebApi() {
    await vscode.env.clipboard.writeText(REDIRECT_URI);
    const choice = await vscode.window.showInformationMessage('Set up Spotify Web API mode', {
      modal: true,
      detail: [
        'Web API mode controls Spotify on any of your devices. It needs your own free Spotify developer app, and Spotify Premium for playback control.',
        '',
        '1. Open the Spotify dashboard and create an app. Tick "Web API".',
        `2. Under Redirect URIs, paste ${REDIRECT_URI} (already copied to your clipboard) and save.`,
        '3. Copy the Client ID from the app page and come back here.',
      ].join('\n'),
    }, 'Open Spotify Dashboard', 'I Have a Client ID');
    if (!choice) return;
    if (choice === 'Open Spotify Dashboard') await vscode.env.openExternal(vscode.Uri.parse(DASHBOARD));
    const id = await vscode.window.showInputBox({
      title: 'Spotify Client ID',
      prompt: `Paste the Client ID from your app in the Spotify dashboard. Redirect URI to register: ${REDIRECT_URI}`,
      value: config().get<string>('clientId', ''),
      ignoreFocusOut: true,
      validateInput: v => (/^[0-9a-f]{32}$/i.test(v.trim()) ? undefined : 'A Client ID is 32 characters: digits and the letters a–f.'),
    });
    if (!id) return;
    await web.signOut(); // tokens belong to the previous Client ID
    await config().update('clientId', id.trim(), vscode.ConfigurationTarget.Global);
    await signIn();
  }

  async function signOut() {
    await web.signOut();
    await syncSignedIn();
    if (local && webMode()) await config().update('mode', 'local', vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(local
      ? 'Signed out of Spotify. Earworm is back in local mode, controlling the Spotify app on this computer.'
      : 'Signed out of Spotify.');
  }

  // Spotify takes a moment to apply a command, so refresh shortly after.
  const command = (id: string, fn: (...args: any[]) => Promise<unknown>) =>
    vscode.commands.registerCommand(`earworm.${id}`, async (...args: any[]) => {
      try { await fn(...args); } catch (err) { await showError(err); }
      setTimeout(() => void refresh(), 250);
    });

  const changeVolume = async (delta: number) => player().setVolume(await player().getVolume() + delta);

  context.subscriptions.push(
    command('playPause', () => player().playPause()),
    command('next', () => player().next()),
    command('previous', () => player().previous()),
    command('toggleShuffle', () => player().toggleShuffle()),
    command('toggleRepeat', () => player().toggleRepeat()),
    command('openSpotify', () => player().open()),
    command('volumeUp', () => changeVolume(config().get('volumeStep', 10))),
    command('volumeDown', () => changeVolume(-config().get('volumeStep', 10))),
    command('toggleMute', async () => {
      const volume = await player().getVolume();
      if (volume > 0) {
        lastVolume = volume;
        await player().setVolume(0);
      } else {
        await player().setVolume(lastVolume ?? 50);
      }
    }),
    command('setUpWebApi', setUpWebApi),
    command('signIn', signIn),
    command('signOut', signOut),
    command('search', async () => {
      await requireSignIn('Search');
      showSearch(web, showError, () => void refresh());
    }),
    command('pickDevice', async () => {
      await requireSignIn('Choosing a device');
      await pickDevice(web);
    }),
    vscode.window.registerTreeDataProvider('earworm.library', library),
    statusBarView.register(),
    vscode.commands.registerCommand('earworm.customizeStatusBar', () => customizeStatusBar(shown())),
    vscode.commands.registerCommand('earworm.toggleStatusBarSide', () => statusBarView.toggleSide()),
    vscode.commands.registerCommand('earworm.refreshLibrary', () => library.refresh()),
    command('playItem', async (n: Node) => {
      await web.play(n.item!);
      setTimeout(() => library.refreshQueue(), 1000);
    }),
    command('toggleLike', async () => {
      await requireSignIn('Liking songs');
      const { name, liked } = await web.toggleLike();
      showLike(liked);
      vscode.window.setStatusBarMessage(liked ? `$(heart-filled) Added "${name}" to Liked Songs` : `Removed "${name}" from Liked Songs`, 4000);
      library.refreshLiked();
    }),
    command('queueItem', async (n: Node) => {
      await web.addToQueue(n.item!);
      vscode.window.setStatusBarMessage(`$(check) Added "${n.item!.name}" to the queue`, 4000);
      library.refreshQueue();
    }),
    vscode.window.onDidChangeWindowState(s => { if (s.focused) void refresh(); }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('earworm')) return;
      if (e.affectsConfiguration('earworm.statusBar.alignment')) {
        Object.values(bar).forEach(i => i.dispose());
        bar = createBar();
        likedFor = undefined; // the new heart has no icon yet
      }
      if (e.affectsConfiguration('earworm.statusBar') || e.affectsConfiguration('earworm.showButtons')) statusBarView.refresh();
      schedule();
      void refresh();
    }),
    { dispose: () => { clearInterval(timer); clearInterval(ticker); } },
  );

  if (!local && !webMode() && !context.globalState.get('warnedPlatform')) {
    void context.globalState.update('warnedPlatform', true);
    void vscode.window.showInformationMessage(
      'Earworm can control the Spotify app only on macOS, Linux and Windows. On this OS, set up Spotify Web API mode instead.',
      'Set Up',
    ).then(choice => { if (choice) void setUpWebApi(); });
  }

  schedule();
  void refresh();
  void syncSignedIn();
}

export function deactivate() {
  windows.dispose();
}
