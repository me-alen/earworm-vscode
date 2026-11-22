# Contributing to Earworm

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or asking for a feature
Open an issue. For a bug, say which OS you are on, whether Earworm is in local or Web API mode
(`earworm.mode`), what you did and what happened. Never paste your Spotify tokens or your
Client ID's sign-in URL.

## Making a change
1. Fork this repository and create a branch from `main` in your fork.
2. Set up and run the tests:
   ```bash
   npm install
   npm test
   ```
   Press F5 in VS Code to try your change in a window with the extension loaded.
3. Keep the change focused on one thing, and add or update tests for new behaviour. Tests use
   Node's built-in runner (`node:test`) and run without Spotify: see `test/` for the fakes.
4. Open a pull request to `main` and describe what changed and how you checked it.

CI runs the tests on Ubuntu 22.04, Ubuntu 24.04 and Windows. For a first-time contributor it
starts once the maintainer approves the run. A pull request is merged only by the maintainer,
once CI passes.

## Things to know
- **Platforms:** local control is AppleScript on macOS (`src/macos.ts`), MPRIS over D-Bus on
  Linux (`src/linux.ts`) and the Windows media controls through a PowerShell helper
  (`src/windows.ts`, `scripts/windows-host.ps1`). Web API mode is `src/webapi.ts`.
- **Spotify's rules:** the name must not contain "Spotify" (their branding guidelines), and Web
  API features must work for development-mode apps (5 users, Premium owner, limited endpoints).
- **Releases** are made by the maintainer by pushing a version tag; you do not need to change
  the version number or the changelog in your pull request.

By contributing, you agree that your contribution is licensed under the MIT License.
