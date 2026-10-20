import "./style.css";
import { api, errorMessage, reportError } from "./api";
import { icons } from "./icons";
import { closeModal, confirmDialog, esc, fmtMs, openModal, spinner, toast } from "./ui";
import type {
  CellInput,
  ConnectionState,
  CreateTableColumn,
  CreateTableTab,
  DbKind,
  EditColumn,
  HistoryEntry,
  NewColumn,
  Profile,
  QueryTab,
  QueryResult,
  StructureTab,
  TableColumn,
  TableTab,
  ViewTab,
} from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;

window.addEventListener("error", (event) => {
  reportError(
    event.error instanceof Error ? event.error.message : event.message,
    "Unhandled error",
  );
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  reportError(
    typeof reason === "string"
      ? reason
      : reason instanceof Error
        ? reason.message
        : String(reason),
    "Unhandled rejection",
  );
});

let profiles: Profile[] = [];
const conns = new Map<string, ConnectionState>();
const tabs: ViewTab[] = [];
let activeTabId: string | null = null;
let lastProfileId: string | null = null;
let querySeq = 1;

interface Secrets {
  password: string;
  sshSecret: string;
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function activeTab(): ViewTab | undefined {
  return tabs.find((tab) => tab.id === activeTabId);
}

function defaultPort(kind: DbKind): number {
  return kind === "postgres" ? 5432 : 3306;
}

/* ---------------------------------------------------------------- history */

const HISTORY_KEY = "chilldb.history";

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function pushHistory(entry: HistoryEntry): void {
  const entries = loadHistory();
  entries.unshift(entry);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 100)));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ shell */

function renderShell(): void {
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">${icons.database}</span>
          <span class="brand-text">
            <strong>ChillDB</strong>
            <small>PostgreSQL · MySQL · MariaDB</small>
          </span>
        </div>
        <span class="spacer"></span>
        <button class="btn ghost" data-action="history">${icons.history} History</button>
        <button class="btn ghost" data-action="new-query">${icons.terminal} New query</button>
        <button class="btn primary" data-action="add-connection">${icons.plus} New connection</button>
      </header>
      <div class="body">
        <aside class="sidebar">
          <div class="sidebar-head">
            <span>Connections</span>
            <button class="icon-btn" title="New connection" data-action="add-connection">${icons.plus}</button>
          </div>
          <div id="connection-list" class="connection-list"></div>
          <div class="sidebar-foot" id="sidebar-status"></div>
        </aside>
        <main class="main">
          <div id="tabbar" class="tabbar"></div>
          <div id="workspace" class="workspace"></div>
        </main>
      </div>
    </div>
  `;
}

/* ---------------------------------------------------------------- sidebar */

function renderSidebar(): void {
  const list = byId<HTMLDivElement>("connection-list");
  if (!list) return;

  if (profiles.length === 0) {
    list.innerHTML = `
      <div class="empty-connections">
        <span class="empty-icon">${icons.database}</span>
        <p>No connections yet.</p>
        <button class="btn primary" data-action="add-connection">${icons.plus} Add a connection</button>
      </div>
    `;
  } else {
    list.innerHTML = profiles.map(profileRow).join("");
  }

  const status = byId<HTMLDivElement>("sidebar-status");
  if (status) {
    const count = conns.size;
    status.textContent =
      count === 0
        ? "No active connections"
        : `${count} active connection${count > 1 ? "s" : ""}`;
  }
}

function profileRow(profile: Profile): string {
  const conn = conns.get(profile.id);
  const connected = Boolean(conn);
  const expanded = connected && conn!.expanded;

  return `
    <div class="conn ${connected ? "is-connected" : ""}">
      <div class="conn-row">
        <button class="conn-main" data-action="toggle-profile" data-id="${esc(profile.id)}">
          <span class="chev ${expanded ? "open" : ""}">${icons.chevron}</span>
          <span class="db-badge ${profile.kind}">${profile.kind === "postgres" ? "PG" : "MY"}</span>
          <span class="conn-text">
            <span class="conn-name">${esc(profile.name)}</span>
            <span class="conn-meta">${esc(profile.host)}:${profile.port}${profile.database ? ` · ${esc(profile.database)}` : ""}</span>
          </span>
          ${connected ? '<span class="status-dot" title="Connected"></span>' : ""}
        </button>
        <div class="conn-actions">
          ${
            connected
              ? `<button class="icon-btn" title="Disconnect" data-action="disconnect" data-id="${esc(profile.id)}">${icons.unplug}</button>`
              : `<button class="icon-btn" title="Connect" data-action="connect" data-id="${esc(profile.id)}">${icons.plug}</button>`
          }
          <button class="icon-btn" title="Edit" data-action="edit" data-id="${esc(profile.id)}">${icons.edit}</button>
          <button class="icon-btn danger" title="Delete" data-action="delete" data-id="${esc(profile.id)}">${icons.trash}</button>
        </div>
      </div>
      ${conn?.error ? `<div class="conn-error">${esc(conn.error)}</div>` : ""}
      ${expanded ? treeHtml(profile, conn!) : ""}
    </div>
  `;
}

function isViewKind(kind: string): boolean {
  return kind.toUpperCase().includes("VIEW");
}

function treeHtml(profile: Profile, conn: ConnectionState): string {
  if (conn.loadingSchemas) {
    return `<div class="tree"><div class="tree-loading">${spinner("Loading objects…")}</div></div>`;
  }
  const schemas = conn.schemas;
  if (!schemas) return "";

  const schemaSection = schemasSectionHtml(profile, conn, schemas);
  if (profile.kind === "postgres") {
    return `<div class="tree">${databasesHtml(conn, schemaSection)}</div>`;
  }
  return `<div class="tree">${schemaSection}</div>`;
}

function schemasSectionHtml(
  profile: Profile,
  conn: ConnectionState,
  schemas: string[],
): string {
  const label = profile.kind === "postgres" ? "schema" : "database";
  if (schemas.length === 0) {
    return `<div class="tree-loading">No ${label}s found</div>`;
  }

  return `
    <div class="tree-caption">
      <span>${schemas.length} ${label}${schemas.length > 1 ? "s" : ""}</span>
      <span class="spacer"></span>
      ${
        profile.kind === "mysql"
          ? `<button class="icon-btn tiny" title="New database" data-action="create-database" data-id="${esc(profile.id)}">${icons.plus}</button>`
          : ""
      }
    </div>
    ${schemas
      .map((schema) => {
        const open = conn.expandedSchemas.has(schema);
        return `
          <div class="tree-node">
            <div class="tree-line">
              <button class="tree-row" data-action="toggle-schema" data-id="${esc(profile.id)}" data-schema="${esc(schema)}">
                <span class="chev ${open ? "open" : ""}">${icons.chevron}</span>
                <span class="tree-icon">${icons.folder}</span>
                <span class="tree-name">${esc(schema)}</span>
              </button>
              <button class="icon-btn tiny" title="New table" data-action="create-table" data-id="${esc(profile.id)}" data-schema="${esc(schema)}">${icons.plus}</button>
            </div>
            ${open ? tablesHtml(profile, conn, schema) : ""}
          </div>
        `;
      })
      .join("")}
  `;
}

function databasesHtml(
  conn: ConnectionState,
  schemaSection: string,
): string {
  if (conn.loadingDatabases && !conn.databases) {
    return `<div class="tree-loading">${spinner("Loading databases…")}</div>`;
  }
  const databases = conn.databases;
  if (!databases) return "";

  return `
    <div class="tree-group">
      <div class="tree-caption">
        <span>${databases.length} database${databases.length === 1 ? "" : "s"}</span>
        <span class="spacer"></span>
        <button class="icon-btn tiny" title="New database" data-action="create-database" data-id="${esc(conn.profile.id)}">${icons.plus}</button>
      </div>
      ${databases
        .map((database) => {
          const current = database === conn.session.database;
          return `
        <div class="tree-node">
          <div class="tree-line db-line ${current ? "current" : ""}">
            <button class="tree-row ${current ? "static" : ""}" title="${
              current ? "Current database" : `Open database ${esc(database)}`
            }" ${
              current
                ? 'type="button"'
                : `type="button" data-action="switch-database" data-id="${esc(conn.profile.id)}" data-database="${esc(database)}"`
            }>
              <span class="chev ${current ? "open" : ""}">${icons.chevron}</span>
              <span class="tree-icon">${icons.database}</span>
              <span class="tree-name">${esc(database)}</span>
              ${current ? '<span class="tag">current</span>' : ""}
            </button>
            <button class="icon-btn tiny" title="New schema in ${esc(database)}" data-action="create-schema" data-id="${esc(conn.profile.id)}" data-database="${esc(database)}">${icons.plus}</button>
          </div>
          ${
            current
              ? `<div class="tree-children">${schemaSection}</div>`
              : ""
          }
        </div>
      `;
        })
        .join("")}
    </div>
  `;
}

function tablesHtml(
  profile: Profile,
  conn: ConnectionState,
  schema: string,
): string {
  if (conn.loadingTables.has(schema)) {
    return `<div class="tree-loading nested">${spinner("Loading tables…")}</div>`;
  }
  const tables = conn.tables[schema];
  if (!tables) return "";
  if (tables.length === 0) {
    return `<div class="tree-loading nested">No tables</div>`;
  }
  return tables
    .map((table) => {
      const isView = isViewKind(table.kind);
      return `
        <div class="tree-line">
          <button class="tree-row nested" data-action="open-table"
            data-id="${esc(profile.id)}" data-schema="${esc(table.schema)}"
            data-table="${esc(table.name)}" data-kind="${esc(table.kind)}">
            <span class="tree-icon">${isView ? icons.view : icons.table}</span>
            <span class="tree-name">${esc(table.name)}</span>
            ${isView ? '<span class="tag">view</span>' : ""}
          </button>
        </div>
      `;
    })
    .join("");
}

/* ----------------------------------------------------------------- tabbar */

function renderTabbar(): void {
  const bar = byId<HTMLDivElement>("tabbar");
  if (!bar) return;

  if (tabs.length === 0) {
    bar.innerHTML = `<span class="tabbar-empty">No open tabs</span>`;
    return;
  }

  bar.innerHTML = tabs
    .map(
      (tab) => `
      <div class="tab ${tab.id === activeTabId ? "active" : ""}" data-action="activate-tab" data-tab-id="${tab.id}">
        <span class="tab-icon">${
          tab.type === "query"
            ? icons.terminal
            : tab.type === "table"
              ? icons.table
              : tab.type === "structure"
                ? icons.columns
                : icons.plus
        }</span>
        <span class="tab-title">${esc(tab.title)}</span>
        <button class="tab-close" title="Close" data-action="close-tab" data-tab-id="${tab.id}">${icons.x}</button>
      </div>
    `,
    )
    .join("");
}

/* -------------------------------------------------------------- workspace */

function renderWorkspace(): void {
  const ws = byId<HTMLDivElement>("workspace");
  if (!ws) return;

  const tab = activeTab();
  if (!tab) {
    ws.innerHTML = `
      <div class="welcome">
        <span class="welcome-mark">${icons.bolt}</span>
        <h1>ChillDB</h1>
        <p>Connect to a PostgreSQL or MySQL/MariaDB database, then open a table or write a query.</p>
        <div class="welcome-actions">
          <button class="btn primary" data-action="add-connection">${icons.plus} New connection</button>
          <button class="btn ghost" data-action="new-query">${icons.terminal} New query</button>
        </div>
      </div>
    `;
    return;
  }

  if (tab.type === "query") renderQueryTab(ws, tab);
  else if (tab.type === "table") renderTableTab(ws, tab);
  else if (tab.type === "structure") renderStructureTab(ws, tab);
  else renderCreateTableTab(ws, tab);
}

function connectionOptions(selectedId: string): string {
  const options = [...conns.values()].map(
    (conn) =>
      `<option value="${esc(conn.session.id)}" ${conn.session.id === selectedId ? "selected" : ""}>${esc(conn.profile.name)} (${esc(conn.profile.database || conn.session.database || conn.profile.host)})</option>`,
  );
  if (!conns.has(selectedId) && ![...conns.values()].some((c) => c.session.id === selectedId)) {
    options.unshift(`<option value="${esc(selectedId)}" selected>(disconnected)</option>`);
  }
  return options.join("");
}

function renderQueryTab(ws: HTMLDivElement, tab: QueryTab): void {
  ws.innerHTML = `
    <div class="view">
      <div class="view-toolbar">
        <span class="view-label">${icons.terminal} Query</span>
        <select class="select" id="query-conn-select" title="Connection">${connectionOptions(tab.connectionId)}</select>
        <span class="spacer"></span>
        <span class="hint"><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> to run selection</span>
        <button class="btn primary" id="btn-run">${icons.play} Run</button>
      </div>
      <div class="editor-wrap">
        <textarea id="sql-editor" spellcheck="false" placeholder="SELECT * FROM users LIMIT 50;">${esc(tab.sql)}</textarea>
      </div>
      <div class="result-panel" id="result-panel">${resultPanelHtml(tab)}</div>
    </div>
  `;

  const editor = byId<HTMLTextAreaElement>("sql-editor");
  editor?.addEventListener("input", () => {
    tab.sql = editor.value;
  });
  editor?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void runQuery(tab);
    }
  });

  byId<HTMLSelectElement>("query-conn-select")?.addEventListener("change", (event) => {
    const select = event.target as HTMLSelectElement;
    const conn = [...conns.values()].find((c) => c.session.id === select.value);
    if (conn) {
      tab.connectionId = conn.session.id;
      tab.profileId = conn.profile.id;
      tab.result = undefined;
      tab.error = undefined;
      updateResultPanel(tab);
    }
  });

  byId<HTMLButtonElement>("btn-run")?.addEventListener("click", () => {
    void runQuery(tab);
  });

  editor?.focus();
}

function renderTableTab(ws: HTMLDivElement, tab: TableTab): void {
  const conn = conns.get(tab.profileId);
  const kind = conn?.profile.kind ?? "postgres";
  const editable = !tab.isView;

  ws.innerHTML = `
    <div class="view">
      <div class="view-toolbar">
        <span class="view-label">${icons.table}
          <span class="crumb">${esc(tab.schema)}</span>.<strong>${esc(tab.table)}</strong>
        </span>
        <span class="spacer"></span>
        ${
          editable
            ? `
          <button class="btn" data-action="insert-row">${icons.plus} Add row</button>
          <button class="btn danger" id="btn-delete-row" data-action="delete-row">${icons.trash} Delete</button>
          <span class="toolbar-sep"></span>
        `
            : `<span class="tag">view</span>`
        }
        <button class="btn" id="btn-refresh" data-action="refresh-table">${icons.refresh} Refresh</button>
      </div>
      <div class="result-panel" id="result-panel">${resultPanelHtml(tab)}</div>
      <div class="table-bar">
        <span id="table-count" class="table-count"></span>
        <span class="spacer"></span>
        <button class="btn ghost small" id="btn-prev">Prev</button>
        <span id="page-info" class="page-info"></span>
        <button class="btn ghost small" id="btn-next">Next</button>
        <select class="select small" id="page-size" title="Rows per page">
          ${[100, 200, 500, 1000]
            .map(
              (size) =>
                `<option value="${size}" ${size === tab.pageSize ? "selected" : ""}>${size} / page</option>`,
            )
            .join("")}
        </select>
        <span class="db-kind-tag">${kind === "postgres" ? "PostgreSQL" : "MySQL"}</span>
      </div>
    </div>
  `;

  byId<HTMLButtonElement>("btn-refresh")?.addEventListener("click", () => {
    tab.selectedRow = null;
    void loadPreview(tab);
  });

  byId<HTMLButtonElement>("btn-prev")?.addEventListener("click", () => {
    if (tab.page <= 1 || tab.loading) return;
    tab.page -= 1;
    tab.selectedRow = null;
    void loadPreview(tab);
  });

  byId<HTMLButtonElement>("btn-next")?.addEventListener("click", () => {
    if (tab.loading) return;
    const totalPages = pageCount(tab);
    if (tab.page >= totalPages) return;
    tab.page += 1;
    tab.selectedRow = null;
    void loadPreview(tab);
  });

  byId<HTMLSelectElement>("page-size")?.addEventListener("change", (event) => {
    const select = event.target as HTMLSelectElement;
    tab.pageSize = Number(select.value) || 200;
    tab.page = 1;
    tab.selectedRow = null;
    void loadPreview(tab);
  });

  updateTableToolbar(tab);
}

function pageCount(tab: TableTab): number {
  const total = tab.result?.totalRows;
  if (total === null || total === undefined) return 1;
  return Math.max(1, Math.ceil(total / tab.pageSize));
}

function updateTableToolbar(tab: TableTab): void {
  if (activeTab() !== tab) return;

  const count = byId<HTMLSpanElement>("table-count");
  if (count) {
    const total = tab.result?.totalRows;
    if (tab.loading) {
      count.textContent = "Loading…";
    } else if (total === null || total === undefined) {
      count.textContent = "";
    } else {
      count.textContent = `${total.toLocaleString()} row${total === 1 ? "" : "s"}`;
    }
  }

  const info = byId<HTMLSpanElement>("page-info");
  if (info) {
    const totalPages = pageCount(tab);
    info.textContent = `Page ${Math.min(tab.page, totalPages)} of ${totalPages}`;
  }

  const prev = byId<HTMLButtonElement>("btn-prev");
  if (prev) prev.disabled = tab.loading || tab.page <= 1;
  const next = byId<HTMLButtonElement>("btn-next");
  if (next) next.disabled = tab.loading || tab.page >= pageCount(tab);

  const del = byId<HTMLButtonElement>("btn-delete-row");
  if (del) del.disabled = tab.loading || tab.selectedRow === null;
}

function openCreateSchemaModal(profileId: string, database: string): void {
  const conn = conns.get(profileId);
  if (!conn) return;

  const backdrop = openModal(`
    <form class="modal small" id="create-schema-form" novalidate>
      <div class="modal-head">
        <div>
          <h2>New schema</h2>
          <small class="modal-subtitle">${esc(database)}</small>
        </div>
        <button type="button" class="icon-btn" data-close="true" aria-label="Close">${icons.x}</button>
      </div>
      <div class="modal-body">
        <label class="field wide">
          <span>Schema name</span>
          <input name="schemaName" placeholder="my_schema" autocomplete="off" spellcheck="false" required />
        </label>
        <div class="form-status wide" id="create-schema-status"></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-close="true">Cancel</button>
        <span class="spacer"></span>
        <button type="submit" class="btn primary">${icons.plus} Create schema</button>
      </div>
    </form>
  `);

  const form = backdrop.querySelector<HTMLFormElement>(
    "#create-schema-form",
  )!;
  const status = backdrop.querySelector<HTMLDivElement>(
    "#create-schema-status",
  )!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("schemaName") ?? "").trim();
    if (!name) {
      status.className = "form-status wide error";
      status.textContent = "A schema name is required.";
      return;
    }
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    submit.disabled = true;
    status.className = "form-status wide info";
    status.innerHTML = spinner("Creating schema…");
    try {
      await api.createSchema(conn.session.id, database, name);
      closeModal();
      if (database === conn.session.database) {
        conn.schemas = await api.listSchemas(conn.session.id);
        conn.expandedSchemas.add(name);
        delete conn.tables[name];
        renderSidebar();
        void loadTables(profileId, name);
        toast(`Schema "${name}" created`, "success");
      } else {
        toast(`Schema "${name}" created in "${database}"`, "success");
      }
    } catch (error) {
      submit.disabled = false;
      status.className = "form-status wide error";
      status.textContent = errorMessage(error);
    }
  });
}

function openCreateDatabaseModal(profileId: string): void {
  const conn = conns.get(profileId);
  if (!conn) return;

  const backdrop = openModal(`
    <form class="modal small" id="create-database-form" novalidate>
      <div class="modal-head">
        <div>
          <h2>New database</h2>
          <small class="modal-subtitle">${esc(conn.profile.name)}</small>
        </div>
        <button type="button" class="icon-btn" data-close="true" aria-label="Close">${icons.x}</button>
      </div>
      <div class="modal-body">
        <label class="field wide">
          <span>Database name</span>
          <input name="databaseName" placeholder="my_database" autocomplete="off" spellcheck="false" required />
        </label>
        <div class="form-status wide" id="create-database-status"></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-close="true">Cancel</button>
        <span class="spacer"></span>
        <button type="submit" class="btn primary">${icons.plus} Create database</button>
      </div>
    </form>
  `);

  const form = backdrop.querySelector<HTMLFormElement>(
    "#create-database-form",
  )!;
  const status = backdrop.querySelector<HTMLDivElement>(
    "#create-database-status",
  )!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("databaseName") ?? "").trim();
    if (!name) {
      status.className = "form-status wide error";
      status.textContent = "A database name is required.";
      return;
    }
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    submit.disabled = true;
    status.className = "form-status wide info";
    status.innerHTML = spinner("Creating database…");
    try {
      await api.createDatabase(conn.session.id, name);
      if (conn.profile.kind === "postgres") {
        conn.databases = await api.listDatabases(conn.session.id);
      } else {
        conn.schemas = await api.listSchemas(conn.session.id);
        conn.expandedSchemas.add(name);
        delete conn.tables[name];
      }
      closeModal();
      renderSidebar();
      if (conn.profile.kind === "mysql") void loadTables(profileId, name);
      toast(`Database "${name}" created`, "success");
    } catch (error) {
      submit.disabled = false;
      status.className = "form-status wide error";
      status.textContent = errorMessage(error);
    }
  });
}

function openCreateTableTab(profileId: string, schema: string): void {
  const conn = conns.get(profileId);
  if (!conn) return;

  const existing = tabs.find(
    (tab): tab is CreateTableTab =>
      tab.type === "create-table" &&
      tab.profileId === profileId &&
      tab.schema === schema,
  );
  if (existing) {
    activeTabId = existing.id;
    renderTabbar();
    renderWorkspace();
    return;
  }

  const kind = conn.profile.kind;
  const tab: CreateTableTab = {
    id: crypto.randomUUID(),
    type: "create-table",
    title: `New table · ${schema}`,
    profileId,
    connectionId: conn.session.id,
    schema,
    tableName: "",
    columns: [
      {
        name: "",
        dataType: columnTypes(kind)[0],
        nullable: true,
        primaryKey: false,
        defaultValue: "",
        enumValues: "",
      },
    ],
  };
  tabs.push(tab);
  activeTabId = tab.id;
  lastProfileId = profileId;
  renderTabbar();
  renderWorkspace();
}

function createTableRowHtml(
  kind: DbKind,
  column: CreateTableColumn,
  index: number,
  enumTypes: string[],
): string {
  return `
    <div class="create-column with-default" data-create-row="${index}">
      <input data-create-field="name" value="${esc(column.name)}" placeholder="column_name" autocomplete="off" spellcheck="false" />
      <select data-create-field="type">${typeOptionsHtml(kind, column.dataType, enumTypes)}</select>
      <input data-create-field="default" value="${esc(column.defaultValue ?? "")}" placeholder="0, 'text', CURRENT_TIMESTAMP" autocomplete="off" spellcheck="false" />
      <label class="check"><input type="checkbox" data-create-field="nullable" ${column.nullable ? "checked" : ""} /><span>NULL</span></label>
      <label class="check"><input type="checkbox" data-create-field="pk" ${column.primaryKey ? "checked" : ""} /><span>PK</span></label>
      <button type="button" class="icon-btn tiny danger" data-remove-column title="Remove column">${icons.x}</button>
      ${
        kind === "mysql"
          ? `<input class="create-enum-values" data-create-field="enumValues" value="${esc(column.enumValues ?? "")}" placeholder="Enum values, comma separated" autocomplete="off" spellcheck="false" ${column.dataType === "enum" ? "" : "hidden"} />`
          : ""
      }
    </div>
  `;
}

function renderCreateTableTab(ws: HTMLDivElement, tab: CreateTableTab): void {
  const conn = conns.get(tab.profileId);
  const kind = conn?.profile.kind ?? "postgres";
  const enumTypes = kind === "postgres" ? (conn?.enumTypes ?? []) : [];

  ws.innerHTML = `
    <div class="view">
      <div class="view-toolbar">
        <span class="view-label">${icons.plus}
          <span class="crumb">${esc(tab.schema)}</span>.<strong>New table</strong>
        </span>
        <span class="spacer"></span>
        <button class="btn ghost" id="btn-cancel-create">Cancel</button>
        <button class="btn primary" id="btn-create-table" type="submit" form="create-table-form">
          ${icons.plus} Create table
        </button>
      </div>
      <div class="structure-panel">
        <form class="create-table-form" id="create-table-form" novalidate>
          <label class="field wide">
            <span>Table name</span>
            <input name="tableName" value="${esc(tab.tableName)}" placeholder="my_table" autocomplete="off" spellcheck="false" required />
          </label>
          <div class="create-columns-head">
            <span>Columns</span>
            <span class="spacer"></span>
            <button type="button" class="btn ghost small" id="btn-add-column">${icons.plus} Add column</button>
          </div>
          <div class="create-columns" id="create-columns">
            <div class="create-column with-default create-column-head">
              <span>Name</span>
              <span>Type</span>
              <span>Default</span>
              <span>Nullable</span>
              <span>PK</span>
              <span></span>
            </div>
            ${tab.columns
              .map((column, index) =>
                createTableRowHtml(kind, column, index, enumTypes),
              )
              .join("")}
          </div>
          <div class="form-status wide" id="create-table-status"></div>
        </form>
      </div>
    </div>
  `;

  const form = ws.querySelector<HTMLFormElement>("#create-table-form")!;
  const status = ws.querySelector<HTMLDivElement>("#create-table-status")!;
  const tableNameInput =
    ws.querySelector<HTMLInputElement>('[name="tableName"]')!;
  tableNameInput.addEventListener("input", () => {
    tab.tableName = tableNameInput.value;
  });

  ws.querySelectorAll<HTMLElement>("[data-create-row]").forEach((row) => {
    const index = Number(row.dataset.createRow);
    const column = tab.columns[index];
    if (!column) return;

    row
      .querySelector<HTMLInputElement>('[data-create-field="name"]')
      ?.addEventListener("input", (event) => {
        column.name = (event.target as HTMLInputElement).value;
      });
    const enumInput = row.querySelector<HTMLInputElement>(
      '[data-create-field="enumValues"]',
    );
    row
      .querySelector<HTMLSelectElement>('[data-create-field="type"]')
      ?.addEventListener("change", (event) => {
        column.dataType = (event.target as HTMLSelectElement).value;
        if (enumInput) enumInput.hidden = column.dataType !== "enum";
      });
    enumInput?.addEventListener("input", () => {
      column.enumValues = enumInput.value;
    });
    row
      .querySelector<HTMLInputElement>('[data-create-field="default"]')
      ?.addEventListener("input", (event) => {
        column.defaultValue = (event.target as HTMLInputElement).value;
      });
    row
      .querySelector<HTMLInputElement>('[data-create-field="nullable"]')
      ?.addEventListener("change", (event) => {
        column.nullable = (event.target as HTMLInputElement).checked;
      });
    row
      .querySelector<HTMLInputElement>('[data-create-field="pk"]')
      ?.addEventListener("change", (event) => {
        column.primaryKey = (event.target as HTMLInputElement).checked;
      });
    row
      .querySelector<HTMLButtonElement>("[data-remove-column]")
      ?.addEventListener("click", () => {
        if (tab.columns.length <= 1) {
          toast("A table needs at least one column", "error");
          return;
        }
        tab.columns.splice(index, 1);
        renderWorkspace();
      });
  });

  ws.querySelector<HTMLButtonElement>("#btn-add-column")?.addEventListener(
    "click",
    () => {
      tab.columns.push({
        name: "",
        dataType: columnTypes(kind)[0],
        nullable: true,
        primaryKey: false,
        defaultValue: "",
        enumValues: "",
      });
      renderWorkspace();
    },
  );

  ws.querySelector<HTMLButtonElement>("#btn-cancel-create")?.addEventListener(
    "click",
    () => closeTab(tab.id),
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tableName = tab.tableName.trim();
    if (!tableName) {
      status.className = "form-status wide error";
      status.textContent = "A table name is required.";
      return;
    }

    const missing = tab.columns.findIndex(
      (column) => !column.name.trim(),
    );
    if (missing !== -1) {
      status.className = "form-status wide error";
      status.textContent = `Column ${missing + 1} needs a name.`;
      return;
    }
    const names = tab.columns.map((column) => column.name.trim());
    if (new Set(names).size !== names.length) {
      status.className = "form-status wide error";
      status.textContent = "Column names must be unique.";
      return;
    }

    const invalidEnum = tab.columns.findIndex(
      (column) =>
        column.dataType === "enum" &&
        !(column.enumValues ?? "")
          .split(",")
          .some((value) => value.trim()),
    );
    if (invalidEnum !== -1) {
      status.className = "form-status wide error";
      status.textContent = `Column ${invalidEnum + 1} needs at least one enum value.`;
      return;
    }

    const columns: NewColumn[] = tab.columns.map((column) => ({
      name: column.name.trim(),
      dataType:
        column.dataType === "enum"
          ? mysqlEnumType(column.enumValues ?? "")
          : column.dataType,
      nullable: column.nullable,
      primaryKey: column.primaryKey,
      defaultValue: (column.defaultValue ?? "").trim() || null,
    }));

    const submit = ws.querySelector<HTMLButtonElement>("#btn-create-table")!;
    submit.disabled = true;
    status.className = "form-status wide info";
    status.innerHTML = spinner("Creating table…");
    try {
      await api.createTable(
        tab.connectionId,
        tab.schema,
        tableName,
        columns,
      );
      const conn = conns.get(tab.profileId);
      if (conn) {
        delete conn.tables[tab.schema];
        conn.expandedSchemas.add(tab.schema);
      }
      closeTab(tab.id);
      renderSidebar();
      void loadTables(tab.profileId, tab.schema);
      openTableTab(tab.profileId, tab.schema, tableName, "BASE TABLE");
      toast(`Table "${tableName}" created`, "success");
    } catch (error) {
      submit.disabled = false;
      status.className = "form-status wide error";
      status.textContent = errorMessage(error);
    }
  });
}

function columnTypes(kind: DbKind): string[] {
  if (kind === "postgres") {
    return [
      "integer",
      "bigint",
      "smallint",
      "serial",
      "bigserial",
      "numeric(12,2)",
      "real",
      "double precision",
      "boolean",
      "text",
      "varchar(255)",
      "char(1)",
      "date",
      "time",
      "timestamp",
      "timestamptz",
      "uuid",
      "json",
      "jsonb",
      "bytea",
    ];
  }
  return [
    "int",
    "bigint",
    "smallint",
    "tinyint",
    "decimal(12,2)",
    "float",
    "double",
    "boolean",
    "varchar(255)",
    "char(1)",
    "text",
    "longtext",
    "date",
    "time",
    "datetime",
    "timestamp",
    "json",
    "enum",
    "blob",
    "binary(16)",
  ];
}

function typeOptionsHtml(
  kind: DbKind,
  selected?: string,
  enumTypes: string[] = [],
): string {
  const types = [...columnTypes(kind), ...(kind === "postgres" ? enumTypes : [])];
  if (selected && !types.includes(selected)) types.unshift(selected);
  return types
    .map(
      (type) =>
        `<option value="${esc(type)}" ${type === selected ? "selected" : ""}>${esc(type)}</option>`,
    )
    .join("");
}

function mysqlEnumType(values: string): string {
  const items = values
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return `enum(${items
    .map((value) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`)
    .join(",")})`;
}

function parseMysqlEnum(typeName: string): string | null {
  if (!/^enum\(/i.test(typeName.trim())) return null;
  const inner = typeName.trim().slice(5, -1);
  const values: string[] = [];
  const pattern = /'((?:[^']|'')*)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(inner))) {
    values.push(match[1].replace(/''/g, "'").replace(/\\\\/g, "\\"));
  }
  return values.join(", ");
}

/* -------------------------------------------------------- table structure */

function renderStructureTab(ws: HTMLDivElement, tab: StructureTab): void {
  const conn = conns.get(tab.profileId);
  const kind = conn?.profile.kind ?? "postgres";
  const enumTypes = kind === "postgres" ? (conn?.enumTypes ?? []) : [];

  ws.innerHTML = `
    <div class="view">
      <div class="view-toolbar">
        <span class="view-label">${icons.columns}
          <span class="crumb">${esc(tab.schema)}</span>.<strong>${esc(tab.table)}</strong>
        </span>
        <button class="btn ghost small" id="btn-rename-table" title="Rename table">
          ${icons.edit} Rename table
        </button>
        <span class="spacer"></span>
        <button class="btn" id="btn-refresh-structure">${icons.refresh} Refresh</button>
        <span class="db-kind-tag">${kind === "postgres" ? "PostgreSQL" : "MySQL"}</span>
      </div>
      <div class="structure-panel">
        ${structureHtml(tab)}
        <form class="add-field" id="add-field-form" novalidate>
          <div class="add-field-title">Add field</div>
          <div class="add-field-grid">
            <label class="field">
              <span>Name</span>
              <input name="name" placeholder="new_column" autocomplete="off" spellcheck="false" required />
            </label>
            <label class="field">
              <span>Type</span>
              <select name="type">${typeOptionsHtml(kind, undefined, enumTypes)}</select>
            </label>
            <label class="field" id="add-enum-field" hidden>
              <span>Enum values</span>
              <input name="enumValues" placeholder="active, inactive" autocomplete="off" spellcheck="false" />
            </label>
            <label class="field">
              <span>Default</span>
              <input name="default" placeholder="0, 'text', CURRENT_TIMESTAMP" autocomplete="off" spellcheck="false" />
            </label>
            <label class="check">
              <input type="checkbox" name="nullable" checked />
              <span>Nullable</span>
            </label>
            <button class="btn primary" type="submit">${icons.plus} Add field</button>
          </div>
          <div class="form-status" id="add-field-status"></div>
        </form>
      </div>
    </div>
  `;

  byId<HTMLButtonElement>("btn-rename-table")?.addEventListener("click", () => {
    openRenameTableModal(tab);
  });
  byId<HTMLButtonElement>("btn-refresh-structure")?.addEventListener(
    "click",
    () => void loadStructure(tab),
  );

  ws.querySelectorAll<HTMLButtonElement>("[data-field-action]").forEach(
    (button) => {
      button.addEventListener("click", () => {
        const column = tab.columns?.[Number(button.dataset.fieldIndex)];
        if (!column) return;
        if (button.dataset.fieldAction === "edit") {
          openEditFieldModal(tab, column);
        } else {
          void deleteField(tab, column);
        }
      });
    },
  );

  const form = ws.querySelector<HTMLFormElement>("#add-field-form");
  const typeSelect = form?.querySelector<HTMLSelectElement>('[name="type"]');
  const enumField = form?.querySelector<HTMLElement>("#add-enum-field");
  const syncEnumField = () => {
    if (!enumField) return;
    enumField.hidden = kind !== "mysql" || typeSelect?.value !== "enum";
  };
  typeSelect?.addEventListener("change", syncEnumField);
  syncEnumField();
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void addField(tab, form);
  });
}

function structureHtml(tab: StructureTab): string {
  if (tab.loading) {
    return `<div class="panel-state">${spinner("Loading structure…")}</div>`;
  }
  if (tab.error) {
    return `
      <div class="panel-state error">
        <div class="error-title">Could not load structure</div>
        <pre>${esc(tab.error)}</pre>
      </div>
    `;
  }
  const columns = tab.columns;
  if (!columns) {
    return `<div class="panel-state muted">No structure loaded.</div>`;
  }
  if (columns.length === 0) {
    return `<div class="panel-state muted">This table has no fields.</div>`;
  }

  const rows = columns
    .map(
      (column, index) => `
      <tr>
        <td>
          <span class="structure-field-name">${esc(column.name)}</span>
          ${column.primaryKey ? '<span class="tag pk">PK</span>' : ""}
        </td>
        <td class="structure-type">${esc(column.typeName)}</td>
        <td>${column.nullable ? "YES" : "NO"}</td>
        <td class="structure-default">${
          column.defaultValue === null
            ? "—"
            : esc(column.defaultValue)
        }</td>
        <td>${column.autoIncrement ? "auto increment" : ""}</td>
        <td class="structure-actions-cell">
          <span class="structure-row-actions">
            <button class="icon-btn tiny" data-field-action="edit" data-field-index="${index}" title="Edit field">${icons.edit}</button>
            <button class="icon-btn tiny danger" data-field-action="delete" data-field-index="${index}" title="Delete field">${icons.trash}</button>
          </span>
        </td>
      </tr>
    `,
    )
    .join("");

  return `
    <div class="structure-grid-wrap">
      <table class="grid structure-grid">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Nullable</th>
            <th>Default</th>
            <th>Extra</th>
            <th class="structure-actions-head"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function loadStructure(tab: StructureTab): Promise<void> {
  tab.loading = true;
  tab.error = undefined;
  if (activeTab() === tab) renderWorkspace();

  try {
    tab.columns = await api.describeTable(
      tab.connectionId,
      tab.schema,
      tab.table,
    );
  } catch (error) {
    tab.error = errorMessage(error);
  } finally {
    tab.loading = false;
    if (activeTab() === tab) renderWorkspace();
  }
}

async function refreshAfterStructureChange(tab: StructureTab): Promise<void> {
  for (const other of tabs) {
    if (
      other.type === "table" &&
      other.profileId === tab.profileId &&
      other.schema === tab.schema &&
      other.table === tab.table
    ) {
      other.columns = undefined;
      other.result = undefined;
      void loadPreview(other);
    }
  }
  await loadStructure(tab);
}

function openRenameTableModal(tab: StructureTab): void {
  const backdrop = openModal(`
    <form class="modal small" id="rename-table-form" novalidate>
      <div class="modal-head">
        <div>
          <h2>Rename table</h2>
          <small class="modal-subtitle"><span class="crumb">${esc(tab.schema)}</span>.${esc(tab.table)}</small>
        </div>
        <button type="button" class="icon-btn" data-close="true" aria-label="Close">${icons.x}</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <label class="field wide">
            <span>New table name</span>
            <input name="tableName" value="${esc(tab.table)}" autocomplete="off" spellcheck="false" required />
          </label>
        </div>
        <div class="form-status wide" id="rename-table-status"></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-close="true">Cancel</button>
        <span class="spacer"></span>
        <button type="submit" class="btn primary">${icons.edit} Rename</button>
      </div>
    </form>
  `);

  const form = backdrop.querySelector<HTMLFormElement>("#rename-table-form")!;
  const status = backdrop.querySelector<HTMLDivElement>("#rename-table-status")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const newName = String(data.get("tableName") ?? "").trim();
    if (!newName) {
      status.className = "form-status wide error";
      status.textContent = "A new table name is required.";
      return;
    }
    if (newName === tab.table) {
      closeModal();
      return;
    }

    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    submit.disabled = true;
    status.className = "form-status wide info";
    status.innerHTML = spinner("Renaming table…");
    try {
      await api.renameTable(
        tab.connectionId,
        tab.schema,
        tab.table,
        newName,
      );
      closeModal();
      applyTableRename(tab, newName);
      toast(`Table renamed to ${newName}`, "success");
    } catch (error) {
      submit.disabled = false;
      status.className = "form-status wide error";
      status.textContent = errorMessage(error);
    }
  });
}

function applyTableRename(tab: StructureTab, newName: string): void {
  const oldName = tab.table;
  const conn = conns.get(tab.profileId);
  const cached = conn?.tables[tab.schema];
  if (conn && cached) {
    conn.tables[tab.schema] = cached.map((table) =>
      table.name === oldName ? { ...table, name: newName } : table,
    );
  }

  for (const other of tabs) {
    if (other.type !== "table" && other.type !== "structure") continue;
    if (
      other.profileId !== tab.profileId ||
      other.schema !== tab.schema ||
      other.table !== oldName
    ) {
      continue;
    }
    other.table = newName;
    other.title = `${other.schema}.${newName}`;
    if (other.type === "table") {
      other.columns = undefined;
      other.result = undefined;
      void loadPreview(other);
    }
  }

  renderSidebar();
  renderTabbar();
  renderWorkspace();
}

function editableDefault(column: TableColumn, kind: DbKind): string {
  if (column.defaultValue === null) return "";
  if (kind === "postgres") return column.defaultValue;

  const value = column.defaultValue.trim();
  const upper = value.toUpperCase();
  const expression =
    value.startsWith("(") ||
    upper.startsWith("CURRENT_TIMESTAMP") ||
    upper.startsWith("CURRENT_DATE") ||
    upper.startsWith("CURRENT_TIME") ||
    upper === "NULL";
  if (expression) return value;
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function openEditFieldModal(tab: StructureTab, column: TableColumn): void {
  const conn = conns.get(tab.profileId);
  const kind = conn?.profile.kind ?? "postgres";
  const enumTypes = kind === "postgres" ? (conn?.enumTypes ?? []) : [];
  const originalEnumValues = kind === "mysql" ? parseMysqlEnum(column.typeName) : null;
  const originalDefault = editableDefault(column, kind);
  const backdrop = openModal(`
    <form class="modal small" id="edit-field-form" novalidate>
      <div class="modal-head">
        <div>
          <h2>Edit field</h2>
          <small class="modal-subtitle"><span class="crumb">${esc(tab.schema)}</span>.${esc(tab.table)}</small>
        </div>
        <button type="button" class="icon-btn" data-close="true" aria-label="Close">${icons.x}</button>
      </div>
      <div class="modal-body">
        <p class="row-hint">Renaming or changing a field runs an ALTER TABLE statement. Primary key and auto increment attributes are preserved when the database supports it.</p>
        <div class="form-grid">
          <label class="field">
            <span>Name</span>
            <input name="name" value="${esc(column.name)}" autocomplete="off" spellcheck="false" required />
          </label>
          <label class="field">
            <span>Type</span>
            <select name="type">${typeOptionsHtml(
              kind,
              originalEnumValues !== null ? "enum" : column.typeName,
              enumTypes,
            )}</select>
          </label>
          <label class="field" id="edit-enum-field" ${originalEnumValues === null ? "hidden" : ""}>
            <span>Enum values</span>
            <input name="enumValues" value="${esc(originalEnumValues ?? "")}" placeholder="active, inactive" autocomplete="off" spellcheck="false" />
          </label>
          <label class="field wide">
            <span>Default</span>
            <input name="default" value="${esc(originalDefault)}" placeholder="0, 'text', CURRENT_TIMESTAMP" autocomplete="off" spellcheck="false" />
            <small>Leave blank to remove the default. Use a SQL expression.</small>
          </label>
          <label class="check wide">
            <input type="checkbox" name="nullable" ${column.nullable ? "checked" : ""} />
            <span>Nullable</span>
          </label>
        </div>
        <div class="form-status wide" id="edit-field-status"></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-close="true">Cancel</button>
        <span class="spacer"></span>
        <button type="submit" class="btn primary">${icons.edit} Save field</button>
      </div>
    </form>
  `);

  const form = backdrop.querySelector<HTMLFormElement>("#edit-field-form")!;
  const status = backdrop.querySelector<HTMLDivElement>("#edit-field-status")!;
  const typeSelect = form.querySelector<HTMLSelectElement>('[name="type"]');
  const enumField = form.querySelector<HTMLElement>("#edit-enum-field");
  const syncEnumField = () => {
    if (!enumField) return;
    enumField.hidden = kind !== "mysql" || typeSelect?.value !== "enum";
  };
  typeSelect?.addEventListener("change", syncEnumField);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    let dataType = String(data.get("type") ?? "").trim();
    const edit: EditColumn = {
      name: column.name,
      newName: String(data.get("name") ?? "").trim(),
      dataType,
      nullable: data.get("nullable") === "on",
      defaultValue: String(data.get("default") ?? "").trim() || null,
    };

    if (!edit.newName || !edit.dataType) {
      status.className = "form-status wide error";
      status.textContent = "A field name and type are required.";
      return;
    }
    if (dataType === "enum") {
      const values = String(data.get("enumValues") ?? "").trim();
      if (!values.split(",").some((value) => value.trim())) {
        status.className = "form-status wide error";
        status.textContent = "Enter at least one enum value.";
        return;
      }
      dataType = mysqlEnumType(values);
      edit.dataType = dataType;
    }
    if (
      edit.newName === column.name &&
      edit.dataType === column.typeName &&
      edit.nullable === column.nullable &&
      edit.defaultValue === (originalDefault.trim() || null)
    ) {
      status.className = "form-status wide info";
      status.textContent = "No changes to save.";
      return;
    }

    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    submit.disabled = true;
    status.className = "form-status wide info";
    status.innerHTML = spinner("Saving field…");
    try {
      await api.editColumn(
        tab.connectionId,
        tab.schema,
        tab.table,
        edit,
      );
      closeModal();
      toast("Field updated", "success");
      await refreshAfterStructureChange(tab);
    } catch (error) {
      submit.disabled = false;
      status.className = "form-status wide error";
      status.textContent = errorMessage(error);
    }
  });
}

async function addField(
  tab: StructureTab,
  form: HTMLFormElement,
): Promise<void> {
  const data = new FormData(form);
  const name = String(data.get("name") ?? "").trim();
  let dataType = String(data.get("type") ?? "").trim();
  const nullable = data.get("nullable") === "on";
  const defaultValue = String(data.get("default") ?? "").trim() || null;
  const status = form.querySelector<HTMLDivElement>("#add-field-status")!;
  if (!name || !dataType) {
    status.className = "form-status error";
    status.textContent = "A field name and type are required.";
    return;
  }
  if (dataType === "enum") {
    const values = String(data.get("enumValues") ?? "").trim();
    if (!values.split(",").some((value) => value.trim())) {
      status.className = "form-status error";
      status.textContent = "Enter at least one enum value.";
      return;
    }
    dataType = mysqlEnumType(values);
  }

  const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  submit.disabled = true;
  status.className = "form-status info";
  status.innerHTML = spinner("Adding field…");
  try {
    await api.addColumn(tab.connectionId, tab.schema, tab.table, {
      name,
      dataType,
      nullable,
      primaryKey: false,
      defaultValue,
    });
    form.reset();
    status.className = "form-status success";
    status.textContent = `Field "${name}" added.`;
    toast(`Field "${name}" added`, "success");
    await refreshAfterStructureChange(tab);
  } catch (error) {
    submit.disabled = false;
    status.className = "form-status error";
    status.textContent = errorMessage(error);
  }
}

async function deleteField(
  tab: StructureTab,
  column: TableColumn,
): Promise<void> {
  const confirmed = await confirmDialog(
    "Delete field",
    `Delete field "${column.name}" from "${tab.table}"? This cannot be undone.`,
  );
  if (!confirmed) return;

  try {
    await api.dropColumn(tab.connectionId, tab.schema, tab.table, column.name);
    toast(`Field "${column.name}" deleted`, "success");
    await refreshAfterStructureChange(tab);
  } catch (error) {
    toast(errorMessage(error), "error");
  }
}

/* ------------------------------------------------------------ result view */

function resultPanelHtml(tab: QueryTab | TableTab): string {
  if (tab.type === "query" && tab.running) {
    return `<div class="panel-state">${spinner("Running query…")}</div>`;
  }
  if (tab.type === "table" && tab.loading) {
    return `<div class="panel-state">${spinner("Loading rows…")}</div>`;
  }
  if (tab.error) {
    return `
      <div class="panel-state error">
        <div class="error-title">Query failed</div>
        <pre>${esc(tab.error)}</pre>
      </div>
    `;
  }
  if (!tab.result) {
    return `<div class="panel-state muted">${tab.type === "query" ? "Run a query to see results here." : ""}</div>`;
  }
  if (tab.type === "table") {
    return gridHtml(
      tab.result,
      tab.selectedRow,
      (tab.page - 1) * tab.pageSize,
    );
  }
  return gridHtml(tab.result, null);
}

function gridHtml(
  result: QueryResult,
  selectedRow: number | null,
  rowOffset = 0,
): string {
  const affected = result.rowsAffected;
  const meta = `
    <div class="result-meta">
      ${
        affected === null
          ? `<span><strong>${result.rows.length}</strong> row${result.rows.length === 1 ? "" : "s"}</span>`
          : `<span><strong>${affected}</strong> row${affected === 1 ? "" : "s"} affected</span>`
      }
      <span class="dot">·</span>
      <span>${fmtMs(result.durationMs)}</span>
    </div>
  `;

  if (result.columns.length === 0) {
    return `${meta}<div class="panel-state muted">Statement executed. No result set.</div>`;
  }

  const head = result.columns
    .map(
      (column) =>
        `<th><span class="col-name">${esc(column.name)}</span><span class="col-type">${esc(column.typeName)}</span></th>`,
    )
    .join("");

  const body = result.rows
    .map(
      (row, index) => `
      <tr class="${selectedRow === index ? "selected" : ""}" data-row-index="${index}">
        <td class="rownum">${rowOffset + index + 1}</td>
        ${row.map((value, column) => cellHtml(value, column)).join("")}
      </tr>
    `,
    )
    .join("");

  return `
    ${meta}
    <div class="grid-scroll">
      <table class="grid">
        <thead><tr><th class="rownum">#</th>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function cellHtml(value: unknown, columnIndex: number): string {
  const attrs = `data-col-index="${columnIndex}"`;
  if (value === null || value === undefined) {
    return `<td class="cell null" ${attrs}>NULL</td>`;
  }
  if (typeof value === "number") {
    return `<td class="cell num" ${attrs}>${esc(value)}</td>`;
  }
  if (typeof value === "boolean") {
    return `<td class="cell bool" ${attrs}>${value ? "true" : "false"}</td>`;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === "") {
    return `<td class="cell empty" ${attrs}>empty</td>`;
  }
  return `<td class="cell" ${attrs} title="${esc(text.slice(0, 2000))}"><span class="cell-text">${esc(text)}</span></td>`;
}

function updateResultPanel(tab: ViewTab): void {
  if (tab.type === "structure" || tab.type === "create-table") return;
  if (activeTab() !== tab) return;
  const panel = byId<HTMLDivElement>("result-panel");
  if (panel) panel.innerHTML = resultPanelHtml(tab);
}

function setRunButton(running: boolean): void {
  const button = byId<HTMLButtonElement>("btn-run");
  if (!button) return;
  button.disabled = running;
  button.innerHTML = running ? spinner("Running…") : `${icons.play} Run`;
}

/* -------------------------------------------------------------- query flow */

async function runQuery(tab: QueryTab): Promise<void> {
  if (tab.running) return;

  const editor = byId<HTMLTextAreaElement>("sql-editor");
  let sql = tab.sql;
  if (editor) {
    const { selectionStart, selectionEnd } = editor;
    if (selectionStart !== selectionEnd) {
      sql = editor.value.slice(selectionStart, selectionEnd);
    } else {
      sql = editor.value;
    }
  }

  if (!sql.trim()) {
    toast("Nothing to run", "error");
    return;
  }

  const conn = [...conns.values()].find((c) => c.session.id === tab.connectionId);
  if (!conn) {
    tab.error = "This query tab is not connected to a database anymore.";
    updateResultPanel(tab);
    return;
  }

  tab.running = true;
  tab.error = undefined;
  setRunButton(true);
  updateResultPanel(tab);

  try {
    const result = await api.runQuery(tab.connectionId, sql);
    tab.result = result;
    pushHistory({
      at: Date.now(),
      connection: conn.profile.name,
      sql,
      durationMs: result.durationMs,
      ok: true,
    });
    if (conn.profile.kind === "postgres") void refreshEnumTypes(conn.profile.id);
  } catch (error) {
    tab.error = errorMessage(error);
    pushHistory({
      at: Date.now(),
      connection: conn.profile.name,
      sql,
      durationMs: 0,
      ok: false,
    });
  } finally {
    tab.running = false;
    setRunButton(false);
    updateResultPanel(tab);
  }
}

async function loadPreview(tab: TableTab): Promise<void> {
  if (tab.loading) return;
  const conn = [...conns.values()].find((c) => c.session.id === tab.connectionId);
  if (!conn) {
    tab.error = "This connection is closed.";
    updateResultPanel(tab);
    return;
  }

  tab.loading = true;
  tab.error = undefined;
  tab.selectedRow = null;
  updateResultPanel(tab);
  updateTableToolbar(tab);

  try {
    tab.result = await api.tablePage(
      tab.connectionId,
      tab.schema,
      tab.table,
      tab.page,
      tab.pageSize,
    );
    const totalPages = pageCount(tab);
    if (tab.page > totalPages) {
      tab.page = totalPages;
      tab.result = await api.tablePage(
        tab.connectionId,
        tab.schema,
        tab.table,
        tab.page,
        tab.pageSize,
      );
    }
  } catch (error) {
    tab.error = errorMessage(error);
  } finally {
    tab.loading = false;
    updateResultPanel(tab);
    updateTableToolbar(tab);
  }
}

/* --------------------------------------------------------------- row CRUD */

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function cellToInput(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return cellToText(value);
}

function isLongTextField(typeName: string): boolean {
  const type = typeName.toLowerCase();
  return type === "json" || type === "jsonb" || type.includes("text");
}

function selectedRow(tab: TableTab): unknown[] | null {
  if (tab.selectedRow === null) return null;
  return tab.result?.rows[tab.selectedRow] ?? null;
}

function rowByColumn(
  tab: TableTab,
  row: unknown[],
): Map<string, unknown> {
  const values = new Map<string, unknown>();
  tab.result?.columns.forEach((column, index) => {
    values.set(column.name, row[index]);
  });
  return values;
}

function openRowEditor(tab: TableTab, mode: "insert" | "edit"): void {
  if (tab.isView) {
    toast("Views are read-only", "error");
    return;
  }

  const original = mode === "edit" ? selectedRow(tab) : null;
  if (mode === "edit" && !original) {
    toast("Select a row first", "error");
    return;
  }

  const current = rowByColumn(tab, original ?? []);

  void (async () => {
    let columns: TableColumn[];
    try {
      columns = await api.describeTable(
        tab.connectionId,
        tab.schema,
        tab.table,
      );
    } catch (error) {
      toast(errorMessage(error), "error");
      return;
    }

    if (mode === "edit" && !columns.some((column) => column.primaryKey)) {
      toast("This table has no primary key, so rows cannot be edited safely", "error");
      return;
    }

    const fields = columns
      .map((column, index) => {
        const isAuto = mode === "insert" && column.autoIncrement;
        const isKey = mode === "edit" && column.primaryKey;
        const locked = isAuto || isKey;
        const value = current.get(column.name);
        const isNull =
          mode === "edit" && (value === null || value === undefined);
        const placeholder = isAuto
          ? "auto-generated"
          : column.defaultValue
            ? `default: ${column.defaultValue}`
            : column.nullable
              ? "NULL"
              : column.typeName;
        const longText = isLongTextField(column.typeName);
        const fieldValue = isAuto ? "" : cellToText(value);
        return `
          <label class="row-field ${locked ? "locked" : ""} ${longText ? "long" : ""}">
            <span class="row-field-head">
              <span class="row-field-name">${esc(column.name)}</span>
              <span class="row-field-type">${esc(column.typeName)}</span>
              ${column.primaryKey ? '<span class="tag pk">PK</span>' : ""}
              ${column.autoIncrement ? '<span class="tag">auto</span>' : ""}
            </span>
            <span class="row-field-control">
              ${
                longText
                  ? `<textarea
                data-row-field="${index}"
                placeholder="${esc(placeholder)}"
                spellcheck="false"
                ${locked ? "disabled" : ""}
              >${esc(fieldValue)}</textarea>`
                  : `<input
                data-row-field="${index}"
                value="${esc(fieldValue)}"
                placeholder="${esc(placeholder)}"
                autocomplete="off"
                spellcheck="false"
                ${locked ? "disabled" : ""}
              />`
              }
              ${
                column.nullable && !locked
                  ? `<label class="null-check"><input type="checkbox" data-null-field="${index}" ${isNull ? "checked" : ""} /> NULL</label>`
                  : ""
              }
            </span>
            ${
              column.defaultValue
                ? `<small class="row-field-default">default: ${esc(column.defaultValue)}</small>`
                : ""
            }
          </label>
        `;
      })
      .join("");

    const backdrop = openModal(`
      <form class="modal row-modal" id="row-form" novalidate>
        <div class="modal-head">
          <div>
            <h2>${mode === "insert" ? "Add row" : "Edit row"}</h2>
            <small class="modal-subtitle"><span class="crumb">${esc(tab.schema)}</span>.${esc(tab.table)}</small>
          </div>
          <button type="button" class="icon-btn" data-close="true" aria-label="Close">${icons.x}</button>
        </div>
        <div class="modal-body">
          <p class="row-hint">
            ${
              mode === "insert"
                ? "Blank fields with a default use that default. Other blank text inserts an empty string; check NULL for a SQL NULL value."
                : "Primary key columns are used to identify the row and cannot be changed. Blank text updates the column to an empty string."
            }
          </p>
          <div class="row-editor">${fields}</div>
          <div class="form-status" id="row-status"></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn ghost" data-close="true">Cancel</button>
          <span class="spacer"></span>
          <button type="submit" class="btn primary">
            ${mode === "insert" ? `${icons.plus} Add row` : `${icons.edit} Save changes`}
          </button>
        </div>
      </form>
    `);

    const form = backdrop.querySelector<HTMLFormElement>("#row-form")!;
    const status = backdrop.querySelector<HTMLDivElement>("#row-status")!;

    backdrop
      .querySelectorAll<HTMLInputElement>("[data-null-field]")
      .forEach((box) => {
        const index = Number(box.dataset.nullField);
        const input = form.querySelector<
          HTMLInputElement | HTMLTextAreaElement
        >(`[data-row-field="${index}"]`);
        if (!input) return;
        const sync = () => {
          input.disabled = box.checked;
          if (box.checked) input.value = "";
        };
        box.addEventListener("change", sync);
        sync();
      });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;

      const cells: CellInput[] = [];
      for (let index = 0; index < columns.length; index++) {
        const column = columns[index];
        if (mode === "insert" && column.autoIncrement) continue;
        if (mode === "edit" && column.primaryKey) continue;

        const input = form.querySelector<
          HTMLInputElement | HTMLTextAreaElement
        >(`[data-row-field="${index}"]`);
        if (!input) continue;

        const nullBox = form.querySelector<HTMLInputElement>(
          `[data-null-field="${index}"]`,
        );
        const value = nullBox?.checked ? null : input.value;

        if (
          mode === "insert" &&
          value === "" &&
          column.defaultValue !== null &&
          column.defaultValue !== undefined
        ) {
          continue;
        }

        if (mode === "edit") {
          const oldValue = current.get(column.name);
          const oldText =
            oldValue === null || oldValue === undefined
              ? null
              : cellToText(oldValue);
          if (value === oldText) continue;
        }
        cells.push({ column: column.name, value });
      }

      if (mode === "edit" && cells.length === 0) {
        status.className = "form-status info";
        status.textContent = "No changes to save.";
        return;
      }

      const keys: CellInput[] = columns
        .filter((column) => column.primaryKey)
        .map((column) => ({
          column: column.name,
          value:
            mode === "edit"
              ? cellToInput(current.get(column.name))
              : null,
        }));

      if (
        mode === "edit" &&
        keys.some((key) => key.value === null)
      ) {
        status.className = "form-status error";
        status.textContent =
          "This row has a NULL primary key value and cannot be changed safely.";
        return;
      }

      submit.disabled = true;
      status.className = "form-status info";
      status.innerHTML = spinner(mode === "insert" ? "Adding row…" : "Saving…");

      try {
        const result =
          mode === "insert"
            ? await api.insertRow(
                tab.connectionId,
                tab.schema,
                tab.table,
                cells,
              )
            : await api.updateRow(
                tab.connectionId,
                tab.schema,
                tab.table,
                cells,
                keys,
              );

        const count = result.rowsAffected ?? 1;
        closeModal();
        if (count === 0) {
          toast("No rows were changed. The row may have been modified or deleted.", "error");
        } else {
          toast(
            `${count} row${count === 1 ? "" : "s"} ${mode === "insert" ? "added" : "updated"}`,
            "success",
          );
        }
        tab.selectedRow = null;
        await loadPreview(tab);
      } catch (error) {
        submit.disabled = false;
        status.className = "form-status error";
        status.textContent = errorMessage(error);
      }
    });
  })();
}

async function tableColumns(tab: TableTab): Promise<TableColumn[]> {
  if (tab.columns) return tab.columns;
  tab.columns = await api.describeTable(
    tab.connectionId,
    tab.schema,
    tab.table,
  );
  return tab.columns;
}

async function beginInlineEdit(
  tab: TableTab,
  cell: HTMLTableCellElement,
  rowIndex: number,
  columnIndex: number,
): Promise<void> {
  if (tab.isView) {
    toast("Views are read-only", "error");
    return;
  }
  if (cell.classList.contains("editing")) return;

  const row = tab.result?.rows[rowIndex];
  const resultColumn = tab.result?.columns[columnIndex];
  if (!row || !resultColumn) return;

  let columns: TableColumn[];
  try {
    columns = await tableColumns(tab);
  } catch (error) {
    toast(errorMessage(error), "error");
    return;
  }
  if (!cell.isConnected) return;

  const column = columns.find((item) => item.name === resultColumn.name);
  if (!column) return;
  if (column.primaryKey) {
    toast("Primary key columns cannot be edited inline", "error");
    return;
  }
  if (!columns.some((item) => item.primaryKey)) {
    toast(
      "This table has no primary key, so rows cannot be edited safely",
      "error",
    );
    return;
  }

  const values = rowByColumn(tab, row);
  const keys: CellInput[] = columns
    .filter((item) => item.primaryKey)
    .map((item) => ({
      column: item.name,
      value: cellToInput(values.get(item.name)),
    }));
  if (keys.some((key) => key.value === null)) {
    toast(
      "This row has a NULL primary key value and cannot be changed safely",
      "error",
    );
    return;
  }

  const originalValue = row[columnIndex];
  const originalText = cellToText(originalValue);
  const originalHtml = cell.innerHTML;
  const originalClass = cell.className;
  const input = document.createElement("input");
  let done = false;

  const restore = () => {
    if (!cell.isConnected) return;
    cell.className = originalClass;
    cell.innerHTML = originalHtml;
  };

  const cancel = () => {
    if (done) return;
    done = true;
    restore();
  };

  const commit = async () => {
    if (done) return;
    const value = input.value;
    if (value === originalText) {
      cancel();
      return;
    }
    if (
      (originalValue === null || originalValue === undefined) &&
      value === ""
    ) {
      cancel();
      return;
    }
    done = true;
    input.disabled = true;
    cell.classList.add("saving");

    try {
      const result = await api.updateRow(
        tab.connectionId,
        tab.schema,
        tab.table,
        [{ column: column.name, value }],
        keys,
      );
      const count = result.rowsAffected ?? 1;
      if (count === 0) {
        toast(
          "No rows were changed. The row may have been modified or deleted.",
          "error",
        );
        restore();
        return;
      }
      toast("Row updated", "success");
      await loadPreview(tab);
    } catch (error) {
      toast(errorMessage(error), "error");
      restore();
    }
  };

  input.className = "cell-input";
  input.value = originalText;
  input.autocomplete = "off";
  input.spellcheck = false;
  cell.classList.add("editing");
  cell.textContent = "";
  cell.appendChild(input);
  input.focus();
  input.select();

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  });
  input.addEventListener("blur", () => {
    if (!done) void commit();
  });
}

async function deleteSelectedRow(tab: TableTab): Promise<void> {
  if (tab.isView) {
    toast("Views are read-only", "error");
    return;
  }
  const row = selectedRow(tab);
  if (!row) {
    toast("Select a row first", "error");
    return;
  }

  try {
    const columns = await api.describeTable(
      tab.connectionId,
      tab.schema,
      tab.table,
    );
    const keys = columns.filter((column) => column.primaryKey);
    if (keys.length === 0) {
      toast("This table has no primary key, so rows cannot be deleted safely", "error");
      return;
    }

    const current = rowByColumn(tab, row);
    const keyCells: CellInput[] = keys.map((column) => ({
      column: column.name,
      value: cellToInput(current.get(column.name)),
    }));
    if (keyCells.some((key) => key.value === null)) {
      toast("This row has a NULL primary key value and cannot be deleted safely", "error");
      return;
    }

    const where = keys
      .map((column) => {
        const text = cellToInput(current.get(column.name)) ?? "NULL";
        const short = text.length > 60 ? `${text.slice(0, 60)}…` : text;
        return `${column.name} = ${short}`;
      })
      .join(", ");

    const confirmed = await confirmDialog(
      "Delete row",
      `Delete the row where ${where}? This cannot be undone.`,
      "Delete row",
    );
    if (!confirmed) return;

    const result = await api.deleteRow(
      tab.connectionId,
      tab.schema,
      tab.table,
      keyCells,
    );
    const count = result.rowsAffected ?? 1;
    if (count === 0) {
      toast("No rows were deleted. The row may already be gone.", "error");
    } else {
      toast(`${count} row${count === 1 ? "" : "s"} deleted`, "success");
    }
    tab.selectedRow = null;
    await loadPreview(tab);
  } catch (error) {
    toast(errorMessage(error), "error");
  }
}

/* ------------------------------------------------------------- tab actions */

function newQueryTab(sql = ""): void {
  const preferred =
    (activeTab() && conns.get(activeTab()!.profileId)) ||
    (lastProfileId ? conns.get(lastProfileId) : undefined) ||
    [...conns.values()][0];

  if (!preferred) {
    toast("Connect to a database first", "error");
    return;
  }

  const tab: QueryTab = {
    id: crypto.randomUUID(),
    type: "query",
    title: `Query ${querySeq++}`,
    profileId: preferred.profile.id,
    connectionId: preferred.session.id,
    sql,
    running: false,
  };
  tabs.push(tab);
  activeTabId = tab.id;
  renderTabbar();
  renderWorkspace();
}

function openTableTab(
  profileId: string,
  schema: string,
  table: string,
  tableKind: string,
): void {
  const conn = conns.get(profileId);
  if (!conn) return;

  const existing = tabs.find(
    (tab): tab is TableTab =>
      tab.type === "table" &&
      tab.profileId === profileId &&
      tab.schema === schema &&
      tab.table === table,
  );

  if (existing) {
    activeTabId = existing.id;
    renderTabbar();
    renderWorkspace();
    if (!existing.result && !existing.loading) void loadPreview(existing);
    return;
  }

  const tab: TableTab = {
    id: crypto.randomUUID(),
    type: "table",
    title: `${schema}.${table}`,
    profileId,
    connectionId: conn.session.id,
    schema,
    table,
    isView: isViewKind(tableKind),
    page: 1,
    pageSize: 200,
    selectedRow: null,
    loading: false,
  };
  tabs.push(tab);
  activeTabId = tab.id;
  lastProfileId = profileId;
  renderTabbar();
  renderWorkspace();
  void loadPreview(tab);
}

function openStructureTab(
  profileId: string,
  schema: string,
  table: string,
): void {
  const conn = conns.get(profileId);
  if (!conn) return;

  const existing = tabs.find(
    (tab): tab is StructureTab =>
      tab.type === "structure" &&
      tab.profileId === profileId &&
      tab.schema === schema &&
      tab.table === table,
  );
  if (existing) {
    activeTabId = existing.id;
    renderTabbar();
    renderWorkspace();
    if (!existing.columns && !existing.loading) void loadStructure(existing);
    return;
  }

  const tab: StructureTab = {
    id: crypto.randomUUID(),
    type: "structure",
    title: `${schema}.${table}`,
    profileId,
    connectionId: conn.session.id,
    schema,
    table,
    loading: false,
  };
  tabs.push(tab);
  activeTabId = tab.id;
  lastProfileId = profileId;
  renderTabbar();
  renderWorkspace();
  void loadStructure(tab);
}

function closeTabsForTable(
  profileId: string,
  schema: string,
  table: string,
): void {
  const closing = tabs.filter(
    (tab) =>
      (tab.type === "table" || tab.type === "structure") &&
      tab.profileId === profileId &&
      tab.schema === schema &&
      tab.table === table,
  );
  if (closing.length === 0) return;

  const activeClosed = closing.some((tab) => tab.id === activeTabId);
  for (let index = tabs.length - 1; index >= 0; index--) {
    const tab = tabs[index];
    if (
      (tab.type === "table" || tab.type === "structure") &&
      tab.profileId === profileId &&
      tab.schema === schema &&
      tab.table === table
    ) {
      tabs.splice(index, 1);
    }
  }
  if (activeClosed) {
    const next = tabs[tabs.length - 1];
    activeTabId = next ? next.id : null;
  }
  renderTabbar();
  renderWorkspace();
}

function closeTabsForSchema(profileId: string, schema: string): void {
  const matches = (tab: ViewTab) =>
    (tab.type === "table" ||
      tab.type === "structure" ||
      tab.type === "create-table") &&
    tab.profileId === profileId &&
    tab.schema === schema;
  const closing = tabs.filter(matches);
  if (closing.length === 0) return;

  const activeClosed = closing.some((tab) => tab.id === activeTabId);
  for (let index = tabs.length - 1; index >= 0; index--) {
    if (matches(tabs[index])) tabs.splice(index, 1);
  }
  if (activeClosed) {
    activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
  }
}

function activateTab(id: string): void {
  if (activeTabId === id) return;
  activeTabId = id;
  renderTabbar();
  renderWorkspace();
}

function closeTab(id: string): void {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  tabs.splice(index, 1);
  if (activeTabId === id) {
    const next = tabs[Math.min(index, tabs.length - 1)];
    activeTabId = next ? next.id : null;
  }
  renderTabbar();
  renderWorkspace();
}

function closeTabsForProfile(profileId: string): void {
  for (let i = tabs.length - 1; i >= 0; i--) {
    if (tabs[i].profileId === profileId) tabs.splice(i, 1);
  }
  if (!tabs.some((tab) => tab.id === activeTabId)) {
    activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
  }
}

function closeDataTabsForProfile(profileId: string): void {
  for (let i = tabs.length - 1; i >= 0; i--) {
    if (tabs[i].profileId === profileId && tabs[i].type !== "query") {
      tabs.splice(i, 1);
    }
  }
  if (!tabs.some((tab) => tab.id === activeTabId)) {
    activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
  }
}

/* --------------------------------------------------------- connection flow */

async function connectProfile(profile: Profile, secrets: Secrets): Promise<void> {
  const existing = conns.get(profile.id);
  if (existing) {
    await api.disconnect(existing.session.id).catch(() => undefined);
    conns.delete(profile.id);
    closeTabsForProfile(profile.id);
  }

  const session = await api.connect(profile, secrets.password, secrets.sshSecret);
  conns.set(profile.id, {
    profile,
    session,
    schemas: null,
    databases: null,
    tables: {},
    expanded: true,
    expandedSchemas: new Set(),
    loadingSchemas: false,
    loadingDatabases: false,
    loadingTables: new Set(),
    enumTypes: [],
  });
  if (profile.kind === "postgres") await refreshEnumTypes(profile.id);
  lastProfileId = profile.id;
  renderSidebar();
  renderTabbar();
  renderWorkspace();
  void loadSchemas(profile.id);
  if (profile.kind === "postgres") void loadDatabases(profile.id);
}

async function refreshEnumTypes(profileId: string): Promise<void> {
  const conn = conns.get(profileId);
  if (!conn || conn.profile.kind !== "postgres") return;
  try {
    conn.enumTypes = await api.listEnumTypes(conn.session.id);
  } catch {
    conn.enumTypes = [];
  }
}

async function switchDatabase(
  profileId: string,
  database: string,
): Promise<void> {
  const conn = conns.get(profileId);
  if (!conn || database === conn.session.database) return;

  try {
    const session = await api.switchDatabase(conn.session.id, database);
    conn.session = session;
    conn.profile = { ...conn.profile, database: session.database };
    conn.schemas = null;
    conn.databases = null;
    conn.tables = {};
    conn.expandedSchemas.clear();
    conn.error = undefined;
    closeDataTabsForProfile(profileId);
    lastProfileId = profileId;
    renderSidebar();
    renderTabbar();
    renderWorkspace();
    await refreshEnumTypes(profileId);
    void loadSchemas(profileId);
    void loadDatabases(profileId);
    toast(`Opened database "${session.database}"`, "success");
  } catch (error) {
    toast(errorMessage(error), "error");
  }
}

async function disconnectProfile(profileId: string): Promise<void> {
  const conn = conns.get(profileId);
  if (!conn) return;
  try {
    await api.disconnect(conn.session.id);
  } catch {
    /* ignore */
  }
  conns.delete(profileId);
  closeTabsForProfile(profileId);
  if (lastProfileId === profileId) {
    lastProfileId = conns.size > 0 ? [...conns.keys()][0] : null;
  }
  renderSidebar();
  renderTabbar();
  renderWorkspace();
}

async function loadSchemas(profileId: string): Promise<void> {
  const conn = conns.get(profileId);
  if (!conn || conn.loadingSchemas) return;
  conn.loadingSchemas = true;
  conn.error = undefined;
  renderSidebar();
  try {
    conn.schemas = await api.listSchemas(conn.session.id);
    if (conn.schemas.length > 0) {
      conn.expandedSchemas.add(conn.schemas[0]);
    }
  } catch (error) {
    conn.error = errorMessage(error);
  } finally {
    conn.loadingSchemas = false;
    renderSidebar();
    const first = conn.schemas?.[0];
    if (first) void loadTables(profileId, first);
  }
}

async function loadDatabases(profileId: string): Promise<void> {
  const conn = conns.get(profileId);
  if (!conn || conn.loadingDatabases) return;
  conn.loadingDatabases = true;
  renderSidebar();
  try {
    conn.databases = await api.listDatabases(conn.session.id);
  } catch (error) {
    conn.error = errorMessage(error);
  } finally {
    conn.loadingDatabases = false;
    renderSidebar();
  }
}

async function loadTables(profileId: string, schema: string): Promise<void> {
  const conn = conns.get(profileId);
  if (!conn || conn.loadingTables.has(schema)) return;
  if (conn.tables[schema]) return;
  conn.loadingTables.add(schema);
  renderSidebar();
  try {
    conn.tables[schema] = await api.listTables(conn.session.id, schema);
  } catch (error) {
    conn.error = errorMessage(error);
  } finally {
    conn.loadingTables.delete(schema);
    renderSidebar();
  }
}

/* ---------------------------------------------------------- saved secrets */

async function storeCredentials(
  profile: Profile,
  secrets: Secrets,
  wasSaved: boolean,
): Promise<void> {
  let merged = { ...secrets };
  if (wasSaved) {
    const previous = await api.loadCredentials(profile.id).catch(() => null);
    if (previous) {
      if (!merged.password) merged.password = previous.password;
      if (!merged.sshSecret) merged.sshSecret = previous.sshSecret;
    }
  }
  await api.saveCredentials(profile.id, merged.password, merged.sshSecret);
}

async function resolveSavedSecrets(
  profile: Profile,
  secrets: Secrets,
  wasSaved: boolean,
): Promise<Secrets> {
  if (!profile.savePassword || !wasSaved) return secrets;
  if (secrets.password && secrets.sshSecret) return secrets;
  const previous = await api.loadCredentials(profile.id).catch(() => null);
  if (!previous) return secrets;
  return {
    password: secrets.password || previous.password,
    sshSecret: secrets.sshSecret || previous.sshSecret,
  };
}

async function connectSavedOrPrompt(profile: Profile): Promise<void> {
  if (profile.savePassword) {
    try {
      const saved = await api.loadCredentials(profile.id);
      if (saved) {
        try {
          await connectProfile(profile, saved);
          toast(`Connected to ${profile.name}`, "success");
          return;
        } catch (error) {
          toast(`Saved password failed: ${errorMessage(error)}`, "error");
        }
      }
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }
  openConnectModal(profile);
}

/* ----------------------------------------------------------------- modals */

function readConnectionForm(form: HTMLFormElement): {
  profile: Profile;
  secrets: Secrets;
} {
  const data = new FormData(form);
  const kind = String(data.get("kind") ?? "postgres") as DbKind;
  return {
    profile: {
      id: String(data.get("id") ?? ""),
      name: String(data.get("name") ?? ""),
      kind,
      host: String(data.get("host") ?? ""),
      port: Number(data.get("port") ?? defaultPort(kind)),
      username: String(data.get("username") ?? ""),
      database: String(data.get("database") ?? ""),
      ssl: data.get("ssl") === "on",
      savePassword: data.get("savePassword") === "on",
      sshEnabled: data.get("sshEnabled") === "on",
      sshHost: String(data.get("sshHost") ?? ""),
      sshPort: Number(data.get("sshPort") ?? 22),
      sshUsername: String(data.get("sshUsername") ?? ""),
      sshAuth:
        data.get("sshAuth") === "key"
          ? "key"
          : ("password" as const),
      sshKeyPath: String(data.get("sshKeyPath") ?? ""),
      sshVerifyHost: data.get("sshVerifyHost") === "on",
    },
    secrets: {
      password: String(data.get("password") ?? ""),
      sshSecret: String(data.get("sshSecret") ?? ""),
    },
  };
}

function openConnectionModal(existing?: Profile): void {
  const profile: Profile =
    existing ?? {
      id: "",
      name: "",
      kind: "postgres",
      host: "localhost",
      port: 5432,
      username: "",
      database: "",
      ssl: false,
      savePassword: false,
      sshEnabled: false,
      sshHost: "",
      sshPort: 22,
      sshUsername: "",
      sshAuth: "password",
      sshKeyPath: "",
      sshVerifyHost: true,
    };

  const backdrop = openModal(`
    <form class="modal conn-modal" id="conn-form" novalidate>
      <div class="modal-head">
        <h2>${existing ? "Edit connection" : "New connection"}</h2>
        <button type="button" class="icon-btn" data-close="true" aria-label="Close">${icons.x}</button>
      </div>
      <div class="modal-body form-grid">
        <input type="hidden" name="id" value="${esc(profile.id)}" />
        <label class="field wide">
          <span>Name</span>
          <input name="name" required value="${esc(profile.name)}" placeholder="My database" />
        </label>
        <label class="field">
          <span>Engine</span>
          <select name="kind">
            <option value="postgres" ${profile.kind === "postgres" ? "selected" : ""}>PostgreSQL</option>
            <option value="mysql" ${profile.kind === "mysql" ? "selected" : ""}>MySQL / MariaDB</option>
          </select>
        </label>
        <label class="field">
          <span>Host</span>
          <input name="host" required value="${esc(profile.host)}" placeholder="localhost" />
        </label>
        <label class="field">
          <span>Port</span>
          <input name="port" type="number" min="1" max="65535" value="${profile.port}" />
        </label>
        <label class="field">
          <span>Database</span>
          <input name="database" value="${esc(profile.database)}" placeholder="${profile.kind === "postgres" ? "postgres (optional)" : "optional"}" />
        </label>
        <label class="field">
          <span>Username</span>
          <input name="username" value="${esc(profile.username)}" placeholder="postgres" />
        </label>
        <label class="field wide">
          <span>Password</span>
          <input name="password" type="password" autocomplete="off" placeholder="${existing?.savePassword ? "Saved in the OS keychain — leave blank to keep it" : "••••••••"}" />
          <small>Used for this session only unless you save it in the OS keychain.</small>
        </label>
        <label class="check wide">
          <input type="checkbox" name="savePassword" ${profile.savePassword ? "checked" : ""} />
          <span>Save password in the OS keychain (GNOME Keyring, KWallet, or Windows Credential Manager)</span>
        </label>
        <label class="check wide">
          <input type="checkbox" name="ssl" ${profile.ssl ? "checked" : ""} />
          <span>Require SSL/TLS</span>
        </label>
        <label class="check wide">
          <input type="checkbox" name="sshEnabled" id="ssh-enabled" ${profile.sshEnabled ? "checked" : ""} />
          <span>Connect through an SSH tunnel</span>
        </label>
        <div class="wide ssh-fields" id="ssh-fields" ${profile.sshEnabled ? "" : "hidden"}>
          <div class="ssh-grid">
            <label class="field">
              <span>SSH host</span>
              <input name="sshHost" value="${esc(profile.sshHost)}" placeholder="bastion.example.com" />
            </label>
            <label class="field">
              <span>SSH port</span>
              <input name="sshPort" type="number" min="1" max="65535" value="${profile.sshPort || 22}" />
            </label>
            <label class="field">
              <span>SSH username</span>
              <input name="sshUsername" value="${esc(profile.sshUsername)}" placeholder="deploy" />
            </label>
            <label class="field">
              <span>SSH authentication</span>
              <select name="sshAuth">
                <option value="password" ${profile.sshAuth === "password" ? "selected" : ""}>Password</option>
                <option value="key" ${profile.sshAuth === "key" ? "selected" : ""}>Private key</option>
              </select>
            </label>
            <label class="field wide" id="ssh-key-field" ${profile.sshAuth === "key" ? "" : "hidden"}>
              <span>Private key file</span>
              <input name="sshKeyPath" value="${esc(profile.sshKeyPath)}" placeholder="~/.ssh/id_ed25519" />
              <small>Leave blank to use the first default key in ~/.ssh.</small>
            </label>
            <label class="field wide">
              <span id="ssh-secret-label">${profile.sshAuth === "key" ? "Key passphrase" : "SSH password"}</span>
              <input name="sshSecret" type="password" autocomplete="off" placeholder="••••••••" />
              <small>Used for this session only, never written to disk.</small>
            </label>
            <label class="check wide">
              <input type="checkbox" name="sshVerifyHost" ${profile.sshVerifyHost ? "checked" : ""} />
              <span>Verify the SSH host key against ~/.ssh/known_hosts</span>
            </label>
          </div>
        </div>
        <div class="form-status wide" id="form-status"></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-close="true">Cancel</button>
        <span class="spacer"></span>
        <button type="button" class="btn" id="btn-test">Test connection</button>
        <button type="submit" class="btn primary">${existing ? "Save & reconnect" : "Save & connect"}</button>
      </div>
    </form>
  `);

  const form = backdrop.querySelector<HTMLFormElement>("#conn-form")!;
  const status = backdrop.querySelector<HTMLDivElement>("#form-status")!;
  const kindSelect = form.querySelector<HTMLSelectElement>("[name=kind]")!;
  const portInput = form.querySelector<HTMLInputElement>("[name=port]")!;
  const databaseInput = form.querySelector<HTMLInputElement>("[name=database]")!;
  const sshEnabled = form.querySelector<HTMLInputElement>("[name=sshEnabled]")!;
  const sshFields = form.querySelector<HTMLDivElement>("#ssh-fields")!;
  const sshAuth = form.querySelector<HTMLSelectElement>("[name=sshAuth]")!;
  const sshKeyField = form.querySelector<HTMLElement>("#ssh-key-field")!;
  const sshSecretLabel = form.querySelector<HTMLElement>("#ssh-secret-label")!;

  const syncSsh = () => {
    sshFields.hidden = !sshEnabled.checked;
    sshKeyField.hidden = sshAuth.value !== "key";
    sshSecretLabel.textContent =
      sshAuth.value === "key" ? "Key passphrase" : "SSH password";
  };
  sshEnabled.addEventListener("change", syncSsh);
  sshAuth.addEventListener("change", syncSsh);
  syncSsh();

  kindSelect.addEventListener("change", () => {
    const kind = kindSelect.value as DbKind;
    const previousDefault = defaultPort(profile.kind);
    if (portInput.value === String(previousDefault) || !portInput.value) {
      portInput.value = String(defaultPort(kind));
    }
    databaseInput.placeholder = kind === "postgres" ? "postgres (optional)" : "optional";
    profile.kind = kind;
  });

  const setStatus = (html: string, kind: "info" | "success" | "error") => {
    status.className = `form-status wide ${kind}`;
    status.innerHTML = html;
  };

  backdrop
    .querySelector<HTMLButtonElement>("#btn-test")
    ?.addEventListener("click", async () => {
      const button = backdrop.querySelector<HTMLButtonElement>("#btn-test")!;
      const { profile: candidate, secrets } = readConnectionForm(form);
      if (!candidate.host) {
        setStatus("Host is required", "error");
        return;
      }
      button.disabled = true;
      setStatus(spinner("Connecting…"), "info");
      try {
        const testSecrets = await resolveSavedSecrets(
          candidate,
          secrets,
          Boolean(existing?.savePassword),
        );
        const version = await api.testConnection(
          candidate,
          testSecrets.password,
          testSecrets.sshSecret,
        );
        setStatus(`Connected · ${esc(version)}`, "success");
      } catch (error) {
        setStatus(esc(errorMessage(error)), "error");
      } finally {
        button.disabled = false;
      }
    });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const { profile: candidate, secrets } = readConnectionForm(form);
    if (!candidate.name.trim()) {
      setStatus("Name is required", "error");
      return;
    }
    if (!candidate.host.trim()) {
      setStatus("Host is required", "error");
      return;
    }

    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    submit.disabled = true;
    setStatus(spinner("Saving…"), "info");

    const wasSaved = Boolean(existing?.savePassword);
    try {
      const saved = await api.saveProfile(candidate);
      try {
        if (saved.savePassword) {
          await storeCredentials(saved, secrets, wasSaved);
        } else if (wasSaved) {
          await api.deleteCredentials(saved.id);
        }
      } catch (error) {
        toast(`Password not saved: ${errorMessage(error)}`, "error");
      }

      profiles = await api.listProfiles();
      closeModal();
      renderSidebar();

      const connectSecrets = await resolveSavedSecrets(
        saved,
        secrets,
        wasSaved,
      ).catch(() => secrets);

      try {
        await connectProfile(saved, connectSecrets);
        toast(`Connected to ${saved.name}`, "success");
      } catch (error) {
        toast(errorMessage(error), "error");
      }
    } catch (error) {
      submit.disabled = false;
      setStatus(esc(errorMessage(error)), "error");
    }
  });
}

function openConnectModal(profile: Profile): void {
  const backdrop = openModal(`
    <form class="modal small" id="connect-form">
      <div class="modal-head">
        <h2>Connect</h2>
        <button type="button" class="icon-btn" data-close="true" aria-label="Close">${icons.x}</button>
      </div>
      <div class="modal-body">
        <div class="connect-summary">
          <span class="db-badge ${profile.kind}">${profile.kind === "postgres" ? "PG" : "MY"}</span>
          <div>
            <strong>${esc(profile.name)}</strong>
            <small>${esc(profile.username || "user")}@${esc(profile.host)}:${profile.port}${profile.database ? ` / ${esc(profile.database)}` : ""}</small>
          </div>
        </div>
        <label class="field wide">
          <span>Database password</span>
          <input name="password" type="password" autocomplete="off" placeholder="••••••••" />
        </label>
        ${
          profile.sshEnabled
            ? `<label class="field wide">
                 <span>${profile.sshAuth === "key" ? "SSH key passphrase (optional)" : "SSH password"}</span>
                 <input name="sshSecret" type="password" autocomplete="off" placeholder="••••••••" />
               </label>`
            : ""
        }
        <label class="check wide">
          <input type="checkbox" name="savePassword" ${profile.savePassword ? "checked" : ""} />
          <span>Save ${profile.sshEnabled ? "database and SSH passwords" : "password"} in the OS keychain</span>
        </label>
        <div class="form-status wide" id="form-status"></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-close="true">Cancel</button>
        <span class="spacer"></span>
        <button type="submit" class="btn primary">${icons.plug} Connect</button>
      </div>
    </form>
  `);

  const form = backdrop.querySelector<HTMLFormElement>("#connect-form")!;
  const status = backdrop.querySelector<HTMLDivElement>("#form-status")!;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const secrets: Secrets = {
      password: String(data.get("password") ?? ""),
      sshSecret: String(data.get("sshSecret") ?? ""),
    };
    const save = data.get("savePassword") === "on";
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    submit.disabled = true;
    status.className = "form-status wide info";
    status.innerHTML = spinner(save ? "Saving password and connecting…" : "Connecting…");

    let updated = profile;
    let connectSecrets = secrets;
    try {
      connectSecrets = await resolveSavedSecrets(
        profile,
        secrets,
        profile.savePassword,
      );

      if (save !== profile.savePassword) {
        updated = await api.saveProfile({ ...profile, savePassword: save });
        profiles = await api.listProfiles();
      }

      if (save) {
        await storeCredentials(updated, connectSecrets, profile.savePassword);
      } else if (profile.savePassword) {
        await api.deleteCredentials(updated.id);
      }
    } catch (error) {
      toast(`Password not saved: ${errorMessage(error)}`, "error");
    }

    try {
      await connectProfile(updated, connectSecrets);
      closeModal();
      toast(`Connected to ${updated.name}`, "success");
    } catch (error) {
      submit.disabled = false;
      status.className = "form-status wide error";
      status.textContent = errorMessage(error);
    }
  });
}

function openHistoryModal(): void {
  const entries = loadHistory();
  const body =
    entries.length === 0
      ? `<div class="panel-state muted">No queries yet.</div>`
      : `<div class="history-list">${entries
          .map(
            (entry, index) => `
          <button class="history-item ${entry.ok ? "" : "failed"}" data-history-index="${index}">
            <span class="history-sql">${esc(entry.sql.replace(/\s+/g, " ").slice(0, 160))}</span>
            <span class="history-meta">
              <span>${esc(entry.connection)}</span>
              <span class="dot">·</span>
              <span>${new Date(entry.at).toLocaleString()}</span>
              <span class="dot">·</span>
              <span>${entry.ok ? fmtMs(entry.durationMs) : "failed"}</span>
            </span>
          </button>
        `,
          )
          .join("")}</div>`;

  const backdrop = openModal(`
    <div class="modal history-modal">
      <div class="modal-head">
        <h2>Query history</h2>
        <button type="button" class="icon-btn" data-close="true" aria-label="Close">${icons.x}</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" id="btn-clear-history">Clear history</button>
        <span class="spacer"></span>
        <button type="button" class="btn" data-close="true">Close</button>
      </div>
    </div>
  `);

  backdrop.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const item = target.closest<HTMLElement>("[data-history-index]");
    if (item) {
      const entry = entries[Number(item.dataset.historyIndex)];
      const current = activeTab();
      closeModal();
      if (current?.type === "query") {
        current.sql = entry.sql;
        renderWorkspace();
      } else {
        newQueryTab(entry.sql);
      }
      return;
    }
    if (target.closest("#btn-clear-history")) {
      localStorage.removeItem(HISTORY_KEY);
      closeModal();
      toast("History cleared", "success");
    }
  });
}

/* ------------------------------------------------------------ row menu */

let rowMenu: HTMLDivElement | null = null;

function closeRowMenu(): void {
  rowMenu?.remove();
  rowMenu = null;
}

function showRowMenu(tab: TableTab, x: number, y: number): void {
  closeRowMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.innerHTML = `<button type="button">${icons.edit}<span>Edit in modal</span></button>`;
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  menu.querySelector("button")?.addEventListener("click", () => {
    closeRowMenu();
    openRowEditor(tab, "edit");
  });

  rowMenu = menu;
}

document.addEventListener("dblclick", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, select")) return;
  const cell = target.closest<HTMLTableCellElement>("td[data-col-index]");
  const rowEl = target.closest<HTMLElement>("tr[data-row-index]");
  const tab = activeTab();
  if (!cell || !rowEl || tab?.type !== "table") return;

  const rowIndex = Number(rowEl.dataset.rowIndex);
  const columnIndex = Number(cell.dataset.colIndex);
  if (!Number.isFinite(rowIndex) || !Number.isFinite(columnIndex)) return;
  void beginInlineEdit(tab, cell, rowIndex, columnIndex);
});

function showSchemaMenu(
  profileId: string,
  schema: string,
  x: number,
  y: number,
): void {
  closeRowMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.innerHTML = `
    <button type="button" class="danger" data-schema-menu="delete">${icons.trash}<span>Delete</span></button>
  `;
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  menu
    .querySelector<HTMLButtonElement>('[data-schema-menu="delete"]')
    ?.addEventListener("click", () => {
      closeRowMenu();
      void deleteSchemaAction(profileId, schema);
    });

  rowMenu = menu;
}

function showTableMenu(
  profileId: string,
  schema: string,
  table: string,
  x: number,
  y: number,
): void {
  closeRowMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.innerHTML = `
    <button type="button" data-table-menu="structure">${icons.columns}<span>Structure</span></button>
    <div class="context-sep"></div>
    <button type="button" class="warn" data-table-menu="truncate">${icons.eraser}<span>Truncate</span></button>
    <button type="button" class="danger" data-table-menu="delete">${icons.trash}<span>Delete</span></button>
  `;
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  menu
    .querySelector<HTMLButtonElement>('[data-table-menu="structure"]')
    ?.addEventListener("click", () => {
      closeRowMenu();
      openStructureTab(profileId, schema, table);
    });
  menu
    .querySelector<HTMLButtonElement>('[data-table-menu="truncate"]')
    ?.addEventListener("click", () => {
      closeRowMenu();
      void truncateTableAction(profileId, schema, table);
    });
  menu
    .querySelector<HTMLButtonElement>('[data-table-menu="delete"]')
    ?.addEventListener("click", () => {
      closeRowMenu();
      void deleteTableAction(profileId, schema, table);
    });

  rowMenu = menu;
}

async function deleteSchemaAction(
  profileId: string,
  schema: string,
): Promise<void> {
  const conn = conns.get(profileId);
  if (!conn) return;

  const label = conn.profile.kind === "postgres" ? "schema" : "database";
  const contents =
    conn.profile.kind === "postgres"
      ? " and all of its tables, views, and other objects"
      : "";
  const confirmed = await confirmDialog(
    `Delete ${label}`,
    `Drop ${label} "${schema}"${contents}? This cannot be undone.`,
  );
  if (!confirmed) return;

  try {
    await api.dropSchema(conn.session.id, schema);
    conn.schemas = (conn.schemas ?? []).filter((item) => item !== schema);
    conn.expandedSchemas.delete(schema);
    delete conn.tables[schema];
    closeTabsForSchema(profileId, schema);
    renderSidebar();
    renderTabbar();
    renderWorkspace();
    toast(`${label[0].toUpperCase()}${label.slice(1)} "${schema}" deleted`, "success");
  } catch (error) {
    toast(errorMessage(error), "error");
  }
}

async function truncateTableAction(
  profileId: string,
  schema: string,
  table: string,
): Promise<void> {
  const conn = conns.get(profileId);
  if (!conn) return;

  const confirmed = await confirmDialog(
    "Truncate table",
    `Delete all rows from "${schema}.${table}"? This cannot be undone.`,
  );
  if (!confirmed) return;

  try {
    await api.truncateTable(conn.session.id, schema, table);
    toast("Table truncated", "success");
    for (const tab of tabs) {
      if (
        tab.type === "table" &&
        tab.profileId === profileId &&
        tab.schema === schema &&
        tab.table === table &&
        !tab.loading
      ) {
        void loadPreview(tab);
      }
    }
  } catch (error) {
    toast(errorMessage(error), "error");
  }
}

async function deleteTableAction(
  profileId: string,
  schema: string,
  table: string,
): Promise<void> {
  const conn = conns.get(profileId);
  if (!conn) return;

  const confirmed = await confirmDialog(
    "Delete table",
    `Drop "${schema}.${table}"? This cannot be undone.`,
  );
  if (!confirmed) return;

  try {
    await api.dropTable(conn.session.id, schema, table);
    const cached = conn.tables[schema];
    if (cached) {
      conn.tables[schema] = cached.filter((item) => item.name !== table);
    }
    closeTabsForTable(profileId, schema, table);
    renderSidebar();
    toast(`Table "${table}" deleted`, "success");
  } catch (error) {
    toast(errorMessage(error), "error");
  }
}

document.addEventListener("contextmenu", (event) => {
  const target = event.target as HTMLElement;

  const schemaRow = target.closest<HTMLElement>(
    '.tree-row[data-action="toggle-schema"]',
  );
  if (schemaRow) {
    event.preventDefault();
    showSchemaMenu(
      schemaRow.dataset.id ?? "",
      schemaRow.dataset.schema ?? "",
      event.clientX,
      event.clientY,
    );
    return;
  }

  const treeRow = target.closest<HTMLElement>(
    '.tree-row[data-action="open-table"]',
  );
  if (treeRow) {
    const kind = treeRow.dataset.kind ?? "";
    if (isViewKind(kind)) return;
    event.preventDefault();
    showTableMenu(
      treeRow.dataset.id ?? "",
      treeRow.dataset.schema ?? "",
      treeRow.dataset.table ?? "",
      event.clientX,
      event.clientY,
    );
    return;
  }

  const rowEl = target.closest<HTMLElement>("tr[data-row-index]");
  const tab = activeTab();
  if (!rowEl || tab?.type !== "table" || tab.isView) return;

  const index = Number(rowEl.dataset.rowIndex);
  if (!Number.isFinite(index)) return;
  event.preventDefault();

  tab.selectedRow = index;
  rowEl.parentElement
    ?.querySelectorAll("tr.selected")
    .forEach((row) => row.classList.remove("selected"));
  rowEl.classList.add("selected");
  updateTableToolbar(tab);
  showRowMenu(tab, event.clientX, event.clientY);
});

document.addEventListener("scroll", closeRowMenu, true);
window.addEventListener("resize", closeRowMenu);

/* ------------------------------------------------------- global listeners */

document.addEventListener("click", (event) => {
  closeRowMenu();
  const target = event.target as HTMLElement;
  const current = activeTab();
  const rowEl = target.closest<HTMLElement>("tr[data-row-index]");

  if (current?.type === "table" && rowEl) {
    const index = Number(rowEl.dataset.rowIndex);
    if (Number.isFinite(index)) {
      current.selectedRow = index;
      rowEl.parentElement
        ?.querySelectorAll("tr.selected")
        .forEach((row) => row.classList.remove("selected"));
      rowEl.classList.add("selected");
      updateTableToolbar(current);
    }
    return;
  }

  const actionEl = target.closest<HTMLElement>("[data-action]");
  if (!actionEl) return;

  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id ?? "";

  switch (action) {
    case "add-connection":
      openConnectionModal();
      break;
    case "history":
      openHistoryModal();
      break;
    case "new-query":
      newQueryTab();
      break;
    case "insert-row": {
      const tab = activeTab();
      if (tab?.type === "table") openRowEditor(tab, "insert");
      break;
    }
    case "delete-row": {
      const tab = activeTab();
      if (tab?.type === "table") void deleteSelectedRow(tab);
      break;
    }
    case "connect": {
      const profile = profiles.find((p) => p.id === id);
      if (profile) void connectSavedOrPrompt(profile);
      break;
    }
    case "disconnect":
      void disconnectProfile(id);
      break;
    case "edit": {
      const profile = profiles.find((p) => p.id === id);
      if (profile) openConnectionModal(profile);
      break;
    }
    case "delete": {
      const profile = profiles.find((p) => p.id === id);
      if (!profile) break;
      void confirmDialog(
        "Delete connection",
        `Delete "${profile.name}"? This cannot be undone.`,
      ).then(async (confirmed) => {
        if (!confirmed) return;
        try {
          await api.deleteProfile(profile.id);
          await disconnectProfile(profile.id);
          profiles = await api.listProfiles();
          renderSidebar();
          toast("Connection deleted", "success");
        } catch (error) {
          toast(errorMessage(error), "error");
        }
      });
      break;
    }
    case "toggle-profile": {
      const profile = profiles.find((p) => p.id === id);
      if (!profile) break;
      const conn = conns.get(id);
      if (!conn) {
        void connectSavedOrPrompt(profile);
        break;
      }
      conn.expanded = !conn.expanded;
      renderSidebar();
      if (conn.expanded && !conn.schemas) void loadSchemas(id);
      break;
    }
    case "switch-database": {
      void switchDatabase(id, actionEl.dataset.database ?? "");
      break;
    }
    case "create-schema": {
      openCreateSchemaModal(id, actionEl.dataset.database ?? "");
      break;
    }
    case "create-database": {
      openCreateDatabaseModal(id);
      break;
    }
    case "create-table": {
      openCreateTableTab(id, actionEl.dataset.schema ?? "");
      break;
    }
    case "toggle-schema": {
      const conn = conns.get(id);
      const schema = actionEl.dataset.schema ?? "";
      if (!conn) break;
      if (conn.expandedSchemas.has(schema)) {
        conn.expandedSchemas.delete(schema);
      } else {
        conn.expandedSchemas.add(schema);
        if (!conn.tables[schema]) void loadTables(id, schema);
      }
      renderSidebar();
      break;
    }
    case "open-table": {
      openTableTab(
        id,
        actionEl.dataset.schema ?? "",
        actionEl.dataset.table ?? "",
        actionEl.dataset.kind ?? "",
      );
      break;
    }
    case "activate-tab":
      if (actionEl.dataset.tabId) activateTab(actionEl.dataset.tabId);
      break;
    case "close-tab":
      if (actionEl.dataset.tabId) closeTab(actionEl.dataset.tabId);
      break;
    default:
      break;
  }
});

async function init(): Promise<void> {
  renderShell();
  renderSidebar();
  renderTabbar();
  renderWorkspace();

  try {
    profiles = await api.listProfiles();
  } catch (error) {
    toast(errorMessage(error), "error");
  }
  renderSidebar();
}

void init();
