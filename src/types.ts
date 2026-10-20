export type DbKind = "postgres" | "mysql";
export type SshAuth = "password" | "key";

export interface Profile {
  id: string;
  name: string;
  kind: DbKind;
  host: string;
  port: number;
  username: string;
  database: string;
  ssl: boolean;
  sshEnabled: boolean;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshAuth: SshAuth;
  sshKeyPath: string;
  sshVerifyHost: boolean;
}

export interface SessionInfo {
  id: string;
  kind: DbKind;
  database: string;
  serverVersion: string;
}

export interface TableInfo {
  schema: string;
  name: string;
  kind: string;
}

export interface ColumnInfo {
  name: string;
  typeName: string;
}

export interface QueryResult {
  columns: ColumnInfo[];
  rows: unknown[][];
  rowsAffected: number | null;
  totalRows: number | null;
  durationMs: number;
  statement: string;
}

export interface TableColumn {
  name: string;
  typeName: string;
  nullable: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
  autoIncrement: boolean;
}

export interface NewColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
}

export interface CellInput {
  column: string;
  value: string | null;
}

export interface QueryTab {
  id: string;
  type: "query";
  title: string;
  profileId: string;
  connectionId: string;
  sql: string;
  result?: QueryResult;
  error?: string;
  running: boolean;
}

export interface TableTab {
  id: string;
  type: "table";
  title: string;
  profileId: string;
  connectionId: string;
  schema: string;
  table: string;
  isView: boolean;
  page: number;
  pageSize: number;
  selectedRow: number | null;
  result?: QueryResult;
  error?: string;
  loading: boolean;
}

export type ViewTab = QueryTab | TableTab;

export interface ConnectionState {
  profile: Profile;
  session: SessionInfo;
  schemas: string[] | null;
  databases: string[] | null;
  tables: Record<string, TableInfo[] | undefined>;
  expanded: boolean;
  expandedSchemas: Set<string>;
  loadingSchemas: boolean;
  loadingDatabases: boolean;
  loadingTables: Set<string>;
  error?: string;
}

export interface HistoryEntry {
  at: number;
  connection: string;
  sql: string;
  durationMs: number;
  ok: boolean;
}
