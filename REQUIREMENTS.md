# Requirements

Priority: **P0** = MVP (first release) · **P1** = v1.x · **P2** = later or nice to have.

## Functional

### Playback (local mode, no sign-in)
| ID | Requirement | Priority |
|---|---|---|
| F1 | Play/pause, next, previous from the command palette and keybindings | P0 |
| F2 | Status bar item showing track and artist, updated by polling (default every 2 s, configurable) | P0 |
| F3 | Status bar buttons for prev / play-pause / next, each one can be hidden | P0 |
| F4 | Volume up/down/mute, shuffle and repeat toggles (where the OS allows) | P0 |
| F5 | macOS through AppleScript, Linux through MPRIS D-Bus, Windows through WinRT SMTC | P0 |
| F6 | Clear message when the Spotify app is not running, with an action to launch it | P0 |
| F7 | Seek to a position | P1 |

### Web API mode (opt-in, user's own Client ID)
| ID | Requirement | Priority |
|---|---|---|
| F8 | Setup walkthrough: open the Spotify dashboard, show the redirect URI to copy, accept the Client ID, test the sign-in | P0 |
| F9 | PKCE sign-in through a loopback `127.0.0.1` listener; sign-out clears all tokens | P0 |
| F10 | Search tracks, albums and playlists in a QuickPick; play or add to queue | P1 |
| F11 | Sidebar tree: playlists, liked songs, albums, recently played, queue | P1 |
| F12 | Like/unlike the current track | P1 |
| F13 | Device picker that moves playback to another Spotify Connect device | P1 |
| F14 | Fall back to local mode for playback when the Web API cannot be used (no Premium, quota exceeded, offline) | P1 |

### Extras
| ID | Requirement | Priority |
|---|---|---|
| F15 | Now-playing webview with album art | P2 |
| F16 | Synced lyrics from LRCLIB; off by default because it sends the track name to a third party | P2 |
| F17 | Opt-in auto-pause when the window loses focus or a debug session starts | P2 |

## Non-functional
| ID | Requirement | Priority |
|---|---|---|
| N1 | `extensionKind: ["ui"]` so it works under Remote SSH, WSL, Dev Containers and Codespaces | P0 |
| N2 | Tokens only in `SecretStorage`; never in settings, logs or telemetry | P0 |
| N3 | No backend server, no telemetry | P0 |
| N4 | No compiled native modules; OS integration only through `osascript`, `dbus-send` and `powershell` | P0 |
| N5 | Treat a 429 with `QUOTA_EXCEEDED` differently from a rate limit: show the reason, back off, honour `Retry-After` | P0 |
| N6 | Activate on startup finished (`onStartupFinished`) and add < 50 ms to activation; stop polling when the window is unfocused | P0 |
| N7 | Every command reachable from the keyboard; status bar items have accessible labels | P0 |
| N8 | Unit tests for each backend's output parsing; CI on macOS, Linux and Windows | P0 |
| N9 | Publish to the VS Code Marketplace and Open VSX from CI | P0 |
| N10 | UI strings through `vscode.l10n` so they can be translated | P1 |
| N11 | Follow Spotify's Developer Terms and branding guidelines: no "Spotify" in the product name, Spotify attribution on displayed content, links back to Spotify | P0 |

## Out of scope
- Playing audio inside VS Code (needs Widevine, which VS Code does not have)
- Recommendations, audio features, related artists, top tracks (removed for dev-mode apps)
- A shared Client ID that we host (capped at 5 users)
- Spotify Free users controlling playback through the Web API (Spotify requires Premium)

## Open questions
1. The final product name.
2. ~~Which OS to build first?~~ Decided: macOS, then Linux, then Windows. All three are built.
3. Is LRCLIB acceptable for lyrics, or do we leave lyrics out?
