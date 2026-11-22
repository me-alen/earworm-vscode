import * as vscode from 'vscode';
import { NotRunningError, Player, PlayerState, Progress, progressText } from './common';
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
  // Shows the sidebar's sign-in welcome instead of the tree when there are no tokens.
  const syncSignedIn = async () => {
    await vscode.commands.executeCommand('setContext', 'earworm.signedIn', await web.signedIn());
    library.refresh();
  };

  const unsupported: Player = new Proxy({} as Player, {
    get: () => () => Promise.reject(new Error('Earworm cannot control the Spotify app on this OS. Run "Earworm: Set Up Spotify Web API" to use the Web API instead.')),
  });
  const player = (): Player => (webMode() ? web : local ?? unsupported);

  const item = (priority: number, command: string, label: string, text?: string) => {
    const i = vscode.window.createStatusBarItem(`earworm.${label}`, vscode.StatusBarAlignment.Left, priority);
    i.name = `Earworm: ${label}`;
    i.command = command;
    i.tooltip = label;
    i.accessibilityInformation = { label };
    if (text) i.text = text;
    context.subscriptions.push(i);
    return i;
  };
  const prevItem = item(103, 'earworm.previous', 'Previous Track', '$(chevron-left)');
  const playItem = item(102, 'earworm.playPause', 'Play/Pause');
  const nextItem = item(101, 'earworm.next', 'Next Track', '$(chevron-right)');
  const trackItem = item(100, 'earworm.openSpotify', 'Now Playing');
  const progressItem = item(99, '', 'Playback Progress');
  progressItem.command = undefined;
  const buttons = [prevItem, playItem, nextItem];

  // Spotify reports the position only every few seconds, so count forward between reports.
  let progress: (Progress & { at: number; playing: boolean }) | undefined;
  function renderProgress() {
    if (!progress) return progressItem.hide();
    const elapsed = progress.playing ? (Date.now() - progress.at) / 1000 : 0;
    const { text, label } = progressText(Math.min(progress.duration, progress.position + elapsed), progress.duration);
    progressItem.text = text;
    progressItem.tooltip = label;
    progressItem.accessibilityInformation = { label: `Played ${label}` };
    progressItem.show();
  }
  const ticker = setInterval(() => { if (progress?.playing) renderProgress(); }, 1000);

  let lastVolume: number | undefined; // volume before muting, restored on unmute

  function render(state: PlayerState) {
    trackItem.show();
    trackItem.command = 'earworm.openSpotify';
    progress = state.kind === 'running' && state.progress ? { ...state.progress, at: Date.now(), playing: state.playing } : undefined;
    renderProgress();
    if (state.kind === 'notRunning') {
      buttons.forEach(b => b.hide());
      trackItem.text = '$(music) Spotify';
      trackItem.tooltip = webMode() ? 'No Spotify device is active. Click to open Spotify.' : 'Spotify is not running. Click to open it.';
      trackItem.accessibilityInformation = { label: `${trackItem.tooltip}` };
      return;
    }
    playItem.text = state.playing ? '$(debug-pause)' : '$(play)';
    playItem.tooltip = state.playing ? 'Pause' : 'Play';
    playItem.accessibilityInformation = { label: playItem.tooltip };
    buttons.forEach(b => (config().get('showButtons', true) ? b.show() : b.hide()));
    const t = state.track;
    const label = t ? `${t.name} — ${t.artist}` : 'Not playing';
    trackItem.text = `$(music) ${label.length > 50 ? label.slice(0, 49) + '…' : label}`;
    trackItem.tooltip = t ? `${t.name}\n${t.artist} — ${t.album}` : 'Nothing is playing';
    trackItem.accessibilityInformation = { label: t ? `Now playing ${t.name} by ${t.artist}` : 'Nothing is playing' };
  }

  function renderError(err: unknown) {
    buttons.forEach(b => b.hide());
    progress = undefined;
    renderProgress();
    const signIn = err instanceof SignInRequiredError;
    trackItem.text = signIn ? '$(account) Sign in to Spotify' : '$(warning) Spotify';
    trackItem.command = signIn ? 'earworm.signIn' : 'earworm.openSpotify';
    trackItem.tooltip = err instanceof Error ? err.message : String(err);
    trackItem.accessibilityInformation = { label: `Earworm: ${trackItem.tooltip}` };
    trackItem.show();
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
    vscode.commands.registerCommand('earworm.refreshLibrary', () => library.refresh()),
    command('playItem', async (n: Node) => {
      await web.play(n.item!);
      setTimeout(() => library.refreshQueue(), 1000);
    }),
    command('queueItem', async (n: Node) => {
      await web.addToQueue(n.item!);
      vscode.window.setStatusBarMessage(`$(check) Added "${n.item!.name}" to the queue`, 4000);
      library.refreshQueue();
    }),
    vscode.window.onDidChangeWindowState(s => { if (s.focused) void refresh(); }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('earworm')) { schedule(); void refresh(); }
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
