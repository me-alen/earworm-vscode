# Changelog

## 0.4.0 (2026-11-22)

- In Web API mode, playback controls and the status bar now fall back to the Spotify app on this computer when the Web API cannot be used: quota used up, rate limited, no Premium, or no internet. Earworm says why once, and goes back to the Web API as soon as it works.

## 0.3.0 (2026-11-22)

- Like or unlike the song playing now: a heart in the status bar, or **Earworm: Like/Unlike Current Song**. Needs Web API sign-in and works in either mode. If you signed in before, Earworm asks you to sign in once more to allow saving songs.

## 0.2.0 (2026-11-22)

- A progress bar in the status bar shows how far into the song you are, in local mode on macOS, Linux and Windows, and in Web API mode.

## 0.1.1 (2026-11-22)

- Adds this changelog. No changes to the extension itself.

## 0.1.0 (2026-11-22)

First release.

### Local mode (no sign-in, works with Spotify Free)
- Controls the Spotify desktop app on macOS, Linux and Windows.
- Status bar shows the current song with previous, play/pause and next buttons.
- Commands for play/pause, next, previous, volume up/down, mute, shuffle, repeat and opening Spotify.

### Web API mode (your own Spotify developer app, Spotify Premium)
- Controls Spotify on any of your devices: computer, phone, speaker or TV.
- Sign-in with your own Client ID. No client secret, and tokens stay in VS Code's secret storage.
- **Search Spotify:** search songs, albums and playlists as you type. Play the result or add a song to the queue.
- **Choose Spotify Device:** move playback to another Spotify Connect device.
- **Library sidebar:** your queue, recently played, liked songs, playlists and saved albums.
