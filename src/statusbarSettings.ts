// Two ways to choose what Earworm shows in the status bar, both writing the same settings
// (earworm.statusBar.items and earworm.statusBar.alignment): the "Status Bar" section of the
// Earworm sidebar, with a checkbox per item, and the "Earworm: Customize Status Bar" command.
import * as vscode from 'vscode';
import { STATUS_BAR_ITEMS, StatusBarKey, StatusBarShown } from './common';

const config = () => vscode.workspace.getConfiguration('earworm');
const KEYS = Object.keys(STATUS_BAR_ITEMS) as StatusBarKey[];
const onRight = () => config().get('statusBar.alignment') === 'right';

async function save(items: Partial<StatusBarShown>, right?: boolean) {
  const current = config().inspect<Partial<StatusBarShown>>('statusBar.items')?.globalValue ?? {};
  await config().update('statusBar.items', { ...current, ...items }, vscode.ConfigurationTarget.Global);
  if (right !== undefined && right !== onRight()) {
    await config().update('statusBar.alignment', right ? 'right' : 'left', vscode.ConfigurationTarget.Global);
  }
}

type Node = { key: StatusBarKey } | { side: true };

export class StatusBarView implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly shown: () => StatusBarShown) {}

  refresh() { this.changed.fire(); }
  toggleSide() { return save({}, !onRight()); }

  register(): vscode.Disposable {
    const view = vscode.window.createTreeView('earworm.statusBar', { treeDataProvider: this });
    return vscode.Disposable.from(
      view,
      view.onDidChangeCheckboxState(e => save(Object.fromEntries(e.items.flatMap(([n, state]) =>
        'key' in n ? [[n.key, state === vscode.TreeItemCheckboxState.Checked]] : [])))),
    );
  }

  getChildren(n?: Node): Node[] {
    return n ? [] : [...KEYS.map(key => ({ key })), { side: true as const }];
  }

  getTreeItem(n: Node): vscode.TreeItem {
    if ('side' in n) {
      const t = new vscode.TreeItem('Side of the status bar');
      t.description = onRight() ? 'Right' : 'Left';
      t.iconPath = new vscode.ThemeIcon('arrow-swap');
      t.tooltip = 'Click to move Earworm to the other side of the status bar';
      t.command = { command: 'earworm.toggleStatusBarSide', title: 'Move to the Other Side' };
      return t;
    }
    const t = new vscode.TreeItem(STATUS_BAR_ITEMS[n.key]);
    t.checkboxState = this.shown()[n.key] ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
    if (n.key === 'progressWhenPaused') t.description = 'needs Progress bar';
    if (n.key === 'like') t.description = 'when signed in';
    return t;
  }
}

/** "Earworm: Customize Status Bar": the same choices as the sidebar, in one checkbox list. */
export async function customizeStatusBar(shown: StatusBarShown) {
  type Pick = vscode.QuickPickItem & { key?: StatusBarKey };
  const right: Pick = { label: 'Show Earworm on the right side of the status bar', picked: onRight() };
  const picked = await vscode.window.showQuickPick<Pick>([
    ...KEYS.map(key => ({ label: STATUS_BAR_ITEMS[key], key, picked: shown[key] })),
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    right,
  ], { canPickMany: true, title: 'Earworm: Customize Status Bar', placeHolder: 'Tick what to show in the status bar' });
  if (!picked) return;
  await save(Object.fromEntries(KEYS.map(key => [key, picked.some(p => p.key === key)])), picked.includes(right));
}
