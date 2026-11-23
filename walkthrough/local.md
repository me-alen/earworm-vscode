# Earworm works with the Spotify app

Start a song in the Spotify app on this computer. Earworm shows it in the status bar, with previous, play/pause and next buttons and a progress bar. Click the song name to open Spotify.

No sign-in, and Spotify Free is fine.

| | What you need |
|---|---|
| macOS | Nothing. The first time, macOS asks whether VS Code may control Spotify: click **OK**. If you clicked **Don't Allow**, turn it on under System Settings → Privacy & Security → Automation. |
| Linux | `busctl` (systemd) and `pactl` (PulseAudio or PipeWire). Most desktops have both. |
| Windows 10 / 11 | Nothing. After opening Spotify, play something in it once so Windows knows about it. |

Every command is in the Command Palette under **Earworm**, and you can bind any of them to keys.
