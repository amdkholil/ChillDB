mod db;
mod ssh;

use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use db::{
    CellInput, DbKind, NewColumn, Profile, QueryResult, Session, SessionInfo, TableColumn,
    TableInfo,
};
use tauri::{Manager, State};
use uuid::Uuid;

pub struct AppState {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    profiles: Mutex<Vec<Profile>>,
    profiles_path: PathBuf,
}

fn load_profiles(path: &PathBuf) -> Vec<Profile> {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

fn write_profiles(path: &PathBuf, profiles: &[Profile]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_vec_pretty(profiles).map_err(|e| e.to_string())?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, data).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o600));
    }

    fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

fn get_session(state: &State<'_, AppState>, connection_id: &str) -> Result<Arc<Session>, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "Internal lock error".to_string())?
        .get(connection_id)
        .cloned()
        .ok_or_else(|| "This connection is no longer open".to_string())
}

#[tauri::command]
fn list_profiles(state: State<'_, AppState>) -> Result<Vec<Profile>, String> {
    Ok(state
        .profiles
        .lock()
        .map_err(|_| "Internal lock error".to_string())?
        .clone())
}

#[tauri::command]
fn save_profile(mut profile: Profile, state: State<'_, AppState>) -> Result<Profile, String> {
    profile.name = profile.name.trim().to_string();
    profile.host = profile.host.trim().to_string();
    profile.username = profile.username.trim().to_string();
    profile.database = profile.database.trim().to_string();
    profile.ssh_host = profile.ssh_host.trim().to_string();
    profile.ssh_username = profile.ssh_username.trim().to_string();
    profile.ssh_key_path = profile.ssh_key_path.trim().to_string();

    if profile.name.is_empty() {
        return Err("Connection name is required".to_string());
    }
    if profile.host.is_empty() {
        return Err("Host is required".to_string());
    }
    if profile.id.is_empty() {
        profile.id = Uuid::new_v4().to_string();
    }

    let mut profiles = state
        .profiles
        .lock()
        .map_err(|_| "Internal lock error".to_string())?;

    match profiles.iter_mut().find(|p| p.id == profile.id) {
        Some(existing) => *existing = profile.clone(),
        None => profiles.push(profile.clone()),
    }

    write_profiles(&state.profiles_path, &profiles)?;
    Ok(profile)
}

#[tauri::command]
async fn delete_profile(id: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut profiles = state
            .profiles
            .lock()
            .map_err(|_| "Internal lock error".to_string())?;
        profiles.retain(|p| p.id != id);
        write_profiles(&state.profiles_path, &profiles)?;
    }

    let mut removed = Vec::new();
    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "Internal lock error".to_string())?;
        let ids: Vec<String> = sessions
            .iter()
            .filter(|(_, session)| session.profile_id == id)
            .map(|(session_id, _)| session_id.clone())
            .collect();
        for session_id in ids {
            if let Some(session) = sessions.remove(&session_id) {
                removed.push(session);
            }
        }
    }

    for session in removed {
        session.pool.close().await;
    }

    Ok(())
}

async fn timed<T>(
    future: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    tokio::time::timeout(Duration::from_secs(120), future)
        .await
        .map_err(|_| "Query timed out after 120 seconds".to_string())?
}

#[tauri::command]
async fn test_connection(
    profile: Profile,
    password: Option<String>,
    ssh_secret: Option<String>,
) -> Result<String, String> {
    let session = timed(db::connect(
        &profile,
        password.as_deref().unwrap_or(""),
        ssh_secret.as_deref().unwrap_or(""),
    ))
    .await?;
    let version = session.server_version.clone();
    session.pool.close().await;
    Ok(version)
}

#[tauri::command]
async fn connect(
    profile: Profile,
    password: Option<String>,
    ssh_secret: Option<String>,
    state: State<'_, AppState>,
) -> Result<SessionInfo, String> {
    let session = timed(db::connect(
        &profile,
        password.as_deref().unwrap_or(""),
        ssh_secret.as_deref().unwrap_or(""),
    ))
    .await?;
    let id = Uuid::new_v4().to_string();
    let info = SessionInfo {
        id: id.clone(),
        kind: session.kind,
        database: session.database.clone(),
        server_version: session.server_version.clone(),
    };

    state
        .sessions
        .lock()
        .map_err(|_| "Internal lock error".to_string())?
        .insert(id, Arc::new(session));

    Ok(info)
}

#[tauri::command]
async fn disconnect(connection_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "Internal lock error".to_string())?
        .remove(&connection_id);

    if let Some(session) = session {
        session.pool.close().await;
    }
    Ok(())
}

#[tauri::command]
async fn list_schemas(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let session = get_session(&state, &connection_id)?;
    db::list_schemas(&session).await
}

#[tauri::command]
async fn list_tables(
    connection_id: String,
    schema: String,
    state: State<'_, AppState>,
) -> Result<Vec<TableInfo>, String> {
    let session = get_session(&state, &connection_id)?;
    db::list_tables(&session, &schema).await
}

#[tauri::command]
async fn list_databases(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let session = get_session(&state, &connection_id)?;
    db::list_databases(&session).await
}

#[tauri::command]
async fn describe_table(
    connection_id: String,
    schema: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<TableColumn>, String> {
    let session = get_session(&state, &connection_id)?;
    timed(db::describe_table(&session, &schema, &table)).await
}

#[tauri::command]
async fn table_page(
    connection_id: String,
    schema: String,
    table: String,
    page: i64,
    page_size: i64,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let session = get_session(&state, &connection_id)?;
    timed(db::table_page(
        &session,
        &schema,
        &table,
        page,
        page_size,
    ))
    .await
}

#[tauri::command]
async fn insert_row(
    connection_id: String,
    schema: String,
    table: String,
    cells: Vec<CellInput>,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let session = get_session(&state, &connection_id)?;
    timed(db::insert_row(&session, &schema, &table, &cells)).await
}

#[tauri::command]
async fn update_row(
    connection_id: String,
    schema: String,
    table: String,
    values: Vec<CellInput>,
    keys: Vec<CellInput>,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let session = get_session(&state, &connection_id)?;
    timed(db::update_row(
        &session, &schema, &table, &values, &keys,
    ))
    .await
}

#[tauri::command]
async fn delete_row(
    connection_id: String,
    schema: String,
    table: String,
    keys: Vec<CellInput>,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let session = get_session(&state, &connection_id)?;
    timed(db::delete_row(&session, &schema, &table, &keys)).await
}

#[tauri::command]
async fn create_table(
    connection_id: String,
    schema: String,
    table: String,
    columns: Vec<NewColumn>,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let session = get_session(&state, &connection_id)?;
    timed(db::create_table(&session, &schema, &table, &columns)).await
}

#[tauri::command]
async fn drop_table(
    connection_id: String,
    schema: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let session = get_session(&state, &connection_id)?;
    timed(db::drop_table(&session, &schema, &table)).await
}

#[tauri::command]
async fn rename_table(
    connection_id: String,
    schema: String,
    table: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let session = get_session(&state, &connection_id)?;
    timed(db::rename_table(&session, &schema, &table, &new_name)).await
}

#[tauri::command]
async fn add_column(
    connection_id: String,
    schema: String,
    table: String,
    column: NewColumn,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let session = get_session(&state, &connection_id)?;
    timed(db::add_column(&session, &schema, &table, &column)).await
}

#[tauri::command]
async fn drop_column(
    connection_id: String,
    schema: String,
    table: String,
    column: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let session = get_session(&state, &connection_id)?;
    timed(db::drop_column(&session, &schema, &table, &column)).await
}

#[tauri::command]
async fn create_database(
    connection_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let session = get_session(&state, &connection_id)?;
    timed(db::create_database(&session, &name)).await
}

#[tauri::command]
async fn drop_database(
    connection_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let session = get_session(&state, &connection_id)?;
    timed(db::drop_database(&session, &name)).await
}

#[tauri::command]
async fn rename_database(
    connection_id: String,
    name: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let session = get_session(&state, &connection_id)?;
    timed(db::rename_database(&session, &name, &new_name)).await
}

#[tauri::command]
async fn run_query(
    connection_id: String,
    sql: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    if sql.trim().is_empty() {
        return Err("Nothing to run".to_string());
    }

    let session = get_session(&state, &connection_id)?;
    tokio::time::timeout(Duration::from_secs(120), db::execute(&session, &sql))
        .await
        .map_err(|_| "Query timed out after 120 seconds".to_string())?
}

#[tauri::command]
fn db_kinds() -> Vec<DbKind> {
    vec![DbKind::Postgres, DbKind::Mysql]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let profiles_path = data_dir.join("connections.json");
            let profiles = load_profiles(&profiles_path);

            app.manage(AppState {
                sessions: Mutex::new(HashMap::new()),
                profiles: Mutex::new(profiles),
                profiles_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_profiles,
            save_profile,
            delete_profile,
            test_connection,
            connect,
            disconnect,
            list_schemas,
            list_tables,
            list_databases,
            describe_table,
            table_page,
            insert_row,
            update_row,
            delete_row,
            create_table,
            drop_table,
            rename_table,
            add_column,
            drop_column,
            create_database,
            drop_database,
            rename_database,
            run_query,
            db_kinds
        ])
        .run(tauri::generate_context!())
        .expect("error while running ChillDB");
}
