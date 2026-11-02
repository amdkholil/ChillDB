# ChillDB - Dokumentasi Fitur

Dokumen inventarisasi fitur yang sudah tersedia di ChillDB.

---

## 1. Manajemen Koneksi & Profil
- **Dukungan DBMS**:
  - PostgreSQL
  - MySQL / MariaDB
- **SSH Tunneling**:
  - Dukungan koneksi via SSH Bastion/Tunnel (`ssh2`).
  - Autentikasi SSH: Password atau SSH Key / Passphrase.
- **Penyimpanan Profil**:
  - Profil disimpan di file lokal sistem (`~/.local/share/io.chilldb.desktop/connections.json`) dengan permission ketat (`0600`).
  - Profil tidak menyimpan password plaintext di dalam file konfigurasi.
- **Secure Credential Storage (Keyring)**:
  - Opsi simpan password database & SSH secret ke OS credential store (GNOME Keyring / KWallet di Linux, Windows Credential Manager di Windows, Apple Keychain di macOS).
  - Hapus kredensial otomatis saat opsi simpan dimatikan atau profil dihapus.
- **Manajemen Sesi**:
  - Test connection sebelum menyimpan.
  - Multi-database switching saat sesi aktif.
  - Disconnect sesi aktif.

---

## 2. Navigasi Objek Database (Sidebar & Introspection)
- **Database & Skema**:
  - List database dan list schema (PostgreSQL schemas / MySQL databases).
  - Deteksi tipe enum kustom (PostgreSQL).
- **Tabel & View**:
  - Listing tabel dan view per skema.
  - Fitur pencarian tabel secara cepat (`searchTables`).
  - Indikasi jenis objek (Table vs View).

---

## 3. Data Browser & Editor (Table View)
- **Pagination**:
  - Menampilkan data tabel per halaman (`tablePage`).
  - Sorting otomatis berdasarkan Primary Key jika ada.
- **CRUD Baris (Inline Data Editing)**:
  - **Insert Row**: Tambah baris baru dengan input typed cell.
  - **Update Row**: Edit nilai baris berdasarkan identifier kunci.
  - **Delete Row**: Hapus baris dengan konfirmasi.
- **Sanitasi SQL**:
  - Proteksi SQL injection pada operasi nilai baris (`sql_literal`) dan identifier (`quote_ident`).

---

## 4. Query Runner (SQL Editor)
- **Eksekusi SQL**:
  - Eksekusi kustom query SQL (single statement execution).
  - Tampilan hasil data dinamis: nama kolom, tipe kolom, dan total baris/eksekusi.
  - Penanganan error SQL informatif dan actionable langsung dari database engine.

---

## 5. DDL & Manajemen Struktur Database
- **Operasi Database**:
  - Create Database.
  - Drop Database.
  - Rename Database (didukung di PostgreSQL; error tertangani di MySQL/MariaDB).
- **Operasi Skema**:
  - Create Schema.
  - Drop Schema.
- **Operasi Tabel**:
  - Create Table (dengan konfigurasi kolom).
  - Rename Table.
  - Truncate Table.
  - Drop Table.
- **Operasi Kolom (Alter Table)**:
  - Add Column.
  - Edit Column (ubah tipe data/definisi kolom).
  - Drop Column.

---

## 6. Sistem & Keamanan
- **Auto-Updater**:
  - Integrasi `tauri-plugin-updater` dengan cryptographic signature verification.
- **Error Reporting**:
  - Integrasi opsional notifikasi Discord Webhook (`notify.rs`) untuk pelaporan runtime crash/error tanpa mengekspos kredensial rahasia.
- **Keamanan Ketat**:
  - Konfirmasi eksplisit UI untuk perintah destruktif (Drop DB, Drop Table, Truncate, Delete Row).
