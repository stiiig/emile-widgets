"use client";

/**
 * Dashboard EMILE — /dev/links
 *
 * Tableau de bord avec 5 onglets (Candidats, Accompagnants, Établissements,
 * Dép. & Régions, FAQ). Chaque onglet affiche un tableau virtualisé des
 * données Grist avec filtres et tri par colonne.
 *
 * Sécurité : la connexion Grist (server / docId / token) est stockée
 * uniquement dans le localStorage du navigateur — jamais dans le code.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import "./styles.css";

// ─── Types ────────────────────────────────────────────────────────────────────

type GristVal = string | number | boolean | null | unknown[];

interface GristRow {
  id: number;
  [col: string]: GristVal;
}

interface TableState {
  rows: GristRow[];
  columns: string[];
  loading: boolean;
  error: string;
}

interface FilterDef {
  type: "text" | "dropdown";
  key: string;
  placeholder?: string;
  label?: string;
  /** colonnes de recherche pour type="text" — vide = toutes les colonnes */
  fields?: string[];
  /** colonne cible pour type="dropdown" */
  column?: string;
}

interface TabDef {
  id: string;
  label: string;
  tableId: string;
  filters: FilterDef[];
}

interface Config {
  server: string;
  docId: string;
  token: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const LS_KEY = "db-emile-cfg";

function loadConfig(): Config | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "null"); }
  catch { return null; }
}

function saveConfig(c: Config) {
  localStorage.setItem(LS_KEY, JSON.stringify(c));
}

// ─── Tabs & filters ───────────────────────────────────────────────────────────

const TABS: TabDef[] = [
  {
    id: "cand",
    label: "Candidats",
    tableId: "CANDIDATS",
    filters: [
      { type: "text", key: "q", placeholder: "Prénom, nom, email…", fields: ["Prenom", "Nom_de_famille", "Email"] },
    ],
  },
  {
    id: "acc",
    label: "Accompagnants",
    tableId: "ACCOMPAGNANTS",
    filters: [
      { type: "text",     key: "q",            placeholder: "Prénom, nom, email…", fields: ["Prenom", "Nom", "Email"] },
      { type: "dropdown", key: "Etablissement", label: "Établissement", column: "Etablissement" },
      { type: "dropdown", key: "Fonction",      label: "Fonction",      column: "Fonction" },
    ],
  },
  {
    id: "etab",
    label: "Établissements",
    tableId: "ETABLISSEMENTS",
    filters: [
      { type: "text",     key: "q",                      placeholder: "Nom établissement…", fields: ["Nom_etablissement"] },
      { type: "dropdown", key: "Dispositif",             label: "Dispositif",  column: "Dispositif" },
      { type: "dropdown", key: "Departement",            label: "Département", column: "Departement" },
      { type: "dropdown", key: "Role",                   label: "Rôle",        column: "Role" },
      { type: "dropdown", key: "Organisme_gestionnaire", label: "Organisme",   column: "Organisme_gestionnaire" },
    ],
  },
  {
    id: "dpts",
    label: "Dép. & Régions",
    tableId: "DPTS_REGIONS",
    filters: [
      { type: "text",     key: "q",                  placeholder: "Rechercher…", fields: [] },
      { type: "dropdown", key: "Nom_region",          label: "Région",            column: "Nom_region" },
      { type: "dropdown", key: "Territoire_depart",   label: "Terr. départ",      column: "Territoire_depart" },
      { type: "dropdown", key: "Territoire_accueil",  label: "Terr. accueil",     column: "Territoire_accueil" },
    ],
  },
  {
    id: "faq",
    label: "FAQ",
    tableId: "FAQ",
    filters: [
      { type: "text",     key: "q",                        placeholder: "Rechercher…", fields: [] },
      { type: "dropdown", key: "Section_de_la_question",   label: "Section",    column: "Section_de_la_question" },
      { type: "dropdown", key: "Obligatoire_ou_non",       label: "Obligatoire", column: "Obligatoire_ou_non" },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Grist value → affichable string */
function fmt(v: GristVal): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (Array.isArray(v)) {
    // ChoiceList / RefList : ["L", val1, val2, ...]
    if (v[0] === "L") return (v.slice(1) as GristVal[]).map(x => String(x ?? "")).filter(Boolean).join(", ");
    return JSON.stringify(v);
  }
  return String(v);
}

/** Extrait les valeurs individuelles d'un champ (ChoiceList, texte, etc.) pour les dropdowns */
function extractChoices(v: GristVal): string[] {
  if (Array.isArray(v) && v[0] === "L") return (v.slice(1) as GristVal[]).map(x => String(x ?? "")).filter(Boolean);
  const s = fmt(v).trim();
  return s ? s.split(/[\n,]+/).map(x => x.trim()).filter(Boolean) : [];
}

function rowMatchesText(row: GristRow, fields: string[], allCols: string[], q: string): boolean {
  const cols = fields.length > 0 ? fields : allCols;
  const lq = q.toLowerCase();
  return cols.some(c => fmt(row[c]).toLowerCase().includes(lq));
}

function rowMatchesDropdown(row: GristRow, column: string, value: string): boolean {
  return extractChoices(row[column]).includes(value);
}

// ─── Grist API ────────────────────────────────────────────────────────────────

async function gristFetchTable(cfg: Config, tableId: string): Promise<{ rows: GristRow[]; columns: string[] }> {
  const base = cfg.server.replace(/\/$/, "");
  const url  = `${base}/api/docs/${cfg.docId}/tables/${tableId}/records`;
  const res  = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`${res.status} — ${(body as any)?.error ?? res.statusText}`);
  }
  const { records } = await res.json() as {
    records: { id: number; fields: Record<string, GristVal> }[];
  };
  if (!records.length) return { rows: [], columns: [] };
  const columns = Object.keys(records[0].fields).filter(k => !k.startsWith("grist_"));
  const rows: GristRow[] = records.map(r => ({ id: r.id, ...r.fields }));
  return { rows, columns };
}

// ─── Virtual table ────────────────────────────────────────────────────────────

const NUM_W  = 50;   // px — colonne n° de ligne
const COL_W  = 160;  // px — colonne de données
const ROW_H  = 36;   // px — hauteur de ligne
const BUFFER = 6;    // lignes supplémentaires au-delà du viewport

function VirtualTable({
  columns, rows, sortState, onSort,
}: {
  columns: string[];
  rows: GristRow[];
  sortState: { col: string; dir: "asc" | "desc" } | null;
  onSort: (col: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH,     setViewH]     = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateH = () => setViewH(el.clientHeight);
    updateH();
    const ro = new ResizeObserver(updateH);
    ro.observe(el);
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); };
  }, []);

  // Reset scroll when rows change (filter applied)
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [rows]);

  const totalW  = NUM_W + columns.length * COL_W;
  const totalH  = rows.length * ROW_H;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
  const endIdx   = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + BUFFER);

  return (
    <div className="db-vtable" ref={containerRef}>
      {/* Wrapper pour le scroll horizontal */}
      <div style={{ minWidth: totalW }}>

        {/* Header — sticky vertical, suit le scroll horizontal */}
        <div className="db-header-row" style={{ width: totalW }}>
          <div className="db-cell db-cell--num">#</div>
          {columns.map(col => (
            <div
              key={col}
              className={`db-cell db-cell--head${sortState?.col === col ? " db-cell--sorted" : ""}`}
              style={{ width: COL_W, minWidth: COL_W }}
              onClick={() => onSort(col)}
              title={col}
            >
              <span className="db-cell-txt">{col}</span>
              <span className="db-sort-icon">
                {sortState?.col === col ? (sortState.dir === "asc" ? "↑" : "↓") : "⇅"}
              </span>
            </div>
          ))}
        </div>

        {/* Corps virtualisé */}
        <div style={{ position: "relative", height: totalH }}>
          {rows.slice(startIdx, endIdx).map((row, i) => {
            const absIdx = startIdx + i;
            return (
              <div
                key={row.id}
                className={`db-row${absIdx % 2 ? " db-row--alt" : ""}`}
                style={{ position: "absolute", top: absIdx * ROW_H, left: 0, width: totalW }}
              >
                <div className="db-cell db-cell--num">{absIdx + 1}</div>
                {columns.map(col => (
                  <div
                    key={col}
                    className="db-cell"
                    style={{ width: COL_W, minWidth: COL_W }}
                    title={fmt(row[col])}
                  >
                    <span className="db-cell-txt">{fmt(row[col])}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({
  tab, tableRows, filters, onChange,
}: {
  tab: TabDef;
  tableRows: GristRow[];
  filters: Record<string, string>;
  onChange: (key: string, val: string) => void;
}) {
  const dropdownOpts = useMemo(() => {
    const opts: Record<string, string[]> = {};
    for (const f of tab.filters) {
      if (f.type !== "dropdown" || !f.column) continue;
      const seen = new Set<string>();
      for (const row of tableRows) {
        for (const v of extractChoices(row[f.column!])) seen.add(v);
      }
      opts[f.key] = Array.from(seen).sort((a, b) => a.localeCompare(b, "fr"));
    }
    return opts;
  }, [tab, tableRows]);

  const hasActive = Object.values(filters).some(Boolean);

  return (
    <div className="db-filterbar">
      {tab.filters.map(f =>
        f.type === "text" ? (
          <input
            key={f.key}
            className="db-filter-text"
            placeholder={f.placeholder}
            value={filters[f.key] ?? ""}
            onChange={e => onChange(f.key, e.target.value)}
          />
        ) : (
          <select
            key={f.key}
            className="db-filter-select"
            value={filters[f.key] ?? ""}
            onChange={e => onChange(f.key, e.target.value)}
          >
            <option value="">{f.label} — tous</option>
            {(dropdownOpts[f.key] ?? []).map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        )
      )}
      {hasActive && (
        <button className="db-filter-clear" onClick={() => tab.filters.forEach(f => onChange(f.key, ""))}>
          ✕ Effacer les filtres
        </button>
      )}
    </div>
  );
}

// ─── Config panel ─────────────────────────────────────────────────────────────

function ConfigPanel({ initial, onSave, onClose }: {
  initial: Config | null;
  onSave: (c: Config) => void;
  onClose?: () => void;
}) {
  const [server, setServer] = useState(initial?.server ?? "https://docs.getgrist.com");
  const [docId,  setDocId]  = useState(initial?.docId  ?? "");
  const [token,  setToken]  = useState(initial?.token  ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const c: Config = { server: server.trim(), docId: docId.trim(), token: token.trim() };
    saveConfig(c);
    onSave(c);
  }

  return (
    <div className="db-cfg-overlay" onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <form className="db-cfg-panel" onSubmit={submit}>
        <h2 className="db-cfg-title">⚙ Connexion Grist</h2>
        <p className="db-cfg-hint">
          Stocké uniquement dans votre localStorage — jamais transmis au serveur de l&apos;application.
          Nécessite que CORS soit activé depuis cette origine sur votre instance Grist.
        </p>

        <label className="db-cfg-label">
          Serveur Grist
          <input className="db-cfg-input" value={server} onChange={e => setServer(e.target.value)}
            placeholder="https://docs.getgrist.com" required />
        </label>
        <label className="db-cfg-label">
          ID du document
          <input className="db-cfg-input" value={docId} onChange={e => setDocId(e.target.value)}
            placeholder="abc123def456" required />
        </label>
        <label className="db-cfg-label">
          Token API personnel
          <input className="db-cfg-input" type="password" value={token} onChange={e => setToken(e.target.value)}
            placeholder="••••••••••••••••" autoComplete="off" required />
        </label>

        <div className="db-cfg-actions">
          <button className="db-cfg-save" type="submit">Enregistrer</button>
          {onClose && <button className="db-cfg-cancel" type="button" onClick={onClose}>Annuler</button>}
        </div>
      </form>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const EMPTY_TABLE: TableState = { rows: [], columns: [], loading: false, error: "" };

export default function DevDashboard() {
  const [config,     setConfig]     = useState<Config | null>(null);
  const [showCfg,    setShowCfg]    = useState(false);
  const [activeTab,  setActiveTab]  = useState(TABS[0].id);
  const [tableData,  setTableData]  = useState<Record<string, TableState>>(
    () => Object.fromEntries(TABS.map(t => [t.id, { ...EMPTY_TABLE }]))
  );
  const [filterStates, setFilterStates] = useState<Record<string, Record<string, string>>>(
    () => Object.fromEntries(TABS.map(t => [t.id, {}]))
  );
  const [sortStates, setSortStates] = useState<Record<string, { col: string; dir: "asc" | "desc" } | null>>(
    () => Object.fromEntries(TABS.map(t => [t.id, null]))
  );

  // Clé de fetch : change lors d'un refresh forcé
  const [fetchKey, setFetchKey] = useState(0);
  // Ensemble des onglets déjà chargés (par config.docId:tabId)
  const loadedRef = useRef<Set<string>>(new Set());

  // Chargement initial de la config depuis localStorage
  useEffect(() => {
    const c = loadConfig();
    setConfig(c);
    if (!c) setShowCfg(true);
  }, []);

  // Fetch de la table active si pas encore chargée
  useEffect(() => {
    if (!config) return;
    const tab = TABS.find(t => t.id === activeTab)!;
    const key = `${config.docId}:${activeTab}`;
    if (loadedRef.current.has(key)) return;
    loadedRef.current.add(key);

    setTableData(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], loading: true, error: "" } }));
    gristFetchTable(config, tab.tableId)
      .then(({ rows, columns }) => {
        setTableData(prev => ({ ...prev, [activeTab]: { rows, columns, loading: false, error: "" } }));
      })
      .catch((err: unknown) => {
        loadedRef.current.delete(key); // permet un retry
        setTableData(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], loading: false, error: String(err) } }));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, config, fetchKey]);

  function handleConfigSave(c: Config) {
    setConfig(c);
    setShowCfg(false);
    // Réinitialise tout pour forcer un rechargement
    loadedRef.current.clear();
    setTableData(Object.fromEntries(TABS.map(t => [t.id, { ...EMPTY_TABLE }])));
    setFetchKey(k => k + 1);
  }

  function handleRefresh() {
    if (!config) return;
    const key = `${config.docId}:${activeTab}`;
    loadedRef.current.delete(key);
    setTableData(prev => ({ ...prev, [activeTab]: { ...EMPTY_TABLE } }));
    setFetchKey(k => k + 1);
  }

  function setFilter(tabId: string, key: string, val: string) {
    setFilterStates(prev => ({ ...prev, [tabId]: { ...prev[tabId], [key]: val } }));
  }

  function handleSort(tabId: string, col: string) {
    setSortStates(prev => {
      const cur = prev[tabId];
      return {
        ...prev,
        [tabId]: cur?.col === col
          ? { col, dir: cur.dir === "asc" ? "desc" : "asc" }
          : { col, dir: "asc" },
      };
    });
  }

  // ── Données dérivées de l'onglet actif ──────────────────────────────────────
  const tabDef   = TABS.find(t => t.id === activeTab)!;
  const tabState = tableData[activeTab];
  const filters  = filterStates[activeTab] ?? {};
  const sort     = sortStates[activeTab] ?? null;

  const filteredRows = useMemo(() => {
    let rows = tabState.rows;
    const allCols = tabState.columns;

    for (const f of tabDef.filters) {
      const val = filters[f.key];
      if (!val) continue;
      if (f.type === "text") {
        rows = rows.filter(r => rowMatchesText(r, f.fields ?? [], allCols, val));
      } else if (f.type === "dropdown" && f.column) {
        rows = rows.filter(r => rowMatchesDropdown(r, f.column!, val));
      }
    }

    if (sort) {
      const { col, dir } = sort;
      rows = [...rows].sort((a, b) => {
        const cmp = fmt(a[col]).localeCompare(fmt(b[col]), "fr", { numeric: true, sensitivity: "base" });
        return dir === "asc" ? cmp : -cmp;
      });
    }

    return rows;
  }, [tabState, tabDef, filters, sort]);

  // ── Rendu ────────────────────────────────────────────────────────────────────

  return (
    <div className="db-page">

      {/* Header */}
      <header className="db-header">
        <span className="db-header__title">📊 Dashboard EMILE</span>
        <div className="db-header__right">
          {config && (
            <span className="db-header__server" title={`Doc : ${config.docId}`}>
              {config.server.replace(/^https?:\/\//, "")}
            </span>
          )}
          <button className="db-header__cfg" onClick={() => setShowCfg(true)} title="Configurer la connexion">
            ⚙
          </button>
        </div>
      </header>

      {/* Config panel (modal) */}
      {showCfg && (
        <ConfigPanel
          initial={config}
          onSave={handleConfigSave}
          onClose={config ? () => setShowCfg(false) : undefined}
        />
      )}

      {/* Onglets */}
      <nav className="db-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`db-tab${activeTab === t.id ? " db-tab--active" : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
            {tableData[t.id].rows.length > 0 && (
              <span className="db-tab__badge">{tableData[t.id].rows.length}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Contenu principal */}
      <main className="db-main">
        {!config ? (
          <div className="db-state">
            Configurez la connexion Grist pour accéder aux données.
          </div>
        ) : tabState.loading ? (
          <div className="db-state db-state--loading">
            <span className="db-spinner" /> Chargement de {tabDef.tableId}…
          </div>
        ) : tabState.error ? (
          <div className="db-state db-state--error">
            <strong>⚠ Erreur</strong> — {tabState.error}
            <button className="db-btn-retry" onClick={handleRefresh}>Réessayer</button>
          </div>
        ) : tabState.rows.length === 0 ? (
          <div className="db-state">
            Aucune donnée.{" "}
            <button className="db-btn-retry" onClick={handleRefresh}>Charger</button>
          </div>
        ) : (
          <>
            <FilterBar
              tab={tabDef}
              tableRows={tabState.rows}
              filters={filters}
              onChange={(key, val) => setFilter(activeTab, key, val)}
            />

            <div className="db-table-bar">
              <span className="db-table-count">
                {filteredRows.length !== tabState.rows.length
                  ? `${filteredRows.length} / ${tabState.rows.length} lignes`
                  : `${filteredRows.length} ligne${filteredRows.length > 1 ? "s" : ""}`}
                {" · "}
                {tabState.columns.length} colonnes
              </span>
              <button className="db-btn-refresh" onClick={handleRefresh} title="Rafraîchir depuis Grist">
                ↺ Rafraîchir
              </button>
            </div>

            <VirtualTable
              columns={tabState.columns}
              rows={filteredRows}
              sortState={sort}
              onSort={col => handleSort(activeTab, col)}
            />
          </>
        )}
      </main>

    </div>
  );
}
