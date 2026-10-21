# Changelog

All notable changes to ChillDB are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-10-21

### Added

- Automatic update checks on startup and a manual **Updates** button, with
  signed downloads, progress feedback, and relaunch after installing.

### Security

- Update artifacts are signed with a Tauri minisign key. The private key is
  stored only in GitHub Actions secrets.

## [0.3.0] - 2026-10-20

### Added

- Sidebar table search for the active connection's current database, with
  keyboard navigation to open a result.

## [0.2.0] - 2026-10-20

### Added

- Row add, edit, and delete actions in table tabs, with NULL controls,
  read-only primary keys, and confirmation before deleting.
- Opt-in **Save password** checkbox that stores database and SSH secrets in the
  OS credential store, so saved connections open without a password prompt.
- Inline cell editing: double-click a table cell, then press Enter or click away
  to save, or Escape to cancel.
- Table right-click menu with **Structure**, **Truncate**, and **Delete**
  actions, including confirmation for destructive operations.
- Schema right-click menu with **Delete**, including confirmation for
  destructive operations.
- Structure tab with table rename, table truncation, field add/edit/delete, and
  per-field actions.
- **New table** action beside every schema/database and **New database** action
  beside the database count in the sidebar.
- PostgreSQL **New schema** action beside every database name. Creating a
  schema in another database opens a short-lived connection to it.
- PostgreSQL database names in the sidebar are clickable to switch the active
  connection to that database.
- PostgreSQL schemas and tables are nested under the database, matching the
  MySQL/MariaDB sidebar hierarchy.
- Optional Discord error notifications through a locally configured webhook,
  with duplicate throttling and truncated messages.
- JSON and text fields use resizable textareas in the row add/edit modal.
- MySQL/MariaDB **enum** column type with a comma-separated value list in the
  field and new-table editors.
- PostgreSQL enum types are listed in the column type picker.
- Engine-specific data type dropdowns when adding fields or creating tables.
- **New table** now opens in its own tab with a dynamic column builder,
  including defaults, nullable, and primary key options.
- Default values can be set or changed when adding and editing fields in the
  structure tab.

### Changed

- Moved table pagination controls to a bottom bar below the data grid.
- Moved row editing to the **Edit in modal** item in the row right-click menu.

### Fixed

- MySQL table previews failed when `COUNT(*)` was returned as signed `BIGINT`.
- MySQL `TIMESTAMP` columns displayed `<TIMESTAMP>` instead of a date and time.
- The SSH tunnel section in the connection form now uses the full form width.

### Removed

- Sidebar buttons for creating, renaming, and dropping databases and tables,
  which were not wired to the backend yet.

## [0.1.0] - 2026-10-20

### Added

- Tauri 2 desktop application for PostgreSQL and MySQL/MariaDB.
- Connection profiles with optional SSL/TLS, stored without passwords.
- Schema and table browser with table previews.
- Server-side pagination for table data (100, 200, 500, or 1000 rows per page).
- SQL editor with query history and per-statement timing.
- SSH tunnels with password or private-key authentication and optional host-key verification.
- Backend commands for row create, update, and delete using primary keys.
- Backend commands for table and database create, rename, and drop operations.
- Linux and Windows release workflow using GitHub Actions and Tauri Action.
