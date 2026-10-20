import "./style.css";
import { api, errorMessage } from "./api";
import { icons } from "./icons";
import { closeModal, confirmDialog, esc, fmtMs, openModal, spinner, toast } from "./ui";
import type {
  ConnectionState,
  DbKind,
  HistoryEntry,
  Profile,
  QueryTab,
  QueryResult,
  TableTab,
  ViewTab,
} from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;

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

  const databaseSection =
    profile.kind === "postgres" ? databasesHtml(profile, conn) : "";
  const label = profile.kind === "postgres" ? "schema" : "database";

  const schemaSection =
    schemas.length === 0
      ? `<div class="tree-loading">No ${label}s found</div>`
      : `
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
                <span class="tree-actions">
                  <button class="icon-btn tiny" title="New table" data-action="create-table" data-id="${esc(profile.id)}" data-schema="${esc(schema)}">${icons.plus}</button>
                  ${
                    profile.kind === "mysql"
                      ? `<button class="icon-btn tiny danger" title="Drop database" data-action="drop-database" data-id="${esc(profile.id)}" data-database="${esc(schema)}">${icons.trash}</button>`
                      : ""
                  }
                </span>
              </div>
              ${open ? tablesHtml(profile, conn, schema) : ""}
            </div>
          `;
        })
        .join("")}
    `;

  return `<div class="tree">${databaseSection}${schemaSection}</div>`;
}

function databasesHtml(profile: Profile, conn: ConnectionState): string {
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
        <button class="icon-btn tiny" title="New database" data-action="create-database" data-id="${esc(profile.id)}">${icons.plus}</button>
      </div>
      ${databases
        .map(
          (database) => `
        <div class="tree-line db-line ${database === conn.session.database ? "current" : ""}">
          <span class="tree-row static" title="${esc(database)}">
            <span class="tree-icon">${icons.database}</span>
            <span class="tree-name">${esc(database)}</span>
            ${database === conn.session.database ? '<span class="tag">current</span>' : ""}
          </span>
          <span class="tree-actions">
            <button class="icon-btn tiny" title="Rename database" data-action="rename-database" data-id="${esc(profile.id)}" data-database="${esc(database)}">${icons.edit}</button>
            <button class="icon-btn tiny danger" title="Drop database" data-action="drop-database" data-id="${esc(profile.id)}" data-database="${esc(database)}">${icons.trash}</button>
          </span>
        </div>
      `,
        )
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
          ${
            isView
              ? ""
              : `<span class="tree-actions">
                  <button class="icon-btn tiny" title="Rename table" data-action="rename-table" data-id="${esc(profile.id)}" data-schema="${esc(table.schema)}" data-table="${esc(table.name)}">${icons.edit}</button>
                  <button class="icon-btn tiny danger" title="Drop table" data-action="drop-table" data-id="${esc(profile.id)}" data-schema="${esc(table.schema)}" data-table="${esc(table.name)}">${icons.trash}</button>
                </span>`
          }
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
        <span class="tab-icon">${tab.type === "query" ? icons.terminal : icons.table}</span>
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
  else renderTableTab(ws, tab);
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
          <button class="btn" id="btn-edit-row" data-action="edit-row">${icons.edit} Edit</button>
          <button class="btn danger" id="btn-delete-row" data-action="delete-row">${icons.trash} Delete</button>
          <span class="toolbar-sep"></span>
          <button class="btn ghost" data-action="table-columns">Columns</button>
          <button class="btn ghost" data-action="rename-table">Rename</button>
          <button class="btn ghost danger" data-action="drop-table">Drop table</button>
          <span class="toolbar-sep"></span>
        `
            : `<span class="tag">view</span>`
        }
        <button class="btn" id="btn-refresh" data-action="refresh-table">${icons.refresh} Refresh</button>
      </div>
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
      <div class="result-panel" id="result-panel">${resultPanelHtml(tab)}</div>
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

  const edit = byId<HTMLButtonElement>("btn-edit-row");
  if (edit) edit.disabled = tab.loading || tab.selectedRow === null;
  const del = byId<HTMLButtonElement>("btn-delete-row");
  if (del) del.disabled = tab.loading || tab.selectedRow === null;
}

/* ------------------------------------------------------------ result view */

function resultPanelHtml(tab: ViewTab): string {
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
  return gridHtml(tab.result);
}

function gridHtml(result: QueryResult): string {
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
      <tr>
        <td class="rownum">${index + 1}</td>
        ${row.map(cellHtml).join("")}
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

function cellHtml(value: unknown): string {
  if (value === null || value === undefined) {
    return `<td class="cell null">NULL</td>`;
  }
  if (typeof value === "number") {
    return `<td class="cell num">${esc(value)}</td>`;
  }
  if (typeof value === "boolean") {
    return `<td class="cell bool">${value ? "true" : "false"}</td>`;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === "") {
    return `<td class="cell empty">empty</td>`;
  }
  return `<td class="cell" title="${esc(text.slice(0, 2000))}"><span class="cell-text">${esc(text)}</span></td>`;
}

function updateResultPanel(tab: ViewTab): void {
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
  });
  lastProfileId = profile.id;
  renderSidebar();
  renderTabbar();
  renderWorkspace();
  void loadSchemas(profile.id);
  if (profile.kind === "postgres") void loadDatabases(profile.id);
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
          <input name="password" type="password" autocomplete="off" placeholder="••••••••" />
          <small>Used for this session only, never written to disk.</small>
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
        const version = await api.testConnection(
          candidate,
          secrets.password,
          secrets.sshSecret,
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

    try {
      const saved = await api.saveProfile(candidate);
      profiles = await api.listProfiles();
      closeModal();
      renderSidebar();
      try {
        await connectProfile(saved, secrets);
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
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    submit.disabled = true;
    status.className = "form-status wide info";
    status.innerHTML = spinner("Connecting…");
    try {
      await connectProfile(profile, secrets);
      closeModal();
      toast(`Connected to ${profile.name}`, "success");
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

/* ------------------------------------------------------- global listeners */

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
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
    case "connect": {
      const profile = profiles.find((p) => p.id === id);
      if (profile) openConnectModal(profile);
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
        openConnectModal(profile);
        break;
      }
      conn.expanded = !conn.expanded;
      renderSidebar();
      if (conn.expanded && !conn.schemas) void loadSchemas(id);
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
