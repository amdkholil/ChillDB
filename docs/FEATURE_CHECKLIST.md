# Roadmap & Checklist Fitur Database Client (ChillDB)

Dokumen checklist kebutuhan fitur database client modern untuk memandu pengembangan ChillDB.

---

## 1. Konektivitas & Driver DBMS
- [x] PostgreSQL support
- [x] MySQL / MariaDB support
- [ ] SQLite support (local file `.db`, `.sqlite`)
- [ ] Redis support (key-value browser)
- [ ] Microsoft SQL Server (MSSQL) support
- [ ] MongoDB support (NoSQL document viewer)
- [x] SSH Tunnel (Bastion host via Password / Key)
- [ ] SSL / TLS Mode selector (Disable, Require, Verify-CA, Verify-Full)
- [ ] Connection URL / URI import (e.g., `postgres://user:pass@host:port/db`)
- [ ] Connection Grouping / Tagging / Color Coding (Prod, Staging, Dev badge)
- [x] Test connection
- [x] Multi-database switching pada koneksi aktif
- [x] Keep-alive / Reconnect otomatis saat koneksi putus

---

## 2. Keamanan & Manajemen Kredensial
- [x] Simpan profil tanpa password plaintext
- [x] Integrasi OS Keyring (GNOME Keyring, KWallet, Windows Credential Manager, macOS Keychain)
- [x] Auto-purge kredensial saat profil dihapus
- [ ] Enkripsi cadangan profil (Master Password / Passphrase untuk export config)
- [ ] Read-only connection mode (mencegah query DML/DDL tidak sengaja pada Production)
- [x] Proteksi SQL Injection (identifier quoting & parameterized/escaped literals)
- [x] Konfirmasi proteksi aksi destruktif (DROP, TRUNCATE, DELETE)

---

## 3. Navigasi & Introspeksi Skema (Sidebar)
- [x] Daftar Database
- [x] Daftar Skema (PostgreSQL)
- [x] Daftar Tabel & View
- [x] Tombol Refresh di setiap Database / Skema / Tabel (Live reload skema & objek tanpa reconnect)
- [x] Pencarian tabel cepat (Quick Search)
- [ ] Filter / Grouping tabel berdasarkan prefix atau tag
- [x] Introspeksi Tipe Enum kustom
- [ ] Daftar Stored Procedures / Functions
- [ ] Daftar Triggers
- [ ] Daftar Indexes
- [ ] Visualizer Relasi Tabel / Schema ERD Diagram

---

## 4. Data Browser & Editor (Table View)
- [x] Paginasi tabel
- [x] Auto-sort berdasarkan Primary Key
- [x] Multi-column manual sorting (klik header tabel ASC / DESC)
- [x] Filter data dinamis via UI (WHERE builder tanpa nulis query)
- [x] Quick Search / Highlight data di dalam grid
- [x] Inline cell editing
- [x] Insert record / row baru
- [x] Delete record dengan konfirmasi
- [ ] Batch edit / Multi-row selection & bulk delete
- [ ] JSON / XML Viewer terintegrasi pada cell dengan format panjang
- [ ] Foreign Key navigation (klik nilai ID untuk lompat ke record tabel relasi)
- [ ] Binary / BLOB / Image preview di cell
- [ ] Pengaturan visibilitas dan urutan kolom (Hide / Reorder columns)

---

## 5. SQL Runner & Query Editor
- [x] Eksekusi single query
- [ ] Multiple statement execution (menjalankan banyak query berurutan / delimiter `;`)
- [ ] Run selected query text only (eksekusi teks yang diblok saja)
- [ ] Syntax highlighting & SQL autocomplete / IntelliSense (skema, tabel, kolom, keyword)
- [ ] Multiple query tabs (tabbed editor)
- [ ] Format / Beautify SQL query
- [ ] Query Execution Plan (EXPLAIN / EXPLAIN ANALYZE visual)
- [ ] Riwayat query (Query History) & Bookmark / Saved Queries
- [ ] Cancel running query (abort query berjalan)
- [x] Pesan error query interaktif dan terarah

---

## 6. DDL & Manajemen Struktur (Schema Designer)
- [x] Create Database
- [x] Drop Database
- [x] Rename Database
- [x] Create Schema
- [x] Drop Schema
- [x] Create Table GUI
- [x] Rename Table
- [x] Truncate Table
- [x] Drop Table
- [x] Add Column
- [x] Edit Column (Ubah nama, tipe, default value, nullable)
- [x] Drop Column
- [ ] GUI Manajemen Index (Create, Drop, Index Type)
- [ ] GUI Manajemen Foreign Key & Constraints (Unique, Check)
- [ ] Generator DDL script ("Show Create Table" / "Generate DDL")

---

## 7. Import & Export Data
- [ ] Export hasil query / tabel ke CSV
- [ ] Export ke format JSON
- [ ] Export ke SQL Dump (`INSERT` statements / DDL dump)
- [ ] Export ke Excel (`.xlsx`)
- [ ] Import data dari file CSV ke tabel
- [ ] Import data dari file SQL script
- [ ] Copy selected rows sebagai CSV / Markdown table / JSON ke clipboard

---

## 8. UX, Kinerja & Sistem
- [x] Tauri native desktop app (Resource hemat & ringan)
- [ ] Multiple window support / Detachable tabs
- [ ] Keyboard shortcuts lengkap (Run query `Ctrl+Enter`, New tab `Ctrl+T`, Search `Ctrl+P`)
- [ ] Tema gelap & terang (Dark / Light Theme toggle)
- [x] Auto-updater tersertifikasi (Signed binary update)
- [x] Error reporting (Discord webhook opsional)
- [ ] Profil Export & Import (migrasi antar perangkat tanpa membawa secret)
- [ ] Log query & audit log aplikasi
