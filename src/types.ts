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
  sslMode?: string;
  readOnly?: boolean;
  savePassword: boolean;
  sshEnabled: boolean;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshAuth: SshAuth;
  sshKeyPath: string;
  sshVerifyHost: boolean;
}

export interface SavedCredentials {
  password: string;
  sshSecret: string;
}

export interface SessionInfo {
  id: string;
  kind: DbKind;
  database: string;
  serverVersion: string;
  sslEnabled?: boolean;
  readOnly?: boolean;
}

export interface TableInfo {
  schema: string;
  name: string;
  kind: string;
}

export interface RoutineInfo {
  schema: string;
  name: string;
  routineType: string;
  dataType?: string | null;
}

export interface TriggerInfo {
  schema: string;
  name: string;
  tableName: string;
  event: string;
  timing: string;
}

export interface SchemaIndexInfo {
  schema: string;
  tableName: string;
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  indexType: string;
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
  defaultValue?: string | null;
}

export interface EditColumn {
  name: string;
  newName: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
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

export interface SortColumn {
  column: string;
  desc: boolean;
}

export interface FilterCondition {
  column: string;
  op: string;
  value: string;
}

export interface ForeignKeyRef {
  column: string;
  foreignSchema: string;
  foreignTable: string;
  foreignColumn: string;
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
  selectedRows: Set<number>;
  sort: SortColumn[];
  filters: FilterCondition[];
  search: string;
  filterOpen?: boolean;
  columnConfigOpen?: boolean;
  hiddenColumns: Set<string>;
  columnOrder: string[];
  foreignKeys?: ForeignKeyRef[];
  draftNewRow?: Record<string, string> | null;
  result?: QueryResult;
  columns?: TableColumn[];
  error?: string;
  loading: boolean;
}

export interface TableIndex {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  indexType: string;
}

export interface TableConstraint {
  name: string;
  constraintType: string;
  columns: string[];
  checkClause?: string;
  foreignSchema?: string;
  foreignTable?: string;
  foreignColumns?: string[];
  onDelete?: string;
  onUpdate?: string;
}

export interface CreateIndexInput {
  name: string;
  columns: string[];
  unique: boolean;
  indexType?: string;
}

export interface CreateConstraintInput {
  name: string;
  constraintType: string;
  columns: string[];
  checkClause?: string;
  foreignSchema?: string;
  foreignTable?: string;
  foreignColumns?: string[];
  onDelete?: string;
  onUpdate?: string;
}

export interface StructureTab {
  id: string;
  type: "structure";
  title: string;
  profileId: string;
  connectionId: string;
  schema: string;
  table: string;
  activeSection?: "columns" | "indexes" | "constraints";
  columns?: TableColumn[];
  indexes?: TableIndex[];
  constraints?: TableConstraint[];
  loading: boolean;
  error?: string;
}

export interface CreateTableColumn extends NewColumn {
  enumValues?: string;
}

export interface CreateTableTab {
  id: string;
  type: "create-table";
  title: string;
  profileId: string;
  connectionId: string;
  schema: string;
  tableName: string;
  columns: CreateTableColumn[];
}

export type ViewTab = QueryTab | TableTab | StructureTab | CreateTableTab;

export interface ConnectionState {
  profile: Profile;
  session: SessionInfo;
  schemas: string[] | null;
  databases: string[] | null;
  tables: Record<string, TableInfo[] | undefined>;
  routines: Record<string, RoutineInfo[] | undefined>;
  triggers: Record<string, TriggerInfo[] | undefined>;
  indexes: Record<string, SchemaIndexInfo[] | undefined>;
  expandedSections: Set<string>; // key: "schema:routines" | "schema:triggers" | "schema:indexes"
  expanded: boolean;
  expandedSchemas: Set<string>;
  loadingSchemas: boolean;
  loadingDatabases: boolean;
  enumTypes: string[];
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
