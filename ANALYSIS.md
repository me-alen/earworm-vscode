# Analysis

Researched 2026-11-17.

## 1. Why the old extension is stuck

`shyykoserhiy.vscode-spotify` v3.2.1 (TypeScript, 617 stars):

- Last commit 2023-01-06. 89 open issues. The repo is not archived, but nobody maintains it.
- Commands: play/pause, next/previous, volume and mute, shuffle, repeat, seek, lyrics,
  sign in/out, and loading playlists, albums and tracks.
- It controlled the desktop app through the OS on macOS (AppleScript) and Linux (D-Bus and
  `pactl`). On **Windows it used only the Web API, so it needed Premium** there. Playlists and
  tracks always went through the Web API, all behind **one shared Client ID**.
- On Linux, shuffle and repeat could only be displayed, not toggled.

A shared Client ID can no longer work for a public extension, because of the Spotify changes
below.

## 2. The Spotify platform constraints that shape the design

| Constraint | Effect on us |
|---|---|
| Development Mode allows **5 users per app** and the app owner needs **Premium** (Feb 2026) | One shared Client ID would serve 5 people. |
| Extended quota requires a registered business with **250k MAU** (since May 2025) | Not reachable for an indie extension. |
| Quota is counted **per developer account**; up to 25 Client IDs per account (Jul 2026) | Each user's own Client ID gets its own quota. |
| A 429 response body with `"reason": "QUOTA_EXCEEDED"` means quota, not rate limit | These need different messages and backoff. |
| Playback-control endpoints (play, pause, seek, queue, transfer) need **Premium** | Free users can browse but not control playback through the API. |
| Removed or restricted for dev-mode apps: recommendations, audio features, related artists, artist top tracks, new releases, bulk track lookups, popularity and follower counts | Do not build features on these. |
| Redirect URIs must be HTTPS or a loopback IP (`127.0.0.1`), not `localhost` | Use a loopback listener for OAuth. |
| Web Playback SDK needs Widevine DRM, which VS Code's Electron does not ship | Audio cannot play inside VS Code. We control a player; we are not one. |
| No public lyrics API | Use LRCLIB (free, has synced lyrics) or leave lyrics out. |

## 3. The design that follows from this: two backends

**Local mode (the default, no sign-in).** Control the Spotify desktop app through the OS.
It works for Free accounts, needs no Client ID and uses no quota.

- macOS: AppleScript via `osascript`. Gives the track, artist, album, position, volume,
  shuffle and repeat, and all the controls.
- Linux: MPRIS over D-Bus (`dbus-send`, or `playerctl` if installed).
- Windows: PowerShell calling WinRT `GlobalSystemMediaTransportControlsSessionManager`.
  Gives now-playing and transport controls; volume and shuffle are limited.

**Web API mode (opt-in).** The user registers their own Spotify app and pastes in the Client
ID. Sign-in is PKCE with no backend server, and tokens go in VS Code `SecretStorage`. This
adds the library, search, queue, devices (Spotify Connect) and liking tracks. Controlling
any device, including phones and speakers, also needs Premium.

A guided setup flow is what makes bringing your own Client ID tolerable. It should open the
dashboard, show the exact redirect URI to paste, and check the result.

## 4. What it can do better than the old one

1. Works without signing in (local mode). The old one needed a sign-in for most features.
2. Stays usable after Spotify's 2025–2026 API changes, because each user brings their own Client ID.
3. Works in Remote SSH, WSL, Dev Containers and Codespaces: `extensionKind: ["ui"]` makes it
   run on the machine where Spotify runs.
4. Published to both the VS Code Marketplace and **Open VSX**, so it also reaches Cursor,
   VSCodium and Windsurf.
5. Native VS Code UI: status bar, a sidebar tree, QuickPick search and a device picker, with
   one small webview at most.
6. Spotify Connect device switching, queue view, and add-to-queue from search.
7. Synced lyrics from LRCLIB.
8. Optional coding-flow features: pause when the window loses focus, or when a debug session
   starts.
9. Tests and CI from the first commit, which the old one never had.

## 5. Languages and tools

| Part | Choice | Why |
|---|---|---|
| Extension code | **TypeScript** on Node (the extension host) | VS Code APIs are TypeScript-first; it is the only realistic choice. |
| macOS control | AppleScript run through `osascript` | Built into macOS; no native module. |
| Linux control | D-Bus (MPRIS) through `dbus-send` | Present on every desktop distro. |
| Windows control | PowerShell + WinRT | Built into Windows 10 and 11; no native module. |
| Webview (now-playing, lyrics) | Plain TypeScript, HTML and CSS | One small view does not justify a framework. Add Preact later only if the UI grows. |
| Bundling | Plain `tsc` for now | With no runtime dependencies there is nothing to bundle. Add esbuild when the first one arrives. |
| Tests | `node:test` (built into Node) for the logic; `@vscode/test-electron` for integration later | No test framework to install. |
| CI and publishing | GitHub Actions, `@vscode/vsce`, `ovsx` | |

**No compiled native modules** (nothing built with `node-gyp`). They break across Electron
versions and platforms. Every OS integration is a shell-out to a tool the OS already has.

**No backend server.** PKCE needs no client secret, so there is nothing to host or pay for,
and no user data passes through us.

## Sources

- https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates
- https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/
- https://developer.spotify.com/documentation/web-api/concepts/quota-modes
- https://github.com/ShyykoSerhiy/vscode-spotify
