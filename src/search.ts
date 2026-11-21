// "Earworm: Search Spotify": a QuickPick that searches as you type. Enter plays the result;
// the + button on a song adds it to the queue and keeps the picker open for more.
import * as vscode from 'vscode';
import { SearchItem, WebApi } from './webapi';

const ICON = { track: 'music', album: 'record', playlist: 'list-unordered' } as const;
const HEADING = { track: 'Songs', album: 'Albums', playlist: 'Playlists' } as const;
const QUEUE_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('add'), tooltip: 'Add to Queue' };

type Item = vscode.QuickPickItem & { result?: SearchItem };

function toItems(results: SearchItem[]): Item[] {
  const items: Item[] = [];
  for (const kind of ['track', 'album', 'playlist'] as const) {
    const group = results.filter(r => r.kind === kind);
    if (group.length) items.push({ label: HEADING[kind], kind: vscode.QuickPickItemKind.Separator });
    for (const r of group) {
      items.push({
        label: `$(${ICON[kind]}) ${r.name}`,
        description: r.by,
        detail: r.detail,
        alwaysShow: true, // Spotify's matches need not contain the typed text; don't let VS Code filter them out
        buttons: kind === 'track' ? [QUEUE_BUTTON] : undefined,
        result: r,
      });
    }
  }
  return items.length ? items : [{ label: 'No results', alwaysShow: true }];
}

export function showSearch(web: WebApi, showError: (err: unknown) => Promise<void>, refresh: () => void) {
  const qp = vscode.window.createQuickPick<Item>();
  qp.title = 'Search Spotify';
  qp.placeholder = 'Song, album or playlist. Enter plays it; + adds a song to the queue.';
  let latest = 0;
  let timer: NodeJS.Timeout | undefined;

  const fail = async (err: unknown) => { qp.hide(); await showError(err); };

  // Wait for a pause in typing: every search is a request against the user's Spotify quota.
  qp.onDidChangeValue(value => {
    clearTimeout(timer);
    const query = value.trim();
    const mine = ++latest;
    if (query.length < 2) { qp.items = []; qp.busy = false; return; }
    timer = setTimeout(async () => {
      qp.busy = true;
      try {
        const results = await web.search(query);
        if (mine === latest) qp.items = toItems(results);
      } catch (err) {
        if (mine === latest) await fail(err);
      } finally {
        if (mine === latest) qp.busy = false;
      }
    }, 400);
  });

  qp.onDidAccept(async () => {
    const r = qp.selectedItems[0]?.result;
    if (!r) return;
    qp.hide();
    try { await web.play(r); } catch (err) { await showError(err); }
    setTimeout(refresh, 500);
  });

  qp.onDidTriggerItemButton(async e => {
    const r = e.item.result;
    if (!r) return;
    try {
      await web.addToQueue(r);
      vscode.window.setStatusBarMessage(`$(check) Added "${r.name}" to the queue`, 4000);
    } catch (err) {
      await fail(err);
    }
  });

  qp.onDidHide(() => { clearTimeout(timer); latest++; qp.dispose(); });
  qp.show();
}
