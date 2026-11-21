# Backbeat (working name)

A VS Code extension for controlling Spotify while you code. It is meant to replace
`shyykoserhiy.vscode-spotify`, which has had no commits since January 2023 and has 89 open issues.

Status: **MVP, macOS, Linux and Windows.** Controls the Spotify desktop app directly, with no
sign-in, so it works with Spotify Free.

| | macOS | Linux | Windows 10 / 11 |
|---|---|---|---|
| How | AppleScript (`osascript`) | MPRIS over D-Bus (`busctl`), volume through `pactl` | Windows media controls (SMTC), volume through the per-app volume mixer, both from one Windows PowerShell helper |
| Play/pause, next, previous, now playing | ✅ | ✅ | ✅ once Spotify has played something since it opened |
| Volume, mute | ✅ | ✅ while Spotify has an audio stream (start playback first) | ✅ while Spotify has an audio stream; changes Spotify's slider in the volume mixer |
| Shuffle, repeat | ✅ | ⚠️ Spotify's Linux app has long ignored these from other apps; Backbeat tries, then tells you if it didn't take | ⚠️ Backbeat asks Windows; if Spotify refuses, it tells you |
| Needs | nothing extra | `busctl` (systemd) and `pactl` (PulseAudio or PipeWire) | nothing extra (Windows PowerShell ships with Windows) |

## What works
- Status bar: previous / play-pause / next buttons and the current track (click it to open Spotify)
- Commands (search "Backbeat" in the command palette, bind any of them to keys): Play/Pause,
  Next, Previous, Volume Up/Down, Mute/Unmute, Toggle Shuffle, Toggle Repeat, Open Spotify
- Settings: `backbeat.refreshInterval` (seconds, default 2), `backbeat.showButtons`, `backbeat.volumeStep`
- Polling stops while the VS Code window is not focused

The first time it runs, macOS asks whether VS Code may control Spotify. Allow it, or later
under System Settings → Privacy & Security → Automation.

## Develop
```bash
npm install
npm test          # compiles and runs the unit tests
npm run package   # builds backbeat-<version>.vsix
```
Press F5 in VS Code to open a window with the extension loaded.

## Docs
- [ANALYSIS.md](ANALYSIS.md): what is possible today, what is not, and which languages to use
- [REQUIREMENTS.md](REQUIREMENTS.md): the requirements list, with priorities

"Backbeat" is a placeholder. Spotify's branding guidelines do not allow "Spotify" in a
third-party product name, so the Marketplace name has to be something else.
