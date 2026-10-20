use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{
    mysql::{MySqlPoolOptions, MySqlRow},
    postgres::{PgPoolOptions, PgRow},
    types::{
        chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc},
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableColumn {
    pub name: String,
    pub type_name: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub primary_key: bool,
    pub auto_increment: bool,
}

#[derive(Debug, Clone, Deserialize)]
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
    pub kind: String,
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
    _tunnel: Option<SshTunnel>,
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
            url.query_pairs_mut().append_pair(
                "sslmode",
                if profile.ssl { "require" } else { "disable" },
            );
        }
        DbKind::Mysql => {
            url.query_pairs_mut().append_pair(
                "ssl-mode",
                if profile.ssl { "required" } else { "disabled" },
            );
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
        Some(SshTunnel::start(profile, ssh_secret)?)
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

    let (pool, version): (DbPool, String) = match profile.kind {
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
            (DbPool::Postgres(pool), version)
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
            (DbPool::Mysql(pool), version)
        }
    };

    Ok(Session {
        profile_id: profile.id.clone(),
        kind: profile.kind,
        database: profile.database.clone(),
        server_version: version,
        pool,
        _tunnel: tunnel,
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

async fn count_rows(session: &Session, qualified: &str) -> Result<u64, String> {
    let sql = format!("SELECT COUNT(*) FROM {qualified}");
    match &session.pool {
        DbPool::Postgres(pool) => sqlx::query_scalar::<_, i64>(&sql)
            .fetch_one(pool)
            .await
            .map(|n| n as u64)
            .map_err(|e| e.to_string()),
        DbPool::Mysql(pool) => sqlx::query_scalar::<_, u64>(&sql)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string()),
    }
}

pub async fn table_page(
    session: &Session,
    schema: &str,
    table: &str,
    page: i64,
    page_size: i64,
) -> Result<QueryResult, String> {
    let page = page.max(1);
    let page_size = page_size.clamp(1, 2000);
    let offset = (page - 1).saturating_mul(page_size);
    let qualified = qualified_name(schema, table, session.kind);

    let keys = primary_keys(session, schema, table).await?;
    let order = if keys.is_empty() {
        String::new()
    } else {
        let columns = keys
            .iter()
            .map(|key| quote_ident(key, session.kind))
            .collect::<Vec<_>>()
            .join(", ");
        format!(" ORDER BY {columns}")
    };

    let sql = format!("SELECT * FROM {qualified}{order} LIMIT {page_size} OFFSET {offset}");
    let mut result = execute(session, &sql).await?;
    result.total_rows = Some(count_rows(session, &qualified).await?);
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

pub async fn execute(session: &Session, sql: &str) -> Result<QueryResult, String> {
    let started = Instant::now();
    let returning_rows = is_row_returning(sql);

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
    try_cell!(DateTime<Utc>, |v: DateTime<Utc>| json!(v.to_rfc3339()));
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
    try_cell!(Uuid, |v: Uuid| json!(v.to_string()));

    unsupported_value(row, index)
}
