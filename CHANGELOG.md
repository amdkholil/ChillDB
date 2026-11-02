# Changelog

All notable changes to ChillDB are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-11-02

### Added
- Dukungan SSL/TLS Mode & Read-only connection:
  - Opsi koneksi baru: konfigurasi **SSL Mode** (`require`, `verify-ca`, `verify-full`, `disable`) dan **Read-only mode**.
  - Badge visual `SSL` (hijau) dan `RO` (merah) pada sidebar database profile dan header tab bar.
  - Proteksi query di backend Rust: memblokir query yang memodifikasi data (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, dll.) saat koneksi berstatus read-only.
- Smart Faker / Mock Data generator: tombol sparkle (`Fill fake data`) pada inline row insert dan modal insert untuk otomatis mengisi nilai contoh kontekstual cerdas sesuai nama kolom dan tipe datanya.
- Sidebar schema objects tree: dukungan introspeksi dan tampilan expandable untuk **Tables**, **Routines (Stored Procedures & Functions)**, **Triggers**, dan **Indexes** di sidebar untuk PostgreSQL dan MySQL/MariaDB.
- Compact column visibility & drag-and-drop reorder: lebar item kolom kini fit-to-text (`width: fit-content`), dilengkapi handle grip icon dan HTML5 drag-and-drop interaktif untuk mengatur urutan kolom secara langsung.
- Native date, time, datetime-local pickers, and enum dropdowns: input inline (grid) dan modal editor otomatis menyesuaikan tipe data kolom (`date`, `time`, `datetime`/`timestamp`, dan `enum`).
- Inline row insert: tombol **Add row** kini memunculkan baris input baru langsung di atas grid tabel (inline draft row) tanpa modal dialog, dengan shortcut `Ctrl+Enter` untuk simpan dan `Esc` untuk batal.
- JSON & XML Modal Viewer: tombol preview (`code` icon) pada cell data JSON, XML, atau teks panjang dengan formatted view (syntax indentation) dan tombol copy to clipboard.
- GitHub Actions CI & Release: support build target macOS (`macos-latest` menghasilkan bundle `.dmg` dan `.app`).
- Context menu tab bar: klik kanan pada sembarang tab untuk aksi **Close**, **Close other tabs**, **Close tabs to right**, **Close tabs to left**, dan **Close all tabs**.
- Index Management GUI in Structure view: list indexes with types (BTREE, HASH, GIN, GIST, BRIN, FULLTEXT, SPATIAL), create index form, and drop index.
- Constraints & Foreign Keys GUI in Structure view: list table constraints, create UNIQUE / CHECK / FOREIGN KEY constraints (with ON DELETE and ON UPDATE actions), and drop constraints.
- Export to SQL Dump: context menu klik kanan pada database/skema dan tabel untuk mengekspor DDL skema dan data (INSERT statements) langsung ke file `.sql`.
- Multi-row selection with checkboxes, Select All, and bulk delete capability.
- Foreign Key navigation: detect FKs in schema, display link indicators, and jump to related table records by clicking FK cell links.
- Columns customization toolbar: toggle visibility (hide/show) and reorder table columns.


## [1.0.0] - 2026-11-02

### Added
- Table quick search input for searching text across active table columns.
- Interactive WHERE filter builder toolbar with customizable conditions and operators.
- Multi-column sorting support with column header click / Shift-click toggle.
- Refresh buttons for databases, schemas, and table trees in the sidebar for live reloading.

### Removed
- Database type badge (PG/MY) from connection rows in the sidebar.

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
