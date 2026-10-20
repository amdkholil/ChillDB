import { invoke } from "@tauri-apps/api/core";
import type {
  CellInput,
  DbKind,
  EditColumn,
  NewColumn,
  Profile,
  QueryResult,
  SavedCredentials,
  SessionInfo,
  TableColumn,
  TableInfo,
} from "./types";

const recentReports = new Map<string, number>();

export function reportError(
  message: string,
  context = "Application error",
): void {
  const text = message.trim();
  if (!text) return;
  const key = `${context}\u0000${text}`;
  const now = Date.now();
  if (now - (recentReports.get(key) ?? 0) < 15_000) return;
  recentReports.set(key, now);
  if (recentReports.size > 200) {
    for (const [entry, at] of recentReports) {
      if (now - at > 60_000) recentReports.delete(entry);
    }
  }
  void invoke("report_error", { context, message: text }).catch(
    () => undefined,
  );
}

export function errorMessage(error: unknown): string {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  reportError(message);
  return message;
}

export const api = {
  listProfiles(): Promise<Profile[]> {
    return invoke("list_profiles");
  },

  saveProfile(profile: Profile): Promise<Profile> {
    return invoke("save_profile", { profile });
  },

  deleteProfile(id: string): Promise<void> {
    return invoke("delete_profile", { id });
  },

  testConnection(
    profile: Profile,
    password: string,
    sshSecret: string,
  ): Promise<string> {
    return invoke("test_connection", { profile, password, sshSecret });
  },

  connect(
    profile: Profile,
    password: string,
    sshSecret: string,
  ): Promise<SessionInfo> {
    return invoke("connect", { profile, password, sshSecret });
  },

  switchDatabase(connectionId: string, database: string): Promise<SessionInfo> {
    return invoke("switch_database", { connectionId, database });
  },

  disconnect(connectionId: string): Promise<void> {
    return invoke("disconnect", { connectionId });
  },

  saveCredentials(
    profileId: string,
    password: string,
    sshSecret: string,
  ): Promise<void> {
    return invoke("save_credentials", { profileId, password, sshSecret });
  },

  loadCredentials(profileId: string): Promise<SavedCredentials | null> {
    return invoke("load_credentials", { profileId });
  },

  deleteCredentials(profileId: string): Promise<void> {
    return invoke("delete_credentials", { profileId });
  },

  listSchemas(connectionId: string): Promise<string[]> {
    return invoke("list_schemas", { connectionId });
  },

  listEnumTypes(connectionId: string): Promise<string[]> {
    return invoke("list_enum_types", { connectionId });
  },

  listDatabases(connectionId: string): Promise<string[]> {
    return invoke("list_databases", { connectionId });
  },

  listTables(connectionId: string, schema: string): Promise<TableInfo[]> {
    return invoke("list_tables", { connectionId, schema });
  },

  describeTable(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<TableColumn[]> {
    return invoke("describe_table", { connectionId, schema, table });
  },

  tablePage(
    connectionId: string,
    schema: string,
    table: string,
    page: number,
    pageSize: number,
  ): Promise<QueryResult> {
    return invoke("table_page", { connectionId, schema, table, page, pageSize });
  },

  insertRow(
    connectionId: string,
    schema: string,
    table: string,
    cells: CellInput[],
  ): Promise<QueryResult> {
    return invoke("insert_row", { connectionId, schema, table, cells });
  },

  updateRow(
    connectionId: string,
    schema: string,
    table: string,
    values: CellInput[],
    keys: CellInput[],
  ): Promise<QueryResult> {
    return invoke("update_row", {
      connectionId,
      schema,
      table,
      values,
      keys,
    });
  },

  deleteRow(
    connectionId: string,
    schema: string,
    table: string,
    keys: CellInput[],
  ): Promise<QueryResult> {
    return invoke("delete_row", { connectionId, schema, table, keys });
  },

  runQuery(connectionId: string, sql: string): Promise<QueryResult> {
    return invoke("run_query", { connectionId, sql });
  },

  createSchema(
    connectionId: string,
    database: string,
    name: string,
  ): Promise<QueryResult> {
    return invoke("create_schema", { connectionId, database, name });
  },

  dropSchema(connectionId: string, schema: string): Promise<QueryResult> {
    return invoke("drop_schema", { connectionId, schema });
  },

  createDatabase(connectionId: string, name: string): Promise<QueryResult> {
    return invoke("create_database", { connectionId, name });
  },

  dropDatabase(connectionId: string, name: string): Promise<QueryResult> {
    return invoke("drop_database", { connectionId, name });
  },

  renameDatabase(
    connectionId: string,
    name: string,
    newName: string,
  ): Promise<QueryResult> {
    return invoke("rename_database", { connectionId, name, newName });
  },

  createTable(
    connectionId: string,
    schema: string,
    table: string,
    columns: NewColumn[],
  ): Promise<QueryResult> {
    return invoke("create_table", { connectionId, schema, table, columns });
  },

  dropTable(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<QueryResult> {
    return invoke("drop_table", { connectionId, schema, table });
  },

  truncateTable(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<QueryResult> {
    return invoke("truncate_table", { connectionId, schema, table });
  },

  renameTable(
    connectionId: string,
    schema: string,
    table: string,
    newName: string,
  ): Promise<QueryResult> {
    return invoke("rename_table", { connectionId, schema, table, newName });
  },

  addColumn(
    connectionId: string,
    schema: string,
    table: string,
    column: NewColumn,
  ): Promise<QueryResult> {
    return invoke("add_column", { connectionId, schema, table, column });
  },

  editColumn(
    connectionId: string,
    schema: string,
    table: string,
    column: EditColumn,
  ): Promise<QueryResult> {
    return invoke("edit_column", { connectionId, schema, table, column });
  },

  dropColumn(
    connectionId: string,
    schema: string,
    table: string,
    column: string,
  ): Promise<QueryResult> {
    return invoke("drop_column", { connectionId, schema, table, column });
  },

  dbKinds(): Promise<DbKind[]> {
    return invoke("db_kinds");
  },
};
