import * as vscode from 'vscode';
import { NotRunningError, PlayerState } from './common';
import * as macos from './macos';
import * as linux from './linux';
import * as windows from './windows';

const config = () => vscode.workspace.getConfiguration('backbeat');
const backends: Partial<Record<NodeJS.Platform, typeof macos | typeof linux | typeof windows>> = {
  darwin: macos,
  linux,
  win32: windows,
};

export function activate(context: vscode.ExtensionContext) {
  const backend = backends[process.platform];
  if (!backend) {
    if (!context.globalState.get('warnedPlatform')) {
      void context.globalState.update('warnedPlatform', true);
      void vscode.window.showInformationMessage('Backbeat supports macOS, Linux and Windows only.');
    }
    return;
  }
  const player = backend; // a fresh const keeps the narrowed type inside the closures below

  const item =(priority: number, command: string, label: string, text?: string) => {
    const i = vscode.window.createStatusBarItem(`backbeat.${label}`, vscode.StatusBarAlignment.Left, priority);
    i.name = `Backbeat: ${label}`;
    i.command = command;
    i.tooltip = label;
    i.accessibilityInformation = { label };
    if (text) i.text = text;
    context.subscriptions.push(i);
    return i;
  };
  const prevItem = item(103, 'backbeat.previous', 'Previous Track', '$(chevron-left)');
  const playItem = item(102, 'backbeat.playPause', 'Play/Pause');
  const nextItem = item(101, 'backbeat.next', 'Next Track', '$(chevron-right)');
  const trackItem = item(100, 'backbeat.openSpotify', 'Now Playing');
  const buttons = [prevItem, playItem, nextItem];

  let lastVolume: number | undefined; // volume before muting, restored on unmute

  function render(state: PlayerState) {
    trackItem.show();
    if (state.kind === 'notRunning') {
      buttons.forEach(b => b.hide());
      trackItem.text = '$(music) Spotify';
      trackItem.tooltip = 'Spotify is not running. Click to open it.';
      trackItem.accessibilityInformation = { label: 'Spotify is not running. Open Spotify.' };
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
    trackItem.text = '$(warning) Spotify';
    trackItem.tooltip = err instanceof Error ? err.message : String(err);
    trackItem.accessibilityInformation = { label: `Backbeat error: ${trackItem.tooltip}` };
    trackItem.show();
  }

  let busy = false;
  async function refresh() {
    if (busy) return;
    busy = true;
    try { render(await player.getState()); } catch (err) { renderError(err); } finally { busy = false; }
  }

  let timer: NodeJS.Timeout | undefined;
  function schedule() {
    clearInterval(timer);
    const seconds = Math.max(1, config().get('refreshInterval', 2));
    timer = setInterval(() => { if (vscode.window.state.focused) void refresh(); }, seconds * 1000);
  }

  async function showError(err: unknown) {
    if (err instanceof NotRunningError) {
      if (await vscode.window.showInformationMessage(err.message, 'Open Spotify') === 'Open Spotify') await player.open();
    } else {
      void vscode.window.showErrorMessage(`Backbeat: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Spotify takes a moment to apply a command, so refresh shortly after.
  const command = (id: string, fn: () => Promise<unknown>) =>
    vscode.commands.registerCommand(`backbeat.${id}`, async () => {
      try { await fn(); } catch (err) { await showError(err); }
      setTimeout(() => void refresh(), 250);
    });

  const changeVolume = async (delta: number) => player.setVolume(await player.getVolume() + delta);

  context.subscriptions.push(
    command('playPause', player.playPause),
    command('next', player.next),
    command('previous', player.previous),
    command('toggleShuffle', player.toggleShuffle),
    command('toggleRepeat', player.toggleRepeat),
    command('openSpotify', player.open),
    command('volumeUp', () => changeVolume(config().get('volumeStep', 10))),
    command('volumeDown', () => changeVolume(-config().get('volumeStep', 10))),
    command('toggleMute', async () => {
      const volume = await player.getVolume();
      if (volume > 0) {
        lastVolume = volume;
        await player.setVolume(0);
      } else {
        await player.setVolume(lastVolume ?? 50);
      }
    }),
    vscode.window.onDidChangeWindowState(s => { if (s.focused) void refresh(); }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('backbeat')) { schedule(); void refresh(); }
    }),
    { dispose: () => clearInterval(timer) },
  );

  schedule();
  void refresh();
}

export function deactivate() {
  windows.dispose();
}
