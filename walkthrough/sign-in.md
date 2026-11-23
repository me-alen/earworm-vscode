# Sign in

1. On your app's page in the Spotify dashboard, copy the **Client ID**: 32 letters and digits.
2. Click **Paste Client ID** here and paste it.
3. Your browser opens Spotify's sign-in page. Approve it, then come back to VS Code.

The Client ID is not a secret. Earworm signs in with PKCE, so there is no client secret and no server of ours in between. Your sign-in is kept only in VS Code's secret storage. **Earworm: Sign Out of Spotify** deletes it and switches back to the Spotify app on this computer.

## If it doesn't work

- **"Invalid redirect URI"** in the browser: the redirect URI in your app's settings must be exactly `http://127.0.0.1:43117/callback`. Click **Add**, then **Save**.
- **Setting it up for someone else?** While your app is in development mode, Spotify lets only you and people you add use it. Add their Spotify email under **User Management** in the app's settings (up to 5 people), or have them create their own app.
- **Port 43117 is in use:** Earworm says so. Close whatever is using it and sign in again.
