# Web API mode is optional

It lets Earworm:

- control Spotify on any of your devices: phone, speaker, TV, web player, another computer
- search Spotify, show your library, and like songs
- work on systems where it can't reach the Spotify app directly

It needs **Spotify Premium** and your **own** Spotify developer app. Spotify allows only 5 users per app, so Earworm can't ship one app for everyone. Creating yours is free and takes a few minutes.

## Create the app

**Open Spotify Dashboard** copies the redirect URI to your clipboard, then opens the dashboard. Log in, click **Create app**, and fill in:

| Field | What to enter |
|---|---|
| App name | Anything, for example `Earworm` |
| App description | Anything, for example `Spotify in VS Code` |
| Redirect URIs | Paste `http://127.0.0.1:43117/callback` and click **Add** |
| Which APIs you plan to use | Tick **Web API** |

Accept the terms and click **Save**.
