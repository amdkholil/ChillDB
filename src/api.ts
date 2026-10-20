import { invoke } from "@tauri-apps/api/core";
import type {
  CellInput,
  DbKind,
  NewColumn,
  Profile,
  QueryResult,
  SessionInfo,
  TableColumn,
  TableInfo,
} from "./types";

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
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

  disconnect(connectionId: string): Promise<void> {
    return invoke("disconnect", { connectionId });
  },

  listSchemas(connectionId: string): Promise<string[]> {
    return invoke("list_schemas", { connectionId });
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
