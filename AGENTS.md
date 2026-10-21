# AGENTS.md

Universal instructions for coding agents working on ChillDB. This file is the
single source of truth for every agent and tool (Codex, Claude Code, Cursor,
Gemini, opencode, Copilot, and others). Read it before changing the repository.

## Project

ChillDB is a desktop SQL client for PostgreSQL and MySQL/MariaDB, built with
Tauri 2, Rust, vanilla TypeScript, and Vite. It is intentionally small: no
frontend framework and no ORM. Passwords are never written to profile files;
opt-in saved passwords live in the operating system credential store.

## Commands

| Task                  | Command                                              |
| --------------------- | ---------------------------------------------------- |
| Install dependencies  | `npm ci`                                             |
| Frontend build        | `npm run build`                                      |
| Rust check            | `cargo check --manifest-path src-tauri/Cargo.toml`   |
| Run the app           | `npm run tauri dev`                                  |
| Version consistency   | `npm run version:check`                              |
| Set the next version  | `npm run version:set -- X.Y.Z`                       |

There is no automated test suite yet. For behavior changes, run both build
commands and, when possible, launch the app and exercise the affected flow.

On Linux, the app can require an X11 backend:

```bash
GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 npm run tauri dev
```

## Architecture

- `src/main.ts` — application state, rendering, and event handling. It is a
  single-file vanilla TypeScript UI.
- `src/api.ts` — typed wrappers around Tauri `invoke` commands.
- `src/types.ts` — shared TypeScript contracts. Keep these in sync with Rust
  serde structs.
- `src/style.css` — all styling. Use existing CSS variables and components.
- `src-tauri/src/lib.rs` — Tauri app state, commands, and profile persistence.
- `src-tauri/src/db.rs` — connection handling, introspection, SQL execution,
  pagination, row CRUD, and DDL helpers.
- `src-tauri/src/ssh.rs` — SSH tunnel implementation using `ssh2`.
- `src-tauri/src/notify.rs` — optional Discord error notifications.
- `scripts/version.mjs` — release version and changelog enforcement.
- `.github/workflows/ci.yml` — build validation on pushes and pull requests.
- `.github/workflows/release.yml` — Linux and Windows release builds on tags.

Database profiles live outside the repository, at
`~/.local/share/io.chilldb.desktop/connections.json` (mode `0600`), and contain
no passwords.

## Coding Conventions

- Keep frontend code in vanilla TypeScript. Do not add React, Vue, or a state
  library.
- Keep user-facing UI text in English and make database errors actionable.
- Match the existing formatting: two-space indentation, double quotes, trailing
  commas, and semicolons.
- Add new backend commands in three places: the function in `db.rs`, the Tauri
  command in `lib.rs`, and the typed wrapper in `api.ts`. Register commands in
  `tauri::generate_handler!`.
- Use `[serde(rename_all = "camelCase")]` for payloads crossing the Tauri
  boundary and keep TypeScript interfaces aligned.
- Escape identifiers with the existing `quote_ident` helper and never
  interpolate unescaped user input into SQL.
- Preserve single-statement execution. Do not enable multi-statement queries
  without a deliberate design decision.
- Avoid adding dependencies unless the existing stack cannot solve the problem.
- Do not commit generated output: `dist/`, `node_modules/`, `src-tauri/target/`,
  or `src-tauri/gen/`.

## Updater

The updater uses `tauri-plugin-updater` with signed artifacts. The public key
lives in `src-tauri/tauri.conf.json`; the private key and its password are only
stored in the `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub Actions secrets. Never commit or log
either value. The local backup is `~/.config/chilldb/updater.key` with mode
`0600`; losing it prevents updates for existing installs.

Linux in-app updates only work for the AppImage build. `.deb` and `.rpm` users
must install newer releases manually. The updater endpoint is GitHub's
`releases/latest/download/latest.json`, so a release must be published before
clients can see it.

## Security Rules

- Never write database passwords, SSH passwords, or key passphrases to profile
  files, logs, or source. Secrets are session-only unless the user explicitly
  enables **Save password**; saved secrets must go through `secrets.rs` and the
  OS credential store (`keyring`).
- Deleting a profile or unchecking **Save password** must delete its stored
  credentials.
- Never log secrets or include them in error messages.
- The Discord error webhook URL is stored outside the repository at
  `~/.local/share/io.chilldb.desktop/discord-webhook` (mode `0600`) or supplied
  through `CHILLDB_DISCORD_WEBHOOK`. Never commit it or log it.
- Never commit credentials, `.env` files, private keys, or connection files.
- Treat SQL built for row editing as security-sensitive: values must go through
  `sql_literal`, identifiers through `quote_ident`.
- Destructive SQL (drop database, drop table, delete rows) requires explicit
  user confirmation in the UI.
- Do not run destructive commands against a user's database while testing.

## Release Policy (Mandatory)

Every release MUST update the version in all manifests and MUST include a
changelog entry. A tag that does not pass `npm run version:check` must not be
pushed.

The single source of truth is the version in `package.json`. The same version
must appear in:

- `package.json`
- `package-lock.json` (root and `packages[""].version`)
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock` (the `chilldb` package)
- `CHANGELOG.md` (a `## [X.Y.Z]` section with real notes, no `TODO:`)

Release procedure:

1. Choose the next semantic version (`MAJOR.MINOR.PATCH`).
2. Run `npm run version:set -- X.Y.Z`.
3. Replace the generated `TODO:` line in `CHANGELOG.md` with accurate notes
   under `Added`, `Changed`, `Fixed`, `Removed`, or `Security`.
4. Run `npm run version:check`.
5. Run `npm run build` and
   `cargo check --manifest-path src-tauri/Cargo.toml`.
6. Commit the version bump and changelog together, for example
   `Release vX.Y.Z`.
7. Create and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

Pushing a `v*` tag triggers `.github/workflows/release.yml`, validates the
version and changelog, builds Linux and Windows installers, and creates a draft
GitHub release. Update the draft release notes from `CHANGELOG.md`, then publish.

Never reuse or move a published tag. If a release is broken, bump the patch
version and release again.

## Agent Guardrails

- Only commit, amend, push, or tag when the user explicitly asks.
- Never force-push or rewrite shared history.
- Do not change git configuration.
- Keep diffs focused. Do not refactor unrelated code in the same change.
- Update `CHANGELOG.md` for user-visible changes, even before a release, under
  `## [Unreleased]`.
- Update `AGENTS.md` when commands, architecture, or release rules change.
- Report verification commands and their results in your final response.

## Known Limitations

- Database creation and table/column DDL are exposed from the sidebar; database
  rename/drop backend commands are not exposed in the UI yet.
- MySQL/MariaDB cannot rename a database; the backend returns an explicit error.
- PostgreSQL custom types, arrays, and intervals are displayed as `<TYPE>`.
- Automatic updates on Linux only support the AppImage build; `.deb` and
  `.rpm` installs require manual replacement.
- Table previews are paginated and ordered by primary key when one exists.
- Views are read-only in the table UI.
- The SQL runner executes a single statement per run.
- Saved passwords require an unlocked OS credential store (GNOME Keyring or
  KWallet on Linux, Credential Manager on Windows).
