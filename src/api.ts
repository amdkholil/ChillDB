import { invoke } from "@tauri-apps/api/core";
import type {
  CellInput,
  CreateConstraintInput,
  CreateIndexInput,
  DbKind,
  EditColumn,
  FilterCondition,
  ForeignKeyRef,
  NewColumn,
  Profile,
  QueryResult,
  RoutineInfo,
  SavedCredentials,
  SchemaIndexInfo,
  SessionInfo,
  SortColumn,
  TableColumn,
  TableConstraint,
  TableIndex,
  TableInfo,
  TriggerInfo,
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

  searchTables(connectionId: string, query: string): Promise<TableInfo[]> {
    return invoke("search_tables", { connectionId, query });
  },

  listDatabases(connectionId: string): Promise<string[]> {
    return invoke("list_databases", { connectionId });
  },

  listTables(connectionId: string, schema: string): Promise<TableInfo[]> {
    return invoke("list_tables", { connectionId, schema });
  },

  listRoutines(connectionId: string, schema: string): Promise<RoutineInfo[]> {
    return invoke("list_routines", { connectionId, schema });
  },

  listTriggers(connectionId: string, schema: string): Promise<TriggerInfo[]> {
    return invoke("list_triggers", { connectionId, schema });
  },

  listSchemaIndexes(connectionId: string, schema: string): Promise<SchemaIndexInfo[]> {
    return invoke("list_schema_indexes", { connectionId, schema });
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
    sort?: SortColumn[],
    filters?: FilterCondition[],
    search?: string,
  ): Promise<QueryResult> {
    return invoke("table_page", {
      connectionId,
      schema,
      table,
      page,
      pageSize,
      sort,
      filters,
      search,
    });
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

  deleteRows(
    connectionId: string,
    schema: string,
    table: string,
    rowsKeys: CellInput[][],
  ): Promise<QueryResult> {
    return invoke("delete_rows", {
      connectionId,
      schema,
      table,
      rowsKeys,
    });
  },

  listForeignKeys(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<ForeignKeyRef[]> {
    return invoke("list_foreign_keys", { connectionId, schema, table });
  },

  runQuery(connectionId: string, sql: string): Promise<QueryResult> {
    return invoke("run_query", { connectionId, sql });
  },

  dumpTableSql(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<string> {
    return invoke("dump_table_sql", { connectionId, schema, table });
  },

  dumpDatabaseSql(
    connectionId: string,
    schemaOrDb: string,
  ): Promise<string> {
    return invoke("dump_database_sql", { connectionId, schemaOrDb });
  },

  listIndexes(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<TableIndex[]> {
    return invoke("list_indexes", { connectionId, schema, table });
  },

  listConstraints(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<TableConstraint[]> {
    return invoke("list_constraints", { connectionId, schema, table });
  },

  createIndex(
    connectionId: string,
    schema: string,
    table: string,
    input: CreateIndexInput,
  ): Promise<QueryResult> {
    return invoke("create_index", { connectionId, schema, table, input });
  },

  dropIndex(
    connectionId: string,
    schema: string,
    table: string,
    indexName: string,
  ): Promise<QueryResult> {
    return invoke("drop_index", { connectionId, schema, table, indexName });
  },

  createConstraint(
    connectionId: string,
    schema: string,
    table: string,
    input: CreateConstraintInput,
  ): Promise<QueryResult> {
    return invoke("create_constraint", { connectionId, schema, table, input });
  },

  dropConstraint(
    connectionId: string,
    schema: string,
    table: string,
    constraintName: string,
    constraintType: string,
  ): Promise<QueryResult> {
    return invoke("drop_constraint", {
      connectionId,
      schema,
      table,
      constraintName,
      constraintType,
    });
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
