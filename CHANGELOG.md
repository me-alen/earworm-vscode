# Changelog

## Unreleased

- **Earworm: Send Feedback** opens a short GitHub form with your Earworm version, editor, OS and mode filled in. Also in the Library's **…** menu and the walkthrough. Nothing is sent unless you submit it.
- After two weeks and ten songs, Earworm asks once whether you'd like to rate it or send feedback, and never again.

## 0.6.0 (2026-11-24)

- A **Get Started with Earworm** walkthrough: play from the Spotify app, choose what the status bar shows, then optionally create your Spotify app, sign in and open your library, one step at a time. VS Code opens it when you install Earworm, and the Library sidebar links to it.
- The icon is redrawn: the same equalizer, a little sharper.

## 0.5.0 (2026-11-22)

- Choose what Earworm shows in the status bar: previous, play/pause, next, song name, heart and progress bar, each on or off. Tick them in the new **Status Bar** section of the Earworm sidebar, run **Earworm: Customize Status Bar**, or use the `earworm.statusBar.items` setting.
- Put Earworm on the left or right side of the status bar (`earworm.statusBar.alignment`).
- The progress bar now hides while paused. Tick **Progress bar while paused** to keep it.
- `earworm.showButtons` is replaced by `earworm.statusBar.items`. If you had turned the buttons off, they stay off.

## 0.4.3 (2026-11-22)

- No changes to the extension. The first version published automatically to the VS Code Marketplace and Open VSX by GitHub Actions.

## 0.4.2 (2026-11-22)

- When Spotify refuses a command for what is playing (for example shuffle during autoplay or radio), Earworm now says so in plain words instead of "Restriction violated".

## 0.4.1 (2026-11-22)

- Web API sign-in now uses the redirect URI `http://127.0.0.1:43117/callback`. The Spotify dashboard rejects the portless `http://127.0.0.1/callback` that earlier versions asked for. If you already registered the old one, add the new one in your app's settings.
- The README has a Privacy section: Earworm collects nothing and talks only to Spotify.

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
