use std::{sync::Arc, time::{Duration, Instant}};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{
    mysql::{MySqlPoolOptions, MySqlRow},
    postgres::{PgPoolOptions, PgRow},
    types::{
        chrono::{DateTime, Local, NaiveDate, NaiveDateTime, NaiveTime, Utc},
        BigDecimal, Json, Uuid,
    },
    Column, Executor, MySql, Pool, Postgres, Row, TypeInfo, ValueRef,
};
use url::Url;

use crate::ssh::SshTunnel;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbKind {
    Postgres,
    Mysql,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SshAuth {
    #[default]
    Password,
    Key,
}

fn default_ssh_port() -> u16 {
    22
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub kind: DbKind,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub database: String,
    #[serde(default)]
    pub ssl: bool,
    #[serde(default)]
    pub ssl_mode: String, // "disable" | "require" | "verify-ca" | "verify-full"
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub save_password: bool,
    #[serde(default)]
    pub ssh_enabled: bool,
    #[serde(default)]
    pub ssh_host: String,
    #[serde(default = "default_ssh_port")]
    pub ssh_port: u16,
    #[serde(default)]
    pub ssh_username: String,
    #[serde(default)]
    pub ssh_auth: SshAuth,
    #[serde(default)]
    pub ssh_key_path: String,
    #[serde(default = "default_true")]
    pub ssh_verify_host: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub kind: DbKind,
    pub database: String,
    pub server_version: String,
    pub ssl_enabled: bool,
    pub read_only: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub type_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<Value>>,
    pub rows_affected: Option<u64>,
    pub total_rows: Option<u64>,
    pub duration_ms: u64,
    pub statement: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortColumn {
    pub column: String,
    pub desc: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterCondition {
    pub column: String,
    pub op: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableColumn {
    pub name: String,
    pub type_name: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub primary_key: bool,
    pub auto_increment: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyRef {
    pub column: String,
    pub foreign_schema: String,
    pub foreign_table: String,
    pub foreign_column: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableIndex {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub primary: bool,
    pub index_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableConstraint {
    pub name: String,
    pub constraint_type: String, // PRIMARY KEY, UNIQUE, FOREIGN KEY, CHECK
    pub columns: Vec<String>,
    pub check_clause: Option<String>,
    pub foreign_schema: Option<String>,
    pub foreign_table: Option<String>,
    pub foreign_columns: Option<Vec<String>>,
    pub on_delete: Option<String>,
    pub on_update: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIndexInput {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub index_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConstraintInput {
    pub name: String,
    pub constraint_type: String, // UNIQUE, FOREIGN KEY, CHECK
    pub columns: Vec<String>,
    pub check_clause: Option<String>,
    pub foreign_schema: Option<String>,
    pub foreign_table: Option<String>,
    pub foreign_columns: Option<Vec<String>>,
    pub on_delete: Option<String>,
    pub on_update: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellInput {
    pub column: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewColumn {
    pub name: String,
    #[serde(default)]
    pub data_type: String,
    #[serde(default = "default_true")]
    pub nullable: bool,
    #[serde(default)]
    pub primary_key: bool,
    #[serde(default)]
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditColumn {
    pub name: String,
    #[serde(default)]
    pub new_name: String,
    #[serde(default)]
    pub data_type: String,
    #[serde(default = "default_true")]
    pub nullable: bool,
    #[serde(default)]
    pub default_value: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
    pub kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineInfo {
    pub schema: String,
    pub name: String,
    pub routine_type: String, // FUNCTION or PROCEDURE
    pub data_type: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerInfo {
    pub schema: String,
    pub name: String,
    pub table_name: String,
    pub event: String,
    pub timing: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaIndexInfo {
    pub schema: String,
    pub table_name: String,
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub primary: bool,
    pub index_type: String,
}

pub enum DbPool {
    Postgres(Pool<Postgres>),
    Mysql(Pool<MySql>),
}

impl DbPool {
    pub async fn close(&self) {
        match self {
            DbPool::Postgres(pool) => pool.close().await,
            DbPool::Mysql(pool) => pool.close().await,
        }
    }
}

pub struct Session {
    pub profile_id: String,
    pub kind: DbKind,
    pub database: String,
    pub server_version: String,
    pub pool: DbPool,
    pub target: Profile,
    password: String,
    _tunnel: Option<Arc<SshTunnel>>,
}

fn connection_url(profile: &Profile, password: &str) -> Result<String, String> {
    let scheme = match profile.kind {
        DbKind::Postgres => "postgres",
        DbKind::Mysql => "mysql",
    };

    let host = if profile.host.contains(':') && !profile.host.starts_with('[') {
        format!("[{}]", profile.host)
    } else {
        profile.host.clone()
    };
    let host = if host.is_empty() {
        "localhost".to_string()
    } else {
        host
    };

    let mut url = Url::parse(&format!("{}://{}", scheme, host))
        .map_err(|e| format!("Invalid host: {e}"))?;

    if profile.port > 0 {
        url.set_port(Some(profile.port))
            .map_err(|_| "Invalid port".to_string())?;
    }
    if !profile.username.is_empty() {
        url.set_username(&profile.username)
            .map_err(|_| "Invalid username".to_string())?;
    }
    if !password.is_empty() {
        url.set_password(Some(password))
            .map_err(|_| "Invalid password".to_string())?;
    }
    if !profile.database.is_empty() {
        url.path_segments_mut()
            .map_err(|_| "Invalid database name".to_string())?
            .clear()
            .push(&profile.database);
    }

    match profile.kind {
        DbKind::Postgres => {
            let mode = if !profile.ssl_mode.is_empty() {
                profile.ssl_mode.as_str()
            } else if profile.ssl {
                "require"
            } else {
                "disable"
            };
            url.query_pairs_mut().append_pair("sslmode", mode);
        }
        DbKind::Mysql => {
            let mode = if !profile.ssl_mode.is_empty() {
                match profile.ssl_mode.as_str() {
                    "disable" => "disabled",
                    "require" => "required",
                    "verify-ca" => "verify_ca",
                    "verify-full" => "verify_identity",
                    other => other,
                }
            } else if profile.ssl {
                "required"
            } else {
                "disabled"
            };
            url.query_pairs_mut().append_pair("ssl-mode", mode);
        }
    }

    Ok(url.to_string())
}

pub async fn connect(
    profile: &Profile,
    password: &str,
    ssh_secret: &str,
) -> Result<Session, String> {
    let tunnel = if profile.ssh_enabled {
        Some(Arc::new(SshTunnel::start(profile, ssh_secret)?))
    } else {
        None
    };

    let (host, port) = match &tunnel {
        Some(tunnel) => ("127.0.0.1".to_string(), tunnel.local_port),
        None => (profile.host.clone(), profile.port),
    };

    let mut target = profile.clone();
    target.host = host;
    target.port = port;

    let url = connection_url(&target, password)?;

    let (pool, version, database): (DbPool, String, String) = match profile.kind {
        DbKind::Postgres => {
            let pool = PgPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(Duration::from_secs(12))
                .connect(&url)
                .await
                .map_err(|e| friendly_error("PostgreSQL", e.to_string()))?;
            let version = sqlx::query_scalar::<_, String>("SELECT version()")
                .fetch_one(&pool)
                .await
                .unwrap_or_else(|_| "PostgreSQL".to_string());
            let database = sqlx::query_scalar::<_, String>("SELECT current_database()")
                .fetch_one(&pool)
                .await
                .unwrap_or_else(|_| profile.database.clone());
            (DbPool::Postgres(pool), version, database)
        }
        DbKind::Mysql => {
            let pool = MySqlPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(Duration::from_secs(12))
                .connect(&url)
                .await
                .map_err(|e| friendly_error("MySQL/MariaDB", e.to_string()))?;
            let version = sqlx::query_scalar::<_, String>("SELECT VERSION()")
                .fetch_one(&pool)
                .await
                .unwrap_or_else(|_| "MySQL/MariaDB".to_string());
            (DbPool::Mysql(pool), version, profile.database.clone())
        }
    };

    Ok(Session {
        profile_id: profile.id.clone(),
        kind: profile.kind,
        database,
        server_version: version,
        pool,
        target,
        password: password.to_string(),
        _tunnel: tunnel,
    })
}

pub async fn connect_database(session: &Session, database: &str) -> Result<Session, String> {
    let database = database.trim();
    if database.is_empty() {
        return Err("Database name is required.".to_string());
    }
    if session.kind != DbKind::Postgres {
        return Err("Switching databases is only supported for PostgreSQL.".to_string());
    }
    if database == session.database {
        return Err("This database is already open.".to_string());
    }

    let mut target = session.target.clone();
    target.database = database.to_string();
    let url = connection_url(&target, &session.password)?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(12))
        .connect(&url)
        .await
        .map_err(|e| format!("Could not open database \"{database}\": {e}"))?;
    let current = sqlx::query_scalar::<_, String>("SELECT current_database()")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|_| database.to_string());

    Ok(Session {
        profile_id: session.profile_id.clone(),
        kind: session.kind,
        database: current,
        server_version: session.server_version.clone(),
        pool: DbPool::Postgres(pool),
        target,
        password: session.password.clone(),
        _tunnel: session._tunnel.clone(),
    })
}

fn friendly_error(label: &str, message: String) -> String {
    if message.contains("password authentication failed")
        || message.contains("Access denied")
        || message.contains("authentication failed")
    {
        format!("{label}: authentication failed. Check your username and password.\n\n{message}")
    } else if message.contains("Connection refused")
        || message.contains("connection refused")
        || message.contains("tcp connect error")
    {
        format!("{label}: could not reach the server. Check the host and port.\n\n{message}")
    } else {
        format!("{label}: {message}")
    }
}

pub async fn list_schemas(session: &Session) -> Result<Vec<String>, String> {
    match &session.pool {
        DbPool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT schema_name::text AS schema_name
                 FROM information_schema.schemata
                 WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
                   AND schema_name NOT LIKE 'pg_toast%'
                   AND schema_name NOT LIKE 'pg_temp%'
                 ORDER BY schema_name",
            )
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.iter()
                .map(|row| row.try_get::<String, _>("schema_name").map_err(|e| e.to_string()))
                .collect()
        }
        DbPool::Mysql(pool) => {
            let rows = sqlx::query(
                "SELECT CONVERT(schema_name USING utf8mb4) AS schema_name
                 FROM information_schema.schemata
                 WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
                 ORDER BY schema_name",
            )
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.iter()
                .map(|row| row.try_get::<String, _>(0).map_err(|e| e.to_string()))
                .collect()
        }
    }
}

pub async fn list_enum_types(session: &Session) -> Result<Vec<String>, String> {
    match &session.pool {
        DbPool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT quote_ident(n.nspname) || '.' || quote_ident(t.typname) AS enum_name
                 FROM pg_type t
                 JOIN pg_enum e ON e.enumtypid = t.oid
                 JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND n.nspname NOT LIKE 'pg_toast%'
                 GROUP BY n.nspname, t.typname
                 ORDER BY enum_name",
            )
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
            rows.iter()
                .map(|row| row.try_get::<String, _>("enum_name").map_err(|e| e.to_string()))
                .collect()
        }
        DbPool::Mysql(_) => Ok(Vec::new()),
    }
}

pub async fn search_tables(
    session: &Session,
    query: &str,
) -> Result<Vec<TableInfo>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let pattern = format!("%{query}%");
    match &session.pool {
        DbPool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT table_schema::text AS table_schema,
                        table_name::text AS table_name,
                        table_type::text AS table_type
                 FROM information_schema.tables
                 WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                   AND table_schema NOT LIKE 'pg_toast%'
                   AND table_schema NOT LIKE 'pg_temp%'
                   AND table_name::text ILIKE $1
                 ORDER BY table_schema, table_name
                 LIMIT 100",
            )
            .bind(pattern)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
            rows.iter()
                .map(|row| {
                    Ok(TableInfo {
                        schema: row.try_get::<String, _>("table_schema").map_err(|e| e.to_string())?,
                        name: row.try_get::<String, _>("table_name").map_err(|e| e.to_string())?,
                        kind: row.try_get::<String, _>("table_type").map_err(|e| e.to_string())?,
                    })
                })
                .collect()
        }
        DbPool::Mysql(pool) => {
            let rows = sqlx::query(
                "SELECT CONVERT(table_schema USING utf8mb4) AS table_schema,
                        CONVERT(table_name USING utf8mb4) AS table_name,
                        CONVERT(table_type USING utf8mb4) AS table_type
                 FROM information_schema.tables
                 WHERE CONVERT(table_schema USING utf8mb4) = DATABASE()
                   AND CONVERT(table_name USING utf8mb4) LIKE ?
                 ORDER BY table_name
                 LIMIT 100",
            )
            .bind(pattern)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
            rows.iter()
                .map(|row| {
                    Ok(TableInfo {
                        schema: row.try_get::<String, _>(0).map_err(|e| e.to_string())?,
                        name: row.try_get::<String, _>(1).map_err(|e| e.to_string())?,
                        kind: row.try_get::<String, _>(2).map_err(|e| e.to_string())?,
                    })
                })
                .collect()
        }
    }
}

pub async fn list_routines(
    session: &Session,
    schema: &str,
) -> Result<Vec<RoutineInfo>, String> {
    match &session.pool {
        DbPool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT routine_name::text AS routine_name,
                        routine_type::text AS routine_type,
                        data_type::text AS data_type
                 FROM information_schema.routines
                 WHERE routine_schema::text = $1
                 ORDER BY routine_name",
            )
            .bind(schema)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.iter()
                .map(|row| {
                    Ok(RoutineInfo {
                        schema: schema.to_string(),
                        name: row.try_get("routine_name").map_err(|e| e.to_string())?,
                        routine_type: row.try_get("routine_type").map_err(|e| e.to_string())?,
                        data_type: row.try_get("data_type").ok(),
                    })
                })
                .collect()
        }
        DbPool::Mysql(pool) => {
            let rows = sqlx::query(
                "SELECT CONVERT(routine_name USING utf8mb4) AS routine_name,
                        CONVERT(routine_type USING utf8mb4) AS routine_type,
                        CONVERT(dtd_identifier USING utf8mb4) AS data_type
                 FROM information_schema.routines
                 WHERE routine_schema = ?
                 ORDER BY routine_name",
            )
            .bind(schema)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.iter()
                .map(|row| {
                    Ok(RoutineInfo {
                        schema: schema.to_string(),
                        name: row.try_get(0).map_err(|e| e.to_string())?,
                        routine_type: row.try_get(1).map_err(|e| e.to_string())?,
                        data_type: row.try_get(2).ok(),
                    })
                })
                .collect()
        }
    }
}

pub async fn list_triggers(
    session: &Session,
    schema: &str,
) -> Result<Vec<TriggerInfo>, String> {
    match &session.pool {
        DbPool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT trigger_name::text AS trigger_name,
                        event_object_table::text AS table_name,
                        event_manipulation::text AS event,
                        action_timing::text AS timing
                 FROM information_schema.triggers
                 WHERE trigger_schema::text = $1
                 ORDER BY trigger_name",
            )
            .bind(schema)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.iter()
                .map(|row| {
                    Ok(TriggerInfo {
                        schema: schema.to_string(),
                        name: row.try_get("trigger_name").map_err(|e| e.to_string())?,
                        table_name: row.try_get("table_name").map_err(|e| e.to_string())?,
                        event: row.try_get("event").map_err(|e| e.to_string())?,
                        timing: row.try_get("timing").map_err(|e| e.to_string())?,
                    })
                })
                .collect()
        }
        DbPool::Mysql(pool) => {
            let rows = sqlx::query(
                "SELECT CONVERT(trigger_name USING utf8mb4) AS trigger_name,
                        CONVERT(event_object_table USING utf8mb4) AS table_name,
                        CONVERT(event_manipulation USING utf8mb4) AS event,
                        CONVERT(action_timing USING utf8mb4) AS timing
                 FROM information_schema.triggers
                 WHERE trigger_schema = ?
                 ORDER BY trigger_name",
            )
            .bind(schema)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.iter()
                .map(|row| {
                    Ok(TriggerInfo {
                        schema: schema.to_string(),
                        name: row.try_get(0).map_err(|e| e.to_string())?,
                        table_name: row.try_get(1).map_err(|e| e.to_string())?,
                        event: row.try_get(2).map_err(|e| e.to_string())?,
                        timing: row.try_get(3).map_err(|e| e.to_string())?,
                    })
                })
                .collect()
        }
    }
}

pub async fn list_schema_indexes(
    session: &Session,
    schema: &str,
) -> Result<Vec<SchemaIndexInfo>, String> {
    match &session.pool {
        DbPool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT t.relname::text AS table_name,
                        i.relname::text AS index_name,
                        a.attname::text AS column_name,
                        ix.indisunique AS is_unique,
                        ix.indisprimary AS is_primary,
                        am.amname::text AS index_type
                 FROM pg_class t
                 JOIN pg_namespace n ON n.oid = t.relnamespace
                 JOIN pg_index ix ON t.oid = ix.indrelid
                 JOIN pg_class i ON i.oid = ix.indexrelid
                 JOIN pg_am am ON am.oid = i.relam
                 JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
                 WHERE n.nspname = $1 AND t.relkind IN ('r', 'm')
                 ORDER BY t.relname, i.relname, a.attnum",
            )
            .bind(schema)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            let mut map: std::collections::BTreeMap<(String, String), SchemaIndexInfo> = std::collections::BTreeMap::new();
            for r in rows {
                let table_name: String = r.try_get("table_name").map_err(|e| e.to_string())?;
                let index_name: String = r.try_get("index_name").map_err(|e| e.to_string())?;
                let col_name: String = r.try_get("column_name").map_err(|e| e.to_string())?;
                let is_unique: bool = r.try_get("is_unique").unwrap_or(false);
                let is_primary: bool = r.try_get("is_primary").unwrap_or(false);
                let index_type: String = r.try_get("index_type").unwrap_or_else(|_| "btree".to_string());

                let entry = map.entry((table_name.clone(), index_name.clone())).or_insert_with(|| SchemaIndexInfo {
                    schema: schema.to_string(),
                    table_name,
                    name: index_name,
                    columns: Vec::new(),
                    unique: is_unique,
                    primary: is_primary,
                    index_type,
                });
                if !entry.columns.contains(&col_name) {
                    entry.columns.push(col_name);
                }
            }
            Ok(map.into_values().collect())
        }
        DbPool::Mysql(pool) => {
            let rows = sqlx::query(
                "SELECT CONVERT(table_name USING utf8mb4) AS table_name,
                        CONVERT(index_name USING utf8mb4) AS index_name,
                        CONVERT(column_name USING utf8mb4) AS column_name,
                        non_unique,
                        CONVERT(index_type USING utf8mb4) AS index_type
                 FROM information_schema.statistics
                 WHERE table_schema = ?
                 ORDER BY table_name, index_name, seq_in_index",
            )
            .bind(schema)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            let mut map: std::collections::BTreeMap<(String, String), SchemaIndexInfo> = std::collections::BTreeMap::new();
            for r in rows {
                let table_name: String = r.try_get(0).map_err(|e| e.to_string())?;
                let index_name: String = r.try_get(1).map_err(|e| e.to_string())?;
                let col_name: String = r.try_get(2).map_err(|e| e.to_string())?;
                let non_unique: i64 = r.try_get(3).unwrap_or(1);
                let index_type: String = r.try_get(4).unwrap_or_else(|_| "BTREE".to_string());

                let is_primary = index_name.to_uppercase() == "PRIMARY";
                let is_unique = non_unique == 0;

                let entry = map.entry((table_name.clone(), index_name.clone())).or_insert_with(|| SchemaIndexInfo {
                    schema: schema.to_string(),
                    table_name,
                    name: index_name,
                    columns: Vec::new(),
                    unique: is_unique,
                    primary: is_primary,
                    index_type,
                });
                if !entry.columns.contains(&col_name) {
                    entry.columns.push(col_name);
                }
            }
            Ok(map.into_values().collect())
        }
    }
}

pub async fn list_tables(session: &Session, schema: &str) -> Result<Vec<TableInfo>, String> {
    match &session.pool {
        DbPool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT table_name::text AS table_name, table_type::text AS table_type
                 FROM information_schema.tables
                 WHERE table_schema::text = $1
                 ORDER BY table_name",
            )
            .bind(schema)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.iter()
                .map(|row| {
                    Ok(TableInfo {
                        schema: schema.to_string(),
                        name: row.try_get("table_name").map_err(|e| e.to_string())?,
                        kind: row.try_get("table_type").map_err(|e| e.to_string())?,
                    })
                })
                .collect()
        }
        DbPool::Mysql(pool) => {
            let rows = sqlx::query(
                "SELECT CONVERT(table_name USING utf8mb4) AS table_name,
                        CONVERT(table_type USING utf8mb4) AS table_type
                 FROM information_schema.tables
                 WHERE table_schema = ?
                 ORDER BY table_name",
            )
            .bind(schema)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.iter()
                .map(|row| {
                    Ok(TableInfo {
                        schema: schema.to_string(),
                        name: row.try_get(0).map_err(|e| e.to_string())?,
                        kind: row.try_get(1).map_err(|e| e.to_string())?,
                    })
                })
                .collect()
        }
    }
}

fn quote_ident(ident: &str, kind: DbKind) -> String {
    match kind {
        DbKind::Postgres => format!("\"{}\"", ident.replace('"', "\"\"")),
        DbKind::Mysql => format!("`{}`", ident.replace('`', "``")),
    }
}

fn qualified_name(schema: &str, table: &str, kind: DbKind) -> String {
    if schema.is_empty() {
        quote_ident(table, kind)
    } else {
        format!("{}.{}", quote_ident(schema, kind), quote_ident(table, kind))
    }
}

async fn primary_keys(
    session: &Session,
    schema: &str,
    table: &str,
) -> Result<Vec<String>, String> {
    match &session.pool {
        DbPool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT kcu.column_name::text AS column_name
                 FROM information_schema.table_constraints tc
                 JOIN information_schema.key_column_usage kcu
                   ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                  AND tc.table_name = kcu.table_name
                 WHERE tc.constraint_type = 'PRIMARY KEY'
                   AND tc.table_schema::text = $1
                   AND tc.table_name::text = $2
                 ORDER BY kcu.ordinal_position",
            )
            .bind(schema)
            .bind(table)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.iter()
                .map(|row| {
                    row.try_get::<String, _>("column_name")
                        .map_err(|e| e.to_string())
                })
                .collect()
        }
        DbPool::Mysql(pool) => {
            let rows = sqlx::query(
                "SELECT CONVERT(column_name USING utf8mb4) AS column_name
                 FROM information_schema.key_column_usage
                 WHERE table_schema = ?
                   AND table_name = ?
                   AND constraint_name = 'PRIMARY'
                 ORDER BY ordinal_position",
            )
            .bind(schema)
            .bind(table)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.iter()
                .map(|row| row.try_get::<String, _>(0).map_err(|e| e.to_string()))
                .collect()
        }
    }
}

async fn count_rows(
    session: &Session,
    qualified: &str,
    where_clause: &str,
) -> Result<u64, String> {
    let where_part = if where_clause.is_empty() {
        String::new()
    } else {
        format!(" WHERE {where_clause}")
    };
    match &session.pool {
        DbPool::Postgres(pool) => {
            let sql = format!("SELECT COUNT(*) FROM {qualified}{where_part}");
            sqlx::query_scalar::<_, i64>(&sql)
                .fetch_one(pool)
                .await
                .map(|n| n as u64)
                .map_err(|e| e.to_string())
        }
        DbPool::Mysql(pool) => {
            let sql = format!("SELECT CAST(COUNT(*) AS SIGNED) FROM {qualified}{where_part}");
            sqlx::query_scalar::<_, i64>(&sql)
                .fetch_one(pool)
                .await
                .map(|n| n.max(0) as u64)
                .map_err(|e| e.to_string())
        }
    }
}

pub async fn table_page(
    session: &Session,
    schema: &str,
    table: &str,
    page: i64,
    page_size: i64,
    sort: &[SortColumn],
    filters: &[FilterCondition],
    search: Option<&str>,
) -> Result<QueryResult, String> {
    let page = page.max(1);
    let page_size = page_size.clamp(1, 2000);
    let offset = (page - 1).saturating_mul(page_size);
    let qualified = qualified_name(schema, table, session.kind);

    let mut where_parts: Vec<String> = Vec::new();

    // 1. Where builder filters
    for f in filters {
        let col = quote_ident(&f.column, session.kind);
        let part = match f.op.to_uppercase().as_str() {
            "=" | "!=" | "<>" | "<" | "<=" | ">" | ">=" => {
                let val = sql_literal(&f.value, session.kind);
                format!("{col} {} {val}", f.op)
            }
            "LIKE" => {
                let pattern = format!("%{}%", f.value);
                let val = sql_literal(&pattern, session.kind);
                format!("{col} LIKE {val}")
            }
            "ILIKE" => {
                let pattern = format!("%{}%", f.value);
                let val = sql_literal(&pattern, session.kind);
                match session.kind {
                    DbKind::Postgres => format!("{col} ILIKE {val}"),
                    DbKind::Mysql => format!("LOWER({col}) LIKE LOWER({val})"),
                }
            }
            "STARTS_WITH" => {
                let pattern = format!("{}%", f.value);
                let val = sql_literal(&pattern, session.kind);
                format!("{col} LIKE {val}")
            }
            "ENDS_WITH" => {
                let pattern = format!("%{}", f.value);
                let val = sql_literal(&pattern, session.kind);
                format!("{col} LIKE {val}")
            }
            "IS NULL" => format!("{col} IS NULL"),
            "IS NOT NULL" => format!("{col} IS NOT NULL"),
            _ => continue,
        };
        where_parts.push(part);
    }

    // 2. Quick search across text/varchar/char/string columns
    if let Some(query) = search.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        let table_cols = describe_table(session, schema, table).await.unwrap_or_default();
        let pattern = format!("%{query}%");
        let val = sql_literal(&pattern, session.kind);
        let mut search_col_parts = Vec::new();

        for col in &table_cols {
            let t = col.type_name.to_lowercase();
            let is_textual = t.contains("char")
                || t.contains("text")
                || t.contains("json")
                || t == "uuid"
                || t == "name";
            if is_textual {
                let quoted_col = quote_ident(&col.name, session.kind);
                match session.kind {
                    DbKind::Postgres => search_col_parts.push(format!("{quoted_col}::text ILIKE {val}")),
                    DbKind::Mysql => search_col_parts.push(format!("LOWER(CAST({quoted_col} AS CHAR)) LIKE LOWER({val})")),
                }
            }
        }

        if !search_col_parts.is_empty() {
            where_parts.push(format!("({})", search_col_parts.join(" OR ")));
        }
    }

    let where_clause = if where_parts.is_empty() {
        String::new()
    } else {
        where_parts.join(" AND ")
    };

    let where_sql = if where_clause.is_empty() {
        String::new()
    } else {
        format!(" WHERE {where_clause}")
    };

    // 3. Sorting
    let order = if !sort.is_empty() {
        let clauses = sort
            .iter()
            .map(|s| {
                let col = quote_ident(&s.column, session.kind);
                let dir = if s.desc { "DESC" } else { "ASC" };
                format!("{col} {dir}")
            })
            .collect::<Vec<_>>()
            .join(", ");
        format!(" ORDER BY {clauses}")
    } else {
        let keys = primary_keys(session, schema, table).await?;
        if keys.is_empty() {
            String::new()
        } else {
            let columns = keys
                .iter()
                .map(|key| quote_ident(key, session.kind))
                .collect::<Vec<_>>()
                .join(", ");
            format!(" ORDER BY {columns}")
        }
    };

    let sql = format!("SELECT * FROM {qualified}{where_sql}{order} LIMIT {page_size} OFFSET {offset}");
    let mut result = execute(session, &sql).await?;
    result.total_rows = Some(count_rows(session, &qualified, &where_clause).await?);
    Ok(result)
}

pub async fn describe_table(
    session: &Session,
    schema: &str,
    table: &str,
) -> Result<Vec<TableColumn>, String> {
    match &session.pool {
        DbPool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT c.column_name::text AS column_name,
                        c.udt_name::text AS type_name,
                        c.is_nullable::text AS is_nullable,
                        c.column_default::text AS column_default,
                        c.is_identity::text AS is_identity,
                        pk.column_name::text AS pk_column
                 FROM information_schema.columns c
                 LEFT JOIN (
                     SELECT kcu.column_name, kcu.table_schema, kcu.table_name
                     FROM information_schema.table_constraints tc
                     JOIN information_schema.key_column_usage kcu
                       ON tc.constraint_name = kcu.constraint_name
                      AND tc.table_schema = kcu.table_schema
                      AND tc.table_name = kcu.table_name
                     WHERE tc.constraint_type = 'PRIMARY KEY'
                 ) pk
                   ON pk.column_name = c.column_name
                  AND pk.table_schema = c.table_schema
                  AND pk.table_name = c.table_name
                 WHERE c.table_schema::text = $1
                   AND c.table_name::text = $2
                 ORDER BY c.ordinal_position",
            )
            .bind(schema)
            .bind(table)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.iter()
                .map(|row| {
                    let default_value: Option<String> = row.try_get("column_default").ok();
                    let identity: String = row.try_get("is_identity").unwrap_or_default();
                    let auto_increment = identity == "YES"
                        || default_value
                            .as_deref()
                            .map(|value| value.starts_with("nextval("))
                            .unwrap_or(false);
                    Ok(TableColumn {
                        name: row.try_get("column_name").map_err(|e| e.to_string())?,
                        type_name: row.try_get("type_name").map_err(|e| e.to_string())?,
                        nullable: row
                            .try_get::<String, _>("is_nullable")
                            .map(|value| value == "YES")
                            .unwrap_or(true),
                        default_value,
                        primary_key: row
                            .try_get::<Option<String>, _>("pk_column")
                            .ok()
                            .flatten()
                            .is_some(),
                        auto_increment,
                    })
                })
                .collect()
        }
        DbPool::Mysql(pool) => {
            let rows = sqlx::query(
                "SELECT CONVERT(c.column_name USING utf8mb4) AS column_name,
                        CONVERT(c.column_type USING utf8mb4) AS type_name,
                        CONVERT(c.is_nullable USING utf8mb4) AS is_nullable,
                        CONVERT(c.column_default USING utf8mb4) AS column_default,
                        CONVERT(c.column_key USING utf8mb4) AS column_key,
                        CONVERT(c.extra USING utf8mb4) AS extra
                 FROM information_schema.columns c
                 WHERE c.table_schema = ?
                   AND c.table_name = ?
                 ORDER BY c.ordinal_position",
            )
            .bind(schema)
            .bind(table)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.iter()
                .map(|row| {
                    let key: String = row.try_get("column_key").unwrap_or_default();
                    let extra: String = row.try_get("extra").unwrap_or_default();
                    Ok(TableColumn {
                        name: row.try_get("column_name").map_err(|e| e.to_string())?,
                        type_name: row.try_get("type_name").map_err(|e| e.to_string())?,
                        nullable: row
                            .try_get::<String, _>("is_nullable")
                            .map(|value| value == "YES")
                            .unwrap_or(true),
                        default_value: row.try_get("column_default").ok(),
                        primary_key: key == "PRI",
                        auto_increment: extra.to_ascii_lowercase().contains("auto_increment"),
                    })
                })
                .collect()
        }
    }
}

pub async fn list_databases(session: &Session) -> Result<Vec<String>, String> {
    match &session.pool {
        DbPool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT datname::text AS datname
                 FROM pg_database
                 WHERE datistemplate = false AND datallowconn = true
                 ORDER BY datname",
            )
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
            rows.iter()
                .map(|row| row.try_get::<String, _>("datname").map_err(|e| e.to_string()))
                .collect()
        }
        DbPool::Mysql(pool) => {
            let rows = sqlx::query(
                "SELECT CONVERT(schema_name USING utf8mb4) AS schema_name
                 FROM information_schema.schemata
                 WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
                 ORDER BY schema_name",
            )
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
            rows.iter()
                .map(|row| row.try_get::<String, _>(0).map_err(|e| e.to_string()))
                .collect()
        }
    }
}

fn sql_literal(value: &str, kind: DbKind) -> String {
    match kind {
        DbKind::Postgres => format!("'{}'", value.replace('\'', "''")),
        DbKind::Mysql => {
            let escaped = value
                .replace('\\', "\\\\")
                .replace('\'', "''")
                .replace('\0', "\\0")
                .replace('\n', "\\n")
                .replace('\r', "\\r")
                .replace('\x1a', "\\Z");
            format!("'{escaped}'")
        }
    }
}

fn cell_literal(cell: &CellInput, kind: DbKind) -> String {
    match &cell.value {
        None => "NULL".to_string(),
        Some(value) => sql_literal(value, kind),
    }
}

async fn require_primary_key(
    session: &Session,
    schema: &str,
    table: &str,
    keys: &[CellInput],
) -> Result<(), String> {
    let primary = primary_keys(session, schema, table).await?;
    if primary.is_empty() {
        return Err("This table has no primary key, so the row cannot be matched safely."
            .to_string());
    }
    if keys.is_empty() {
        return Err("The primary key values are missing.".to_string());
    }

    let mut expected: Vec<&String> = primary.iter().collect();
    let mut provided: Vec<&String> = keys.iter().map(|key| &key.column).collect();
    expected.sort();
    provided.sort();
    provided.dedup();
    if expected != provided {
        return Err(format!(
            "Provide values for all primary key columns: {}.",
            primary.join(", ")
        ));
    }
    Ok(())
}

pub async fn insert_row(
    session: &Session,
    schema: &str,
    table: &str,
    cells: &[CellInput],
) -> Result<QueryResult, String> {
    if session.target.read_only {
        return Err("Database connection is in READ-ONLY mode. Modifications are blocked.".to_string());
    }
    let qualified = qualified_name(schema, table, session.kind);
    let sql = if cells.is_empty() {
        match session.kind {
            DbKind::Postgres => format!("INSERT INTO {qualified} DEFAULT VALUES"),
            DbKind::Mysql => format!("INSERT INTO {qualified} () VALUES ()"),
        }
    } else {
        let columns = cells
            .iter()
            .map(|cell| quote_ident(&cell.column, session.kind))
            .collect::<Vec<_>>()
            .join(", ");
        let values = cells
            .iter()
            .map(|cell| cell_literal(cell, session.kind))
            .collect::<Vec<_>>()
            .join(", ");
        format!("INSERT INTO {qualified} ({columns}) VALUES ({values})")
    };
    execute(session, &sql).await
}

pub async fn update_row(
    session: &Session,
    schema: &str,
    table: &str,
    values: &[CellInput],
    keys: &[CellInput],
) -> Result<QueryResult, String> {
    if session.target.read_only {
        return Err("Database connection is in READ-ONLY mode. Modifications are blocked.".to_string());
    }
    if values.is_empty() {
        return Err("There are no changes to save.".to_string());
    }
    require_primary_key(session, schema, table, keys).await?;

    let qualified = qualified_name(schema, table, session.kind);
    let assignments = values
        .iter()
        .map(|cell| {
            format!(
                "{} = {}",
                quote_ident(&cell.column, session.kind),
                cell_literal(cell, session.kind)
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    let conditions = keys
        .iter()
        .map(|cell| {
            format!(
                "{} = {}",
                quote_ident(&cell.column, session.kind),
                cell_literal(cell, session.kind)
            )
        })
        .collect::<Vec<_>>()
        .join(" AND ");

    let sql = format!("UPDATE {qualified} SET {assignments} WHERE {conditions}");
    execute(session, &sql).await
}

pub async fn delete_row(
    session: &Session,
    schema: &str,
    table: &str,
    keys: &[CellInput],
) -> Result<QueryResult, String> {
    if session.target.read_only {
        return Err("Database connection is in READ-ONLY mode. Modifications are blocked.".to_string());
    }
    require_primary_key(session, schema, table, keys).await?;

    let qualified = qualified_name(schema, table, session.kind);
    let conditions = keys
        .iter()
        .map(|cell| {
            format!(
                "{} = {}",
                quote_ident(&cell.column, session.kind),
                cell_literal(cell, session.kind)
            )
        })
        .collect::<Vec<_>>()
        .join(" AND ");

    let sql = format!("DELETE FROM {qualified} WHERE {conditions}");
    execute(session, &sql).await
}

pub async fn delete_rows(
    session: &Session,
    schema: &str,
    table: &str,
    rows_keys: &[Vec<CellInput>],
) -> Result<QueryResult, String> {
    if session.target.read_only {
        return Err("Database connection is in READ-ONLY mode. Modifications are blocked.".to_string());
    }
    if rows_keys.is_empty() {
        return Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            rows_affected: Some(0),
            total_rows: None,
            duration_ms: 0,
            statement: String::new(),
        });
    }

    let qualified = qualified_name(schema, table, session.kind);
    let mut row_condition_clauses = Vec::new();

    for keys in rows_keys {
        require_primary_key(session, schema, table, keys).await?;
        let clause = keys
            .iter()
            .map(|cell| {
                format!(
                    "{} = {}",
                    quote_ident(&cell.column, session.kind),
                    cell_literal(cell, session.kind)
                )
            })
            .collect::<Vec<_>>()
            .join(" AND ");
        row_condition_clauses.push(format!("({clause})"));
    }

    let combined = row_condition_clauses.join(" OR ");
    let sql = format!("DELETE FROM {qualified} WHERE {combined}");
    execute(session, &sql).await
}

pub async fn list_indexes(
    session: &Session,
    schema: &str,
    table: &str,
) -> Result<Vec<TableIndex>, String> {
    match &session.pool {
        DbPool::Postgres(pool) => {
            let sql = "SELECT
                i.relname AS index_name,
                ix.indisunique AS is_unique,
                ix.indisprimary AS is_primary,
                am.amname AS index_type,
                ARRAY_TO_STRING(ARRAY_AGG(a.attname ORDER BY array_position(ix.indkey, a.attnum)), ',') AS column_names
            FROM pg_class t
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_am am ON i.relam = am.oid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            WHERE n.nspname = $1 AND t.relname = $2
            GROUP BY i.relname, ix.indisunique, ix.indisprimary, am.amname
            ORDER BY i.relname";

            let rows = sqlx::query(sql)
                .bind(schema)
                .bind(table)
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;

            let mut out = Vec::new();
            for r in rows {
                let name: String = r.try_get("index_name").map_err(|e| e.to_string())?;
                let unique: bool = r.try_get("is_unique").map_err(|e| e.to_string())?;
                let primary: bool = r.try_get("is_primary").map_err(|e| e.to_string())?;
                let index_type: String = r.try_get("index_type").map_err(|e| e.to_string())?;
                let cols_str: String = r.try_get("column_names").unwrap_or_default();
                let columns = cols_str
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();

                out.push(TableIndex {
                    name,
                    columns,
                    unique,
                    primary,
                    index_type: index_type.to_uppercase(),
                });
            }
            Ok(out)
        }
        DbPool::Mysql(pool) => {
            let sql = "SELECT
                index_name,
                non_unique,
                index_type,
                GROUP_CONCAT(column_name ORDER BY seq_in_index) AS column_names
            FROM information_schema.statistics
            WHERE table_schema = ? AND table_name = ?
            GROUP BY index_name, non_unique, index_type
            ORDER BY index_name";

            let rows = sqlx::query(sql)
                .bind(schema)
                .bind(table)
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;

            let mut out = Vec::new();
            for r in rows {
                let name: String = r.try_get("index_name").map_err(|e| e.to_string())?;
                let non_unique: i64 = r.try_get("non_unique").map_err(|e| e.to_string())?;
                let index_type: String = r.try_get("index_type").map_err(|e| e.to_string())?;
                let cols_str: String = r.try_get("column_names").unwrap_or_default();
                let columns = cols_str
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();

                let is_primary = name.eq_ignore_ascii_case("PRIMARY");
                out.push(TableIndex {
                    name,
                    columns,
                    unique: non_unique == 0,
                    primary: is_primary,
                    index_type,
                });
            }
            Ok(out)
        }
    }
}

pub async fn list_constraints(
    session: &Session,
    schema: &str,
    table: &str,
) -> Result<Vec<TableConstraint>, String> {
    match &session.pool {
        DbPool::Postgres(pool) => {
            let sql = "SELECT
                tc.constraint_name,
                tc.constraint_type,
                COALESCE(cc.check_clause, '') AS check_clause,
                COALESCE(ccu.table_schema, '') AS foreign_schema,
                COALESCE(ccu.table_name, '') AS foreign_table,
                COALESCE(ARRAY_TO_STRING(ARRAY_AGG(DISTINCT kcu.column_name), ','), '') AS local_columns,
                COALESCE(ARRAY_TO_STRING(ARRAY_AGG(DISTINCT ccu.column_name), ','), '') AS foreign_columns,
                COALESCE(rc.delete_rule, '') AS on_delete,
                COALESCE(rc.update_rule, '') AS on_update
            FROM information_schema.table_constraints tc
            LEFT JOIN information_schema.check_constraints cc
                   ON cc.constraint_name = tc.constraint_name
                  AND cc.constraint_schema = tc.table_schema
            LEFT JOIN information_schema.key_column_usage kcu
                   ON kcu.constraint_name = tc.constraint_name
                  AND kcu.table_schema = tc.table_schema
            LEFT JOIN information_schema.referential_constraints rc
                   ON rc.constraint_name = tc.constraint_name
                  AND rc.constraint_schema = tc.table_schema
            LEFT JOIN information_schema.constraint_column_usage ccu
                   ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
            WHERE tc.table_schema = $1 AND tc.table_name = $2
            GROUP BY tc.constraint_name, tc.constraint_type, cc.check_clause, ccu.table_schema, ccu.table_name, rc.delete_rule, rc.update_rule
            ORDER BY tc.constraint_name";

            let rows = sqlx::query(sql)
                .bind(schema)
                .bind(table)
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;

            let mut out = Vec::new();
            for r in rows {
                let name: String = r.try_get("constraint_name").map_err(|e| e.to_string())?;
                let constraint_type: String = r.try_get("constraint_type").map_err(|e| e.to_string())?;
                let check_raw: String = r.try_get("check_clause").unwrap_or_default();
                let f_schema: String = r.try_get("foreign_schema").unwrap_or_default();
                let f_table: String = r.try_get("foreign_table").unwrap_or_default();
                let l_cols_raw: String = r.try_get("local_columns").unwrap_or_default();
                let f_cols_raw: String = r.try_get("foreign_columns").unwrap_or_default();
                let on_delete_raw: String = r.try_get("on_delete").unwrap_or_default();
                let on_update_raw: String = r.try_get("on_update").unwrap_or_default();

                let columns: Vec<String> = l_cols_raw
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();

                let foreign_columns = if f_cols_raw.is_empty() {
                    None
                } else {
                    Some(
                        f_cols_raw
                            .split(',')
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .collect(),
                    )
                };

                out.push(TableConstraint {
                    name,
                    constraint_type,
                    columns,
                    check_clause: if check_raw.is_empty() { None } else { Some(check_raw) },
                    foreign_schema: if f_schema.is_empty() { None } else { Some(f_schema) },
                    foreign_table: if f_table.is_empty() { None } else { Some(f_table) },
                    foreign_columns,
                    on_delete: if on_delete_raw.is_empty() { None } else { Some(on_delete_raw) },
                    on_update: if on_update_raw.is_empty() { None } else { Some(on_update_raw) },
                });
            }
            Ok(out)
        }
        DbPool::Mysql(pool) => {
            let sql = "SELECT
                tc.constraint_name,
                tc.constraint_type,
                COALESCE(cc.check_clause, '') AS check_clause,
                COALESCE(kcu.referenced_table_schema, '') AS foreign_schema,
                COALESCE(kcu.referenced_table_name, '') AS foreign_table,
                COALESCE(GROUP_CONCAT(DISTINCT kcu.column_name), '') AS local_columns,
                COALESCE(GROUP_CONCAT(DISTINCT kcu.referenced_column_name), '') AS foreign_columns,
                COALESCE(rc.delete_rule, '') AS on_delete,
                COALESCE(rc.update_rule, '') AS on_update
            FROM information_schema.table_constraints tc
            LEFT JOIN information_schema.check_constraints cc
                   ON cc.constraint_name = tc.constraint_name
                  AND cc.constraint_schema = tc.table_schema
            LEFT JOIN information_schema.key_column_usage kcu
                   ON kcu.constraint_name = tc.constraint_name
                  AND kcu.table_schema = tc.table_schema
            LEFT JOIN information_schema.referential_constraints rc
                   ON rc.constraint_name = tc.constraint_name
                  AND rc.constraint_schema = tc.table_schema
            WHERE tc.table_schema = ? AND tc.table_name = ?
            GROUP BY tc.constraint_name, tc.constraint_type, cc.check_clause, kcu.referenced_table_schema, kcu.referenced_table_name, rc.delete_rule, rc.update_rule
            ORDER BY tc.constraint_name";

            let rows = sqlx::query(sql)
                .bind(schema)
                .bind(table)
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;

            let mut out = Vec::new();
            for r in rows {
                let name: String = r.try_get("constraint_name").map_err(|e| e.to_string())?;
                let constraint_type: String = r.try_get("constraint_type").map_err(|e| e.to_string())?;
                let check_raw: String = r.try_get("check_clause").unwrap_or_default();
                let f_schema: String = r.try_get("foreign_schema").unwrap_or_default();
                let f_table: String = r.try_get("foreign_table").unwrap_or_default();
                let l_cols_raw: String = r.try_get("local_columns").unwrap_or_default();
                let f_cols_raw: String = r.try_get("foreign_columns").unwrap_or_default();
                let on_delete_raw: String = r.try_get("on_delete").unwrap_or_default();
                let on_update_raw: String = r.try_get("on_update").unwrap_or_default();

                let columns: Vec<String> = l_cols_raw
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();

                let foreign_columns = if f_cols_raw.is_empty() {
                    None
                } else {
                    Some(
                        f_cols_raw
                            .split(',')
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .collect(),
                    )
                };

                out.push(TableConstraint {
                    name,
                    constraint_type,
                    columns,
                    check_clause: if check_raw.is_empty() { None } else { Some(check_raw) },
                    foreign_schema: if f_schema.is_empty() { None } else { Some(f_schema) },
                    foreign_table: if f_table.is_empty() { None } else { Some(f_table) },
                    foreign_columns,
                    on_delete: if on_delete_raw.is_empty() { None } else { Some(on_delete_raw) },
                    on_update: if on_update_raw.is_empty() { None } else { Some(on_update_raw) },
                });
            }
            Ok(out)
        }
    }
}

pub async fn create_index(
    session: &Session,
    schema: &str,
    table: &str,
    input: CreateIndexInput,
) -> Result<QueryResult, String> {
    if input.columns.is_empty() {
        return Err("Index requires at least one column.".to_string());
    }
    let index_name = if input.name.trim().is_empty() {
        format!("idx_{table}_{}", input.columns.join("_"))
    } else {
        input.name.trim().to_string()
    };

    let cols = input
        .columns
        .iter()
        .map(|c| quote_ident(c, session.kind))
        .collect::<Vec<_>>()
        .join(", ");

    let unique = if input.unique { "UNIQUE " } else { "" };
    let table_q = qualified_name(schema, table, session.kind);
    let idx_q = quote_ident(&index_name, session.kind);

    let sql = match session.kind {
        DbKind::Postgres => {
            let itype = input.index_type.as_deref().unwrap_or("BTREE");
            format!("CREATE {unique}INDEX {idx_q} ON {table_q} USING {itype} ({cols})")
        }
        DbKind::Mysql => {
            let itype = match input.index_type.as_deref() {
                Some("HASH") => " USING HASH",
                Some("FULLTEXT") => {
                    return execute(session, &format!("CREATE FULLTEXT INDEX {idx_q} ON {table_q} ({cols})")).await;
                }
                Some("SPATIAL") => {
                    return execute(session, &format!("CREATE SPATIAL INDEX {idx_q} ON {table_q} ({cols})")).await;
                }
                _ => "",
            };
            format!("CREATE {unique}INDEX {idx_q} ON {table_q} ({cols}){itype}")
        }
    };

    execute(session, &sql).await
}

pub async fn drop_index(
    session: &Session,
    schema: &str,
    table: &str,
    index_name: &str,
) -> Result<QueryResult, String> {
    let name = index_name.trim();
    if name.is_empty() {
        return Err("Index name is required.".to_string());
    }
    let sql = match session.kind {
        DbKind::Postgres => {
            format!("DROP INDEX {}", qualified_name(schema, name, session.kind))
        }
        DbKind::Mysql => {
            format!("DROP INDEX {} ON {}", quote_ident(name, session.kind), qualified_name(schema, table, session.kind))
        }
    };
    execute(session, &sql).await
}

pub async fn create_constraint(
    session: &Session,
    schema: &str,
    table: &str,
    input: CreateConstraintInput,
) -> Result<QueryResult, String> {
    let table_q = qualified_name(schema, table, session.kind);
    let cname_clause = if input.name.trim().is_empty() {
        String::new()
    } else {
        format!("CONSTRAINT {} ", quote_ident(input.name.trim(), session.kind))
    };

    let sql = match input.constraint_type.to_uppercase().as_str() {
        "UNIQUE" => {
            if input.columns.is_empty() {
                return Err("Unique constraint requires at least one column.".to_string());
            }
            let cols = input.columns.iter().map(|c| quote_ident(c, session.kind)).collect::<Vec<_>>().join(", ");
            format!("ALTER TABLE {table_q} ADD {cname_clause}UNIQUE ({cols})")
        }
        "CHECK" => {
            let expr = input.check_clause.as_deref().unwrap_or("").trim();
            if expr.is_empty() {
                return Err("Check constraint requires a condition expression.".to_string());
            }
            format!("ALTER TABLE {table_q} ADD {cname_clause}CHECK ({expr})")
        }
        "FOREIGN KEY" | "FOREIGN_KEY" => {
            if input.columns.is_empty() {
                return Err("Foreign key requires local columns.".to_string());
            }
            let ref_table = input.foreign_table.as_deref().unwrap_or("").trim();
            if ref_table.is_empty() {
                return Err("Foreign key requires target referenced table.".to_string());
            }
            let ref_schema = input.foreign_schema.as_deref().unwrap_or(schema);
            let ref_q = qualified_name(ref_schema, ref_table, session.kind);
            let cols = input.columns.iter().map(|c| quote_ident(c, session.kind)).collect::<Vec<_>>().join(", ");
            let fcols_vec = input.foreign_columns.unwrap_or_else(|| input.columns.clone());
            let fcols = fcols_vec.iter().map(|c| quote_ident(c, session.kind)).collect::<Vec<_>>().join(", ");

            let mut s = format!("ALTER TABLE {table_q} ADD {cname_clause}FOREIGN KEY ({cols}) REFERENCES {ref_q} ({fcols})");
            if let Some(od) = input.on_delete.as_deref() {
                if !od.trim().is_empty() {
                    s.push_str(&format!(" ON DELETE {od}"));
                }
            }
            if let Some(ou) = input.on_update.as_deref() {
                if !ou.trim().is_empty() {
                    s.push_str(&format!(" ON UPDATE {ou}"));
                }
            }
            s
        }
        other => return Err(format!("Unsupported constraint type: {other}")),
    };

    execute(session, &sql).await
}

pub async fn drop_constraint(
    session: &Session,
    schema: &str,
    table: &str,
    constraint_name: &str,
    constraint_type: &str,
) -> Result<QueryResult, String> {
    let name = constraint_name.trim();
    if name.is_empty() {
        return Err("Constraint name is required.".to_string());
    }
    let table_q = qualified_name(schema, table, session.kind);
    let cname_q = quote_ident(name, session.kind);

    let sql = match session.kind {
        DbKind::Postgres => format!("ALTER TABLE {table_q} DROP CONSTRAINT {cname_q}"),
        DbKind::Mysql => match constraint_type.to_uppercase().as_str() {
            "PRIMARY KEY" => format!("ALTER TABLE {table_q} DROP PRIMARY KEY"),
            "FOREIGN KEY" | "FOREIGN_KEY" => format!("ALTER TABLE {table_q} DROP FOREIGN KEY {cname_q}"),
            "CHECK" => format!("ALTER TABLE {table_q} DROP CHECK {cname_q}"),
            _ => format!("ALTER TABLE {table_q} DROP INDEX {cname_q}"),
        },
    };

    execute(session, &sql).await
}

pub async fn list_foreign_keys(
    session: &Session,
    schema: &str,
    table: &str,
) -> Result<Vec<ForeignKeyRef>, String> {
    match &session.pool {
        DbPool::Postgres(pool) => {
            let sql = "SELECT
                kcu.column_name::text,
                ccu.table_schema::text AS foreign_schema,
                ccu.table_name::text AS foreign_table,
                ccu.column_name::text AS foreign_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = $1
              AND tc.table_name = $2";

            let rows = sqlx::query(sql)
                .bind(schema)
                .bind(table)
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;

            rows.iter()
                .map(|r| {
                    Ok(ForeignKeyRef {
                        column: r.try_get("column_name").map_err(|e| e.to_string())?,
                        foreign_schema: r.try_get("foreign_schema").map_err(|e| e.to_string())?,
                        foreign_table: r.try_get("foreign_table").map_err(|e| e.to_string())?,
                        foreign_column: r.try_get("foreign_column").map_err(|e| e.to_string())?,
                    })
                })
                .collect()
        }
        DbPool::Mysql(pool) => {
            let sql = "SELECT
                CONVERT(kcu.column_name USING utf8mb4) AS column_name,
                CONVERT(kcu.referenced_table_schema USING utf8mb4) AS foreign_schema,
                CONVERT(kcu.referenced_table_name USING utf8mb4) AS foreign_table,
                CONVERT(kcu.referenced_column_name USING utf8mb4) AS foreign_column
            FROM information_schema.key_column_usage kcu
            WHERE kcu.referenced_table_name IS NOT NULL
              AND kcu.table_schema = ?
              AND kcu.table_name = ?";

            let rows = sqlx::query(sql)
                .bind(schema)
                .bind(table)
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;

            rows.iter()
                .map(|r| {
                    Ok(ForeignKeyRef {
                        column: r.try_get("column_name").map_err(|e| e.to_string())?,
                        foreign_schema: r.try_get("foreign_schema").map_err(|e| e.to_string())?,
                        foreign_table: r.try_get("foreign_table").map_err(|e| e.to_string())?,
                        foreign_column: r.try_get("foreign_column").map_err(|e| e.to_string())?,
                    })
                })
                .collect()
        }
    }
}

fn column_definition(column: &NewColumn, kind: DbKind) -> Result<String, String> {
    let name = column.name.trim();
    let data_type = column.data_type.trim();
    if name.is_empty() {
        return Err("Column name is required.".to_string());
    }
    if data_type.is_empty() {
        return Err(format!("A data type is required for column '{name}'."));
    }
    let mut definition = format!("{} {data_type}", quote_ident(name, kind));
    if !column.nullable {
        definition.push_str(" NOT NULL");
    }
    if let Some(default) = column
        .default_value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        definition.push_str(&format!(" DEFAULT {default}"));
    }
    Ok(definition)
}

pub async fn create_table(
    session: &Session,
    schema: &str,
    table: &str,
    columns: &[NewColumn],
) -> Result<QueryResult, String> {
    if columns.is_empty() {
        return Err("Add at least one column.".to_string());
    }
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required.".to_string());
    }

    let mut definitions = Vec::new();
    for column in columns {
        definitions.push(column_definition(column, session.kind)?);
    }
    let keys = columns
        .iter()
        .filter(|column| column.primary_key)
        .map(|column| quote_ident(column.name.trim(), session.kind))
        .collect::<Vec<_>>();
    if !keys.is_empty() {
        definitions.push(format!("PRIMARY KEY ({})", keys.join(", ")));
    }

    let sql = format!(
        "CREATE TABLE {} ({})",
        qualified_name(schema, table, session.kind),
        definitions.join(", ")
    );
    execute(session, &sql).await
}

pub async fn drop_table(
    session: &Session,
    schema: &str,
    table: &str,
) -> Result<QueryResult, String> {
    let sql = format!(
        "DROP TABLE {}",
        qualified_name(schema, table, session.kind)
    );
    execute(session, &sql).await
}

pub async fn truncate_table(
    session: &Session,
    schema: &str,
    table: &str,
) -> Result<QueryResult, String> {
    let sql = format!(
        "TRUNCATE TABLE {}",
        qualified_name(schema, table, session.kind)
    );
    execute(session, &sql).await
}

pub async fn rename_table(
    session: &Session,
    schema: &str,
    table: &str,
    new_name: &str,
) -> Result<QueryResult, String> {
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Err("New table name is required.".to_string());
    }
    let sql = format!(
        "ALTER TABLE {} RENAME TO {}",
        qualified_name(schema, table, session.kind),
        quote_ident(new_name, session.kind)
    );
    execute(session, &sql).await
}

pub async fn add_column(
    session: &Session,
    schema: &str,
    table: &str,
    column: &NewColumn,
) -> Result<QueryResult, String> {
    if column.primary_key {
        return Err("Primary keys can only be defined when creating a table.".to_string());
    }
    let definition = column_definition(column, session.kind)?;
    let sql = format!(
        "ALTER TABLE {} ADD COLUMN {definition}",
        qualified_name(schema, table, session.kind)
    );
    execute(session, &sql).await
}

fn mysql_default_literal(value: &str) -> String {
    let trimmed = value.trim();
    let upper = trimmed.to_ascii_uppercase();
    let is_expression = trimmed.starts_with('(')
        || upper.starts_with("CURRENT_TIMESTAMP")
        || upper.starts_with("CURRENT_DATE")
        || upper.starts_with("CURRENT_TIME")
        || upper == "NULL";
    if is_expression {
        trimmed.to_string()
    } else {
        sql_literal(trimmed, DbKind::Mysql)
    }
}

pub async fn edit_column(
    session: &Session,
    schema: &str,
    table: &str,
    edit: &EditColumn,
) -> Result<QueryResult, String> {
    let name = edit.name.trim();
    if name.is_empty() {
        return Err("Column name is required.".to_string());
    }
    let new_name = edit.new_name.trim();
    let new_name = if new_name.is_empty() { name } else { new_name };
    let data_type = edit.data_type.trim();

    let current = describe_table(session, schema, table)
        .await?
        .into_iter()
        .find(|column| column.name == name)
        .ok_or_else(|| format!("Column '{name}' was not found."))?;
    let data_type = if data_type.is_empty() {
        current.type_name.clone()
    } else {
        data_type.to_string()
    };

    let provided_default = edit
        .default_value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let current_default = current
        .default_value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let mysql_current_default = current
        .default_value
        .as_deref()
        .map(mysql_default_literal);

    let renamed = new_name != name;
    let type_changed = data_type != current.type_name;
    let null_changed = edit.nullable != current.nullable;
    let default_changed = match session.kind {
        DbKind::Postgres => provided_default != current_default,
        DbKind::Mysql => provided_default != mysql_current_default,
    };
    if !renamed && !type_changed && !null_changed && !default_changed {
        return Err("There are no changes to save.".to_string());
    }

    let qualified = qualified_name(schema, table, session.kind);
    let target = quote_ident(new_name, session.kind);

    match session.kind {
        DbKind::Postgres => {
            let mut result = None;
            if renamed {
                result = Some(
                    execute(
                        session,
                        &format!(
                            "ALTER TABLE {qualified} RENAME COLUMN {} TO {target}",
                            quote_ident(name, session.kind)
                        ),
                    )
                    .await?,
                );
            }
            if type_changed {
                result = Some(
                    execute(
                        session,
                        &format!(
                            "ALTER TABLE {qualified} ALTER COLUMN {target} TYPE {data_type}"
                        ),
                    )
                    .await?,
                );
            }
            if default_changed {
                let sql = match &provided_default {
                    Some(value) => format!(
                        "ALTER TABLE {qualified} ALTER COLUMN {target} SET DEFAULT {value}"
                    ),
                    None => format!(
                        "ALTER TABLE {qualified} ALTER COLUMN {target} DROP DEFAULT"
                    ),
                };
                result = Some(execute(session, &sql).await?);
            }
            if null_changed {
                let action = if edit.nullable {
                    "DROP NOT NULL"
                } else {
                    "SET NOT NULL"
                };
                result = Some(
                    execute(
                        session,
                        &format!(
                            "ALTER TABLE {qualified} ALTER COLUMN {target} {action}"
                        ),
                    )
                    .await?,
                );
            }
            result.ok_or_else(|| "There are no changes to save.".to_string())
        }
        DbKind::Mysql => {
            if renamed && !type_changed && !null_changed && !default_changed {
                let sql = format!(
                    "ALTER TABLE {qualified} RENAME COLUMN {} TO {target}",
                    quote_ident(name, session.kind)
                );
                return execute(session, &sql).await;
            }

            let mut definition = format!("{target} {data_type}");
            definition.push_str(if edit.nullable { " NULL" } else { " NOT NULL" });
            if let Some(default) = &provided_default {
                definition.push_str(" DEFAULT ");
                definition.push_str(default);
            }
            if current.auto_increment {
                definition.push_str(" AUTO_INCREMENT");
            }
            let sql = format!(
                "ALTER TABLE {qualified} CHANGE COLUMN {} {definition}",
                quote_ident(name, session.kind)
            );
            execute(session, &sql).await
        }
    }
}

pub async fn drop_column(
    session: &Session,
    schema: &str,
    table: &str,
    column: &str,
) -> Result<QueryResult, String> {
    if column.trim().is_empty() {
        return Err("Column name is required.".to_string());
    }
    let sql = format!(
        "ALTER TABLE {} DROP COLUMN {}",
        qualified_name(schema, table, session.kind),
        quote_ident(column.trim(), session.kind)
    );
    execute(session, &sql).await
}

pub async fn create_schema(
    session: &Session,
    database: &str,
    name: &str,
) -> Result<QueryResult, String> {
    let name = name.trim();
    let database = database.trim();
    if name.is_empty() {
        return Err("Schema name is required.".to_string());
    }
    if database.is_empty() || database == session.database {
        let sql = format!("CREATE SCHEMA {}", quote_ident(name, session.kind));
        return execute(session, &sql).await;
    }
    if session.kind != DbKind::Postgres {
        return Err("Schemas can only be created in the connected MySQL/MariaDB database.".to_string());
    }

    let mut target = session.target.clone();
    target.database = database.to_string();
    let url = connection_url(&target, &session.password)?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(12))
        .connect(&url)
        .await
        .map_err(|e| format!("Could not connect to database \"{database}\": {e}"))?;
    let temp = Session {
        profile_id: session.profile_id.clone(),
        kind: session.kind,
        database: database.to_string(),
        server_version: session.server_version.clone(),
        pool: DbPool::Postgres(pool),
        target,
        password: session.password.clone(),
        _tunnel: session._tunnel.clone(),
    };
    let sql = format!("CREATE SCHEMA {}", quote_ident(name, session.kind));
    let result = execute(&temp, &sql).await;
    temp.pool.close().await;
    result
}

pub async fn drop_schema(session: &Session, schema: &str) -> Result<QueryResult, String> {
    let schema = schema.trim();
    if schema.is_empty() {
        return Err("Schema name is required.".to_string());
    }
    match session.kind {
        DbKind::Postgres => {
            let sql = format!(
                "DROP SCHEMA {} CASCADE",
                quote_ident(schema, session.kind)
            );
            execute(session, &sql).await
        }
        DbKind::Mysql => drop_database(session, schema).await,
    }
}

pub async fn create_database(session: &Session, name: &str) -> Result<QueryResult, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Database name is required.".to_string());
    }
    let sql = format!("CREATE DATABASE {}", quote_ident(name, session.kind));
    execute(session, &sql).await
}

pub async fn drop_database(session: &Session, name: &str) -> Result<QueryResult, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Database name is required.".to_string());
    }
    let sql = format!("DROP DATABASE {}", quote_ident(name, session.kind));
    execute(session, &sql).await
}

pub async fn rename_database(
    session: &Session,
    name: &str,
    new_name: &str,
) -> Result<QueryResult, String> {
    let name = name.trim();
    let new_name = new_name.trim();
    if name.is_empty() || new_name.is_empty() {
        return Err("Database name is required.".to_string());
    }
    if name == new_name {
        return Err("The new name is the same as the current name.".to_string());
    }
    match session.kind {
        DbKind::Mysql => Err(
            "MySQL/MariaDB does not support renaming a database. Create a new database and move the tables instead."
                .to_string(),
        ),
        DbKind::Postgres => {
            let sql = format!(
                "ALTER DATABASE {} RENAME TO {}",
                quote_ident(name, session.kind),
                quote_ident(new_name, session.kind)
            );
            execute(session, &sql).await
        }
    }
}

pub async fn dump_table_sql(
    session: &Session,
    schema: &str,
    table: &str,
) -> Result<String, String> {
    let mut out = String::new();
    let q = qualified_name(schema, table, session.kind);
    out.push_str(&format!("-- -----------------------------------------------------\n"));
    out.push_str(&format!("-- Table structure & data for {q}\n"));
    out.push_str(&format!("-- -----------------------------------------------------\n\n"));

    let cols = describe_table(session, schema, table).await?;
    if cols.is_empty() {
        return Err(format!("Could not introspect columns for {q}."));
    }

    out.push_str(&format!("DROP TABLE IF EXISTS {q};\n"));

    let mut defs = Vec::new();
    for c in &cols {
        let col_name = quote_ident(&c.name, session.kind);
        let mut def = format!("{col_name} {}", c.type_name);
        if !c.nullable {
            def.push_str(" NOT NULL");
        }
        if let Some(d) = &c.default_value {
            if !d.is_empty() {
                def.push_str(&format!(" DEFAULT {d}"));
            }
        }
        defs.push(def);
    }
    let pks = cols
        .iter()
        .filter(|c| c.primary_key)
        .map(|c| quote_ident(&c.name, session.kind))
        .collect::<Vec<_>>();
    if !pks.is_empty() {
        defs.push(format!("PRIMARY KEY ({})", pks.join(", ")));
    }

    out.push_str(&format!("CREATE TABLE {q} (\n  {}\n);\n\n", defs.join(",\n  ")));

    // Data rows
    let select_sql = format!("SELECT * FROM {q}");
    let rows_res = execute(session, &select_sql).await?;
    if !rows_res.rows.is_empty() {
        let col_names = rows_res
            .columns
            .iter()
            .map(|c| quote_ident(&c.name, session.kind))
            .collect::<Vec<_>>()
            .join(", ");

        for chunk in rows_res.rows.chunks(100) {
            let mut value_tuples = Vec::new();
            for row in chunk {
                let row_literals = row
                    .iter()
                    .map(|v| match v {
                        serde_json::Value::Null => "NULL".to_string(),
                        serde_json::Value::Bool(b) => {
                            if *b {
                                "TRUE".to_string()
                            } else {
                                "FALSE".to_string()
                            }
                        }
                        serde_json::Value::Number(n) => n.to_string(),
                        serde_json::Value::String(s) => sql_literal(s, session.kind),
                        other => sql_literal(&other.to_string(), session.kind),
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                value_tuples.push(format!("({row_literals})"));
            }
            out.push_str(&format!(
                "INSERT INTO {q} ({col_names}) VALUES\n  {};\n",
                value_tuples.join(",\n  ")
            ));
        }
        out.push('\n');
    }

    Ok(out)
}

pub async fn dump_database_sql(
    session: &Session,
    schema_or_db: &str,
) -> Result<String, String> {
    let mut out = String::new();
    out.push_str(&format!("-- =====================================================\n"));
    out.push_str(&format!("-- ChillDB SQL Dump for: {schema_or_db}\n"));
    out.push_str(&format!("-- Engine: {:?}\n", session.kind));
    out.push_str(&format!("-- Date: {}\n", sqlx::types::chrono::Utc::now().to_rfc3339()));
    out.push_str(&format!("-- =====================================================\n\n"));

    let tables = list_tables(session, schema_or_db).await?;
    let regular_tables = tables
        .iter()
        .filter(|t| !t.kind.to_uppercase().contains("VIEW"))
        .collect::<Vec<_>>();

    for t in regular_tables {
        let table_dump = dump_table_sql(session, &t.schema, &t.name).await?;
        out.push_str(&table_dump);
        out.push('\n');
    }

    Ok(out)
}

pub async fn execute(session: &Session, sql: &str) -> Result<QueryResult, String> {
    let started = Instant::now();
    let returning_rows = is_row_returning(sql);

    if session.target.read_only && !returning_rows {
        return Err("Database connection is in READ-ONLY mode. Modifications are blocked.".to_string());
    }

    match &session.pool {
        DbPool::Postgres(pool) => {
            if returning_rows {
                let rows = sqlx::query(sql)
                    .fetch_all(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                let mut columns = Vec::new();
                let mut values = Vec::with_capacity(rows.len());
                if let Some(first) = rows.first() {
                    columns = first
                        .columns()
                        .iter()
                        .map(|c| ColumnInfo {
                            name: c.name().to_string(),
                            type_name: c.type_info().name().to_string(),
                        })
                        .collect();
                }
                for row in &rows {
                    values.push((0..row.len()).map(|i| pg_cell(row, i)).collect());
                }
                if columns.is_empty() && values.is_empty() {
                    columns = describe_pg(pool, sql).await;
                }
                Ok(QueryResult {
                    columns,
                    rows: values,
                    rows_affected: None,
                    total_rows: None,
                    duration_ms: started.elapsed().as_millis() as u64,
                    statement: sql.to_string(),
                })
            } else {
                let result = sqlx::query(sql)
                    .execute(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(QueryResult {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    rows_affected: Some(result.rows_affected()),
                    total_rows: None,
                    duration_ms: started.elapsed().as_millis() as u64,
                    statement: sql.to_string(),
                })
            }
        }
        DbPool::Mysql(pool) => {
            if returning_rows {
                let rows = sqlx::query(sql)
                    .fetch_all(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                let mut columns = Vec::new();
                let mut values = Vec::with_capacity(rows.len());
                if let Some(first) = rows.first() {
                    columns = first
                        .columns()
                        .iter()
                        .map(|c| ColumnInfo {
                            name: c.name().to_string(),
                            type_name: c.type_info().name().to_string(),
                        })
                        .collect();
                }
                for row in &rows {
                    values.push((0..row.len()).map(|i| mysql_cell(row, i)).collect());
                }
                if columns.is_empty() && values.is_empty() {
                    columns = describe_mysql(pool, sql).await;
                }
                Ok(QueryResult {
                    columns,
                    rows: values,
                    rows_affected: None,
                    total_rows: None,
                    duration_ms: started.elapsed().as_millis() as u64,
                    statement: sql.to_string(),
                })
            } else {
                let result = sqlx::query(sql)
                    .execute(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(QueryResult {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    rows_affected: Some(result.rows_affected()),
                    total_rows: None,
                    duration_ms: started.elapsed().as_millis() as u64,
                    statement: sql.to_string(),
                })
            }
        }
    }
}

async fn describe_pg(pool: &Pool<Postgres>, sql: &str) -> Vec<ColumnInfo> {
    match pool.describe(sql).await {
        Ok(desc) => desc
            .columns()
            .iter()
            .map(|c| ColumnInfo {
                name: c.name().to_string(),
                type_name: c.type_info().name().to_string(),
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

async fn describe_mysql(pool: &Pool<MySql>, sql: &str) -> Vec<ColumnInfo> {
    match pool.describe(sql).await {
        Ok(desc) => desc
            .columns()
            .iter()
            .map(|c| ColumnInfo {
                name: c.name().to_string(),
                type_name: c.type_info().name().to_string(),
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn leading_keyword(sql: &str) -> String {
    let mut rest = sql.trim_start();
    loop {
        if let Some(stripped) = rest.strip_prefix("--") {
            rest = match stripped.find('\n') {
                Some(pos) => stripped[pos + 1..].trim_start(),
                None => return String::new(),
            };
        } else if let Some(stripped) = rest.strip_prefix("/*") {
            rest = match stripped.find("*/") {
                Some(pos) => stripped[pos + 2..].trim_start(),
                None => return String::new(),
            };
        } else {
            break;
        }
    }
    rest.split(|c: char| c.is_whitespace() || c == '(' || c == ';')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn is_row_returning(sql: &str) -> bool {
    matches!(
        leading_keyword(sql).as_str(),
        "select" | "with" | "show" | "explain" | "describe" | "desc" | "values" | "table"
    )
}

fn bytes_to_display(bytes: &[u8]) -> String {
    if bytes.len() <= 64 {
        let mut out = String::with_capacity(2 + bytes.len() * 2);
        out.push_str("0x");
        for byte in bytes {
            out.push_str(&format!("{byte:02x}"));
        }
        out
    } else {
        format!("<{} bytes>", bytes.len())
    }
}

fn unsupported_value<T: Row>(row: &T, index: usize) -> Value
where
    usize: sqlx::ColumnIndex<T>,
{
    if let Ok(raw) = row.try_get_raw(index) {
        if raw.is_null() {
            return Value::Null;
        }
    }
    let type_name = row
        .try_get_raw(index)
        .map(|raw| raw.type_info().name().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    Value::String(format!("<{type_name}>"))
}

fn pg_cell(row: &PgRow, index: usize) -> Value {
    macro_rules! try_cell {
        ($ty:ty, $conv:expr) => {
            match row.try_get::<Option<$ty>, _>(index) {
                Ok(Some(value)) => return $conv(value),
                Ok(None) => return Value::Null,
                Err(_) => {}
            }
        };
    }

    try_cell!(bool, |v| json!(v));
    try_cell!(i16, |v| json!(v));
    try_cell!(i32, |v| json!(v));
    try_cell!(i64, |v| json!(v));
    try_cell!(f32, |v| json!(v));
    try_cell!(f64, |v| json!(v));
    try_cell!(BigDecimal, |v: BigDecimal| json!(v.to_string()));
    try_cell!(String, |v| json!(v));
    try_cell!(Vec<u8>, |v: Vec<u8>| json!(bytes_to_display(&v)));
    try_cell!(NaiveDateTime, |v: NaiveDateTime| json!(v.to_string()));
    try_cell!(NaiveDate, |v: NaiveDate| json!(v.to_string()));
    try_cell!(NaiveTime, |v: NaiveTime| json!(v.to_string()));
    try_cell!(DateTime<Utc>, |v: DateTime<Utc>| json!(v
        .with_timezone(&Local)
        .naive_local()
        .to_string()));
    try_cell!(Uuid, |v: Uuid| json!(v.to_string()));
    try_cell!(Json<Value>, |v: Json<Value>| v.0);

    unsupported_value(row, index)
}

fn mysql_cell(row: &MySqlRow, index: usize) -> Value {
    macro_rules! try_cell {
        ($ty:ty, $conv:expr) => {
            match row.try_get::<Option<$ty>, _>(index) {
                Ok(Some(value)) => return $conv(value),
                Ok(None) => return Value::Null,
                Err(_) => {}
            }
        };
    }

    try_cell!(i8, |v| json!(v));
    try_cell!(u8, |v| json!(v));
    try_cell!(i16, |v| json!(v));
    try_cell!(u16, |v| json!(v));
    try_cell!(i32, |v| json!(v));
    try_cell!(u32, |v| json!(v));
    try_cell!(i64, |v| json!(v));
    try_cell!(u64, |v| json!(v));
    try_cell!(f32, |v| json!(v));
    try_cell!(f64, |v| json!(v));
    try_cell!(BigDecimal, |v: BigDecimal| json!(v.to_string()));
    try_cell!(Json<Value>, |v: Json<Value>| v.0);
    try_cell!(String, |v| json!(v));
    try_cell!(Vec<u8>, |v: Vec<u8>| json!(bytes_to_display(&v)));
    try_cell!(NaiveDateTime, |v: NaiveDateTime| json!(v.to_string()));
    try_cell!(NaiveDate, |v: NaiveDate| json!(v.to_string()));
    try_cell!(NaiveTime, |v: NaiveTime| json!(v.to_string()));
    try_cell!(DateTime<Utc>, |v: DateTime<Utc>| json!(v
        .with_timezone(&Local)
        .naive_local()
        .to_string()));
    try_cell!(Uuid, |v: Uuid| json!(v.to_string()));

    unsupported_value(row, index)
}
