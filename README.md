# Earworm

A VS Code extension for controlling Spotify while you code. It is meant to replace
`shyykoserhiy.vscode-spotify`, which has had no commits since January 2023 and has 89 open issues.

Status: **MVP, macOS, Linux and Windows, plus an optional Web API mode.** By default it
controls the Spotify desktop app directly, with no sign-in, so it works with Spotify Free.

| | macOS | Linux | Windows 10 / 11 |
|---|---|---|---|
| How | AppleScript (`osascript`) | MPRIS over D-Bus (`busctl`), volume through `pactl` | Windows media controls (SMTC), volume through the per-app volume mixer, both from one Windows PowerShell helper |
| Play/pause, next, previous, now playing | ✅ | ✅ | ✅ once Spotify has played something since it opened |
| Progress bar | ✅ | ✅ if Spotify reports its position over MPRIS | ✅ |
| Volume, mute | ✅ | ✅ while Spotify has an audio stream (start playback first) | ✅ while Spotify has an audio stream; changes Spotify's slider in the volume mixer |
| Shuffle, repeat | ✅ | ⚠️ Spotify's Linux app has long ignored these from other apps; Earworm tries, then tells you if it didn't take | ⚠️ Earworm asks Windows; if Spotify refuses, it tells you |
| Needs | nothing extra | `busctl` (systemd) and `pactl` (PulseAudio or PipeWire) | nothing extra (Windows PowerShell ships with Windows) |

## What works
- Status bar: previous / play-pause / next buttons, the current track (click it to open Spotify)
  and a progress bar (`1:23 ━━━━────── 3:45`). Right-click the status bar to hide any of them.
- Commands (search "Earworm" in the command palette, bind any of them to keys): Play/Pause,
  Next, Previous, Volume Up/Down, Mute/Unmute, Toggle Shuffle, Toggle Repeat, Open Spotify,
  Set Up Spotify Web API, Sign In to Spotify, Sign Out of Spotify, Search Spotify, Choose Spotify Device, Refresh Library
- Settings: `earworm.mode` (`local` or `webApi`), `earworm.clientId`, `earworm.refreshInterval`
  (seconds, default 2; at least 5 in Web API mode), `earworm.showButtons`, `earworm.volumeStep`
- Polling stops while the VS Code window is not focused

The first time it runs, macOS asks whether VS Code may control Spotify. Allow it, or later
under System Settings → Privacy & Security → Automation.

## Web API mode (optional)
Controls Spotify on any of your devices (phone, speaker, web player, another computer) through
the Spotify Web API, and also works on operating systems without local control. It needs
**Spotify Premium** and your **own Spotify developer app**: since 2026 Spotify allows only 5 users
per app, so Earworm cannot ship a shared one.

Run **Earworm: Set Up Spotify Web API** and follow the steps:
1. In the [Spotify dashboard](https://developer.spotify.com/dashboard), create an app and tick "Web API".
2. Add the redirect URI `http://127.0.0.1/callback` (Earworm copies it for you). No port is
   needed: Spotify accepts any port for loopback addresses, and Earworm picks a free one.
3. Paste the app's Client ID into Earworm, then approve the sign-in in your browser.

Sign-in uses PKCE, so there is no client secret and no server of ours in between. Tokens are kept
only in VS Code's secret storage. **Sign Out of Spotify** deletes them and returns to local mode.
If your app's quota runs out, Earworm says so and waits before trying again.

**Earworm: Search Spotify** (Web API mode) searches songs, albums and playlists as you type.
Enter plays the result: a song plays within its album, so playback carries on after it. The
**+** button next to a song adds it to the queue and keeps the search open for more. Spotify
returns at most 10 results of each kind to apps like this one. If no device is playing but only
one is available (say, the desktop app sitting idle), Earworm plays on that one.

**Earworm: Choose Spotify Device** (Web API mode) lists your Spotify Connect devices (computers,
phones, speakers, TVs) and moves playback to the one you pick. Playing stays playing and paused
stays paused. Devices that Spotify does not let other apps control are shown but cannot be picked.

**Library sidebar** (Web API mode): the Earworm icon in the activity bar opens your queue,
recently played, liked songs, playlists and saved albums. Click a song to play it within its
playlist, album or liked songs; the **+** button queues it. The ▶ button plays a whole playlist or
album. Each list loads when you open it and shows its first 50 entries. Spotify only lists the songs of
playlists you own or collaborate on; other playlists can still be played. If you signed in before
the library existed, Earworm asks you to sign in once more to allow the extra permissions.

## Develop
```bash
npm install
npm test          # compiles and runs the unit tests
npm run package   # builds earworm-<version>.vsix
```
Press F5 in VS Code to open a window with the extension loaded.

## Name
The name has no "Spotify" in it because Spotify's branding guidelines do not allow it in a
third-party product name.

## License
MIT
