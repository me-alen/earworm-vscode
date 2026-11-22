// The "Library" sidebar: queue, recently played, liked songs, playlists and saved albums.
// Lists load when a section is expanded, so a closed sidebar costs no Spotify quota.
import * as vscode from 'vscode';
import { SearchItem, SignInRequiredError, WebApi } from './webapi';

export interface Node {
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  item?: SearchItem;            // what Play / Add to Queue act on
  kind?: 'song' | 'collection'; // decides the inline button: + for songs, ▶ for playlists and albums
  clickToPlay?: boolean;
  children?: () => Promise<Node[]>;
  command?: vscode.Command;
}

const song = (s: SearchItem, icon = 'music', clickable = true): Node => ({
  label: s.name, description: s.by, tooltip: [s.name, s.by, s.detail].filter(Boolean).join('\n'),
  icon, item: s, kind: clickable ? 'song' : undefined, clickToPlay: clickable,
});

const empty = (nodes: Node[], text: string): Node[] => (nodes.length ? nodes : [{ label: text }]);

export class Library implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly queue: Node;
  private readonly liked: Node;
  private readonly roots: Node[];

  constructor(web: WebApi) {
    this.queue = {
      label: 'Queue', icon: 'list-ordered',
      // The Web API cannot jump to a queued song, so queue entries are not clickable.
      children: async () => {
        const q = await web.queue();
        return empty([
          ...(q.now ? [{ ...song(q.now, 'play', false), description: `now playing · ${q.now.by}` }] : []),
          ...q.next.map(s => song(s, 'music', false)),
        ], 'Nothing is queued');
      },
    };
    this.liked = { label: 'Liked Songs', icon: 'heart', children: async () => empty((await web.likedSongs()).map(s => song(s)), 'No liked songs') };
    this.roots = [
      this.queue,
      { label: 'Recently Played', icon: 'history', children: async () => empty((await web.recentlyPlayed()).map(s => song(s)), 'Nothing played yet') },
      this.liked,
      {
        label: 'Playlists', icon: 'list-unordered',
        children: async () => empty((await web.playlists()).map(p => ({
          label: p.name, description: [p.by, p.detail].filter(Boolean).join(' · '), icon: 'list-unordered',
          item: p, kind: 'collection',
          tooltip: p.readable ? undefined : 'Spotify only lists the songs of playlists you own or collaborate on. Click to play it.',
          clickToPlay: !p.readable,
          children: p.readable ? async () => empty((await web.playlistSongs(p)).map(s => song(s)), 'This playlist is empty') : undefined,
        })), 'No playlists'),
      },
      {
        label: 'Albums', icon: 'record',
        children: async () => empty((await web.albums()).map(a => ({
          label: a.name, description: [a.by, a.detail].filter(Boolean).join(' · '), icon: 'record',
          item: a, kind: 'collection',
          children: async () => a.songs.map(s => song(s)),
        })), 'No saved albums'),
      },
    ];
  }

  refresh() { this.changed.fire(undefined); }
  refreshQueue() { this.changed.fire(this.queue); }
  refreshLiked() { this.changed.fire(this.liked); }

  getTreeItem(n: Node): vscode.TreeItem {
    const t = new vscode.TreeItem(n.label, n.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    t.description = n.description;
    t.tooltip = n.tooltip;
    if (n.icon) t.iconPath = new vscode.ThemeIcon(n.icon);
    t.contextValue = n.kind;
    t.command = n.command ?? (n.clickToPlay ? { command: 'earworm.playItem', title: 'Play', arguments: [n] } : undefined);
    t.accessibilityInformation = { label: [n.label, n.description].filter(Boolean).join(', ') };
    return t;
  }

  async getChildren(n?: Node): Promise<Node[]> {
    if (!n) return this.roots;
    try {
      return await n.children!();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return err instanceof SignInRequiredError
        ? [{ label: 'Sign in to Spotify', tooltip: message, icon: 'account', command: { command: 'earworm.signIn', title: 'Sign In' } }]
        : [{ label: message, tooltip: message, icon: 'warning' }];
    }
  }
}
