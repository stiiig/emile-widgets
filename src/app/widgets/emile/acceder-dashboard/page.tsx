"use client";

/**
 * Dashboard EMILE — /widgets/emile/acceder-dashboard
 *
 * ── Architecture ────────────────────────────────────────────────────────────
 * Accès par magic link : ?token=TS.HMAC (24 h de validité).
 *   • TS   = timestamp Unix en secondes au moment de la génération
 *   • HMAC = HMAC-SHA256(TS, SECRET) calculé exclusivement dans N8N
 *
 * Flux token :
 *   1. URL ?token=X  → stocké en sessionStorage, URL nettoyée (replaceState)
 *   2. Rechargement  → lu depuis sessionStorage (token non ré-exposé)
 *   3. 401/403 N8N   → sessionStorage effacé, écran « Lien expiré »
 *
 * Sécurité : le secret HMAC ne quitte jamais N8N.
 * Le token n'est plus dans l'URL après le premier chargement → absent des
 * logs serveur, de l'historique navigateur et des entêtes Referer.
 *
 * ── Données ────────────────────────────────────────────────────────────────
 * dashFetchTable() appelle le proxy N8N (NEXT_PUBLIC_DASHBOARD_URL) qui :
 *   1. Vérifie la signature HMAC et l'expiration (> 24 h → 401)
 *   2. Proxye la requête vers l'API Grist (table records)
 *   3. Retourne { records: [{ id, fields }] }
 *
 * ── Rendu ──────────────────────────────────────────────────────────────────
 * Tableau virtualisé (VirtualTable) : seules les lignes visibles + BUFFER
 * sont rendues dans le DOM, évitant les ralentissements sur plusieurs milliers
 * de lignes. Le scroll déclenche un setState qui recalcule la fenêtre.
 *
 * ── Résolution Ref ──────────────────────────────────────────────────────────
 * Les colonnes Ref Grist stockent un entier (row ID). Pour les afficher en
 * valeur lisible, `refLookups` décrit quelle table charger et quelle colonne
 * utiliser comme libellé. La résolution est entièrement client-side :
 *   1. La table principale charge (ex. ACCOMPAGNANTS)
 *   2. Les tables référencées (ex. ETABLISSEMENTS) sont chargées en arrière-plan
 *   3. Une Map<rowId, displayValue> est construite
 *   4. resolveRefs() remplace les entiers par les valeurs lisibles avant affichage
 */

import { useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import { SearchDropdown, type Option } from "@/components/SearchDropdown";
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
  /** Colonnes de recherche pour type="text" — vide = toutes les colonnes */
  fields?: string[];
  /** Colonne cible pour type="dropdown" */
  column?: string;
}

interface TabDef {
  id: string;
  label: string;
  tableId: string;
  filters: FilterDef[];
  /** Colonnes à masquer dans le tableau (colonnes techniques, doublons, etc.) */
  hiddenColumns?: string[];
  /**
   * Résolution client-side de colonnes Ref Grist (stockent un entier = row ID) :
   *   { "ColRef": { tableId: "TABLE_CIBLE", displayCol: "colonne_lisible" } }
   *
   * Quand la table cible est chargée via dashFetchTable(), une Map<rowId, string>
   * est construite. resolveRefs() l'utilise pour remplacer les entiers par les
   * valeurs lisibles dans les lignes, avant filtrage et affichage.
   *
   * Exemple : Etablissement (Ref → ETABLISSEMENTS) → affiche Nom_etablissement
   */
  refLookups?: Record<string, { tableId: string; displayCol: string }>;
}

// ─── Token ────────────────────────────────────────────────────────────────────

type TokenStatus = "resolving" | "missing" | "expired" | "ok";

const SS_KEY = "db-emile-token";

/** Signale un token invalide ou expiré (401/403 de N8N) */
class TokenExpiredError extends Error {
  constructor() { super("token_expired"); }
}

// ─── Tabs & filters ───────────────────────────────────────────────────────────

/**
 * Configuration des onglets du dashboard.
 * Chaque onglet définit : la table Grist source, les filtres disponibles
 * et les éventuelles résolutions de colonnes Ref (refLookups).
 */
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
    // Colonnes Ref → valeur lisible chargée depuis la table référencée
    refLookups: {
      // Etablissement stocke un row ID de ETABLISSEMENTS → on affiche Nom_etablissement
      "Etablissement":             { tableId: "ETABLISSEMENTS", displayCol: "Nom_etablissement" },
      // Etablissement_Departement : si c'est un Ref vers DPTS_REGIONS → on affiche Numero_et_nom
      // (si c'est déjà une string, resolveRefs() ne touche pas à la valeur)
      "Etablissement_Departement": { tableId: "DPTS_REGIONS",   displayCol: "Numero_et_nom"     },
    },
    filters: [
      { type: "text",     key: "q",             placeholder: "Prénom, nom, email…", fields: ["Prenom", "Nom", "Email"] },
      // Le dropdown filtre sur la colonne Etablissement une fois résolue (noms lisibles)
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
      { type: "text",     key: "q",                      placeholder: "Rechercher…", fields: [] },
      { type: "dropdown", key: "Section_de_la_question", label: "Section",     column: "Section_de_la_question" },
      { type: "dropdown", key: "Obligatoire_ou_non",     label: "Obligatoire", column: "Obligatoire_ou_non" },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Détecte un timestamp Unix Grist (stocké en secondes depuis l'epoch).
 * Bornes : 800 000 000 ≈ 1995, 2 500 000 000 ≈ 2049.
 * Accepte les float (colonnes DateTime — ex. 1772798332.28237) et les entiers (Date).
 * Permet d'exclure les petits entiers (row IDs Grist, booleans 0/1, etc.)
 * tout en couvrant toutes les colonnes Date/DateTime plausibles.
 */
function isUnixTs(v: GristVal): v is number {
  return typeof v === "number" && v > 800_000_000 && v < 2_500_000_000;
}

/** Formate un timestamp Unix (secondes) en JJ/MM/AAAA */
function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

/**
 * Grist value → string affichable (utilisé pour : tooltip title=, tri, recherche texte).
 * Ne retourne PAS de JSX — pour le rendu cellule utiliser renderCell().
 */
function fmt(v: GristVal): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (Array.isArray(v)) {
    // ChoiceList / RefList : ["L", val1, val2, ...]
    if (v[0] === "L") return (v.slice(1) as GristVal[]).map(x => String(x ?? "")).filter(Boolean).join(", ");
    return JSON.stringify(v);
  }
  if (isUnixTs(v)) return fmtDate(v);
  return String(v);
}

/**
 * Grist value → nœud JSX pour l'affichage dans les cellules du tableau.
 *   • ChoiceList / RefList ["L", v1, v2, …] → badges chips côte à côte
 *   • Timestamp Unix (Date / DateTime Grist)  → JJ/MM/AAAA via toLocaleDateString
 *   • Autres valeurs                          → String(v) comme fmt()
 */
function renderCell(v: GristVal): ReactNode {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "✓" : "✗";

  // ChoiceList / RefList : ["L", val1, val2, …]
  if (Array.isArray(v) && v[0] === "L") {
    const items = (v.slice(1) as GristVal[]).map(x => String(x ?? "")).filter(Boolean);
    if (!items.length) return null;
    return (
      <span className="db-chips">
        {items.map((item, i) => <span key={i} className="db-chip">{item}</span>)}
      </span>
    );
  }

  // Timestamp Unix (colonnes Date / DateTime Grist)
  if (isUnixTs(v)) return fmtDate(v);

  return String(v);
}

/** Extrait les valeurs individuelles d'un champ pour les dropdowns */
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

/**
 * Résout les colonnes Ref d'une table : remplace les entiers (row IDs Grist)
 * par la valeur lisible issue de la table référencée.
 *
 * Si la valeur n'est pas un entier (déjà une string, null, etc.) ou si la
 * table cible n'est pas encore chargée, la valeur d'origine est conservée.
 */
function resolveRefs(
  rows: GristRow[],
  tab: TabDef,
  refMaps: Record<string, Map<number, string>>,
): GristRow[] {
  if (!tab.refLookups) return rows;
  const entries = Object.entries(tab.refLookups);
  if (!entries.length) return rows;

  return rows.map(row => {
    let resolved: GristRow | null = null; // clone paresseux — évite l'allocation si rien ne change
    for (const [col, { tableId, displayCol }] of entries) {
      const val = row[col];
      if (typeof val !== "number") continue;  // pas un Ref ID, on laisse tel quel
      const map = refMaps[`${tableId}::${displayCol}`];
      if (!map) continue;                      // table pas encore chargée
      const display = map.get(val);
      if (display === undefined) continue;     // ID inconnu dans la table cible
      if (!resolved) resolved = { ...row };
      resolved[col] = display;
    }
    return resolved ?? row;
  });
}

// ─── API dashboard ────────────────────────────────────────────────────────────

const DASH_URL = (process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "").replace(/\/$/, "");

/**
 * Récupère une table Grist via le proxy N8N dashboard.
 * N8N vérifie le HMAC et l'expiration (24 h) avant de proxyer vers Grist.
 * Répond 401/403 si le token est invalide ou expiré → TokenExpiredError.
 */
async function dashFetchTable(
  token: string,
  tableId: string,
): Promise<{ rows: GristRow[]; columns: string[] }> {
  if (!DASH_URL) throw new Error("NEXT_PUBLIC_DASHBOARD_URL non configuré");
  const url = `${DASH_URL}?table=${encodeURIComponent(tableId)}&token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) throw new TokenExpiredError();
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

const NUM_W  = 50;   // px — largeur de la colonne de numéro de ligne
const COL_W  = 160;  // px — largeur de chaque colonne de données
const ROW_H  = 36;   // px — hauteur fixe de chaque ligne (doit être constante pour la virtualisation)
const BUFFER = 6;    // lignes rendues en avance au-delà du viewport (évite le flash lors du scroll rapide)

const COL_MIN = 40; // px — largeur minimum après resize

function VirtualTable({
  columns, rows, sortState, onSort, hiddenColumns,
}: {
  columns: string[];
  rows: GristRow[];
  sortState: { col: string; dir: "asc" | "desc" } | null;
  onSort: (col: string) => void;
  hiddenColumns?: string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH,     setViewH]     = useState(600);
  /** Largeurs personnalisées par nom de colonne (COL_W par défaut si absent) */
  const [colWidths, setColWidths] = useState<Record<string, number>>({});

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

  // Reset scroll quand les lignes changent (filtre appliqué)
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [rows]);

  const displayCols = columns.filter(c => !(hiddenColumns ?? []).includes(c));

  /** Largeur effective d'une colonne (personnalisée ou valeur par défaut) */
  function getW(col: string) { return colWidths[col] ?? COL_W; }

  /**
   * Démarre le redimensionnement d'une colonne par glisser-déposer.
   * Attach les listeners sur document pour capturer le mouvement hors de la cellule.
   */
  function startResize(e: React.MouseEvent, col: string) {
    e.preventDefault();
    e.stopPropagation(); // empêche le clic de trier la colonne
    const startX = e.clientX;
    const startW = getW(col);
    document.body.style.cursor    = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      setColWidths(prev => ({ ...prev, [col]: Math.max(COL_MIN, startW + ev.clientX - startX) }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
      document.body.style.cursor    = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  }

  const totalW   = NUM_W + displayCols.reduce((s, c) => s + getW(c), 0);
  const totalH   = rows.length * ROW_H;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
  const endIdx   = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + BUFFER);

  return (
    <div className="db-vtable" ref={containerRef}>
      {/* Wrapper pour le scroll horizontal */}
      <div style={{ minWidth: totalW }}>

        {/* Header — sticky vertical, suit le scroll horizontal */}
        <div className="db-header-row" style={{ width: totalW }}>
          <div className="db-cell db-cell--num">#</div>
          {displayCols.map(col => (
            <div
              key={col}
              className={`db-cell db-cell--head${sortState?.col === col ? " db-cell--sorted" : ""}`}
              style={{ width: getW(col), minWidth: getW(col), position: "relative" }}
              onClick={() => onSort(col)}
              title={col}
            >
              <span className="db-cell-txt">{col}</span>
              <span className="db-sort-icon">
                {sortState?.col === col ? (sortState.dir === "asc" ? "↑" : "↓") : "⇅"}
              </span>
              {/* Poignée de resize — thin strip sur le bord droit */}
              <span className="db-col-resize" onMouseDown={e => startResize(e, col)} />
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
                {displayCols.map(col => {
                  const val = row[col];
                  return (
                    <div
                      key={col}
                      className="db-cell"
                      style={{ width: getW(col), minWidth: getW(col) }}
                      title={fmt(val)}
                    >
                      <span className="db-cell-txt">{renderCell(val)}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}

// ─── Filter dropdown (wrapper SearchDropdown → string values) ─────────────────

const RESET_OPT_ID = 0;

function FilterDropdown({
  stringOptions, value, label, onChange,
}: {
  stringOptions: string[];
  value: string;
  label: string;
  onChange: (val: string) => void;
}) {
  const sdOptions: Option[] = useMemo(
    () => [
      { id: RESET_OPT_ID, label: `Tous` },
      ...stringOptions.map((o, i) => ({ id: i + 1, label: o })),
    ],
    [stringOptions],
  );

  const valueId: number | null = useMemo(() => {
    if (!value) return null;
    const idx = stringOptions.indexOf(value);
    return idx >= 0 ? idx + 1 : null;
  }, [value, stringOptions]);

  return (
    <div style={{ flex: "1 1 160px", maxWidth: 220 }}>
      <SearchDropdown
        options={sdOptions}
        valueId={valueId}
        onChange={id => {
          if (id === null || id === RESET_OPT_ID) onChange("");
          else onChange(sdOptions.find(o => o.id === id)?.label ?? "");
        }}
        placeholder={`${label} — tous`}
        searchable={stringOptions.length > 6}
      />
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({
  tab, tableRows, filters, onChange,
}: {
  tab: TabDef;
  tableRows: GristRow[];    // lignes déjà résolues (Refs → valeurs lisibles)
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
          <FilterDropdown
            key={f.key}
            stringOptions={dropdownOpts[f.key] ?? []}
            value={filters[f.key] ?? ""}
            label={f.label ?? f.key}
            onChange={val => onChange(f.key, val)}
          />
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

// ─── Écrans d'erreur token ────────────────────────────────────────────────────

function TokenScreen({ status }: { status: "missing" | "expired" }) {
  return (
    <div className="db-page">
      <header className="db-header">
        <span className="db-header__title">📊 Dashboard EMILE</span>
      </header>
      <div className="db-state db-state--error">
        {status === "missing" ? (
          <>
            <strong>🔒 Accès refusé</strong>
            <span>Lien d&apos;accès manquant. Contactez l&apos;administrateur pour obtenir un lien valide.</span>
          </>
        ) : (
          <>
            <strong>⏱ Lien expiré</strong>
            <span>Ce lien n&apos;est plus valide (durée de vie : 24 h). Contactez l&apos;administrateur pour en obtenir un nouveau.</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const EMPTY_TABLE: TableState = { rows: [], columns: [], loading: false, error: "" };

export default function AccederDashboard() {
  const [tokenStatus,   setTokenStatus]   = useState<TokenStatus>("resolving");
  const [token,         setToken]         = useState("");
  const [activeTab,     setActiveTab]     = useState(TABS[0].id);
  const [tableData,     setTableData]     = useState<Record<string, TableState>>(
    () => Object.fromEntries(TABS.map(t => [t.id, { ...EMPTY_TABLE }]))
  );
  const [filterStates, setFilterStates] = useState<Record<string, Record<string, string>>>(
    () => Object.fromEntries(TABS.map(t => [t.id, {}]))
  );
  const [sortStates, setSortStates] = useState<Record<string, { col: string; dir: "asc" | "desc" } | null>>(
    () => Object.fromEntries(TABS.map(t => [t.id, null]))
  );
  /** Incrémenté par handleRefresh() pour forcer un nouveau fetch de l'onglet actif. */
  const [fetchKey, setFetchKey] = useState(0);

  /**
   * Maps de résolution Ref : clé = "TABLEID::displayCol", valeur = Map<rowId → displayValue>.
   * Peuplées en arrière-plan quand un onglet avec refLookups est chargé.
   */
  const [refMaps, setRefMaps] = useState<Record<string, Map<number, string>>>({});

  /**
   * Ensemble des onglets dont le fetch principal est déjà en cours ou terminé.
   * Empêche le double-fetch causé par React StrictMode (double-mount en dev).
   * On supprime l'onglet de loadedRef en cas d'erreur pour permettre un retry.
   */
  const loadedRef        = useRef<Set<string>>(new Set());
  /**
   * Ensemble des tables Ref déjà chargées ou en cours de chargement.
   * Clé : "TABLEID::displayCol" — même format que refMaps.
   */
  const loadedRefTablesRef = useRef<Set<string>>(new Set());

  // ── Résolution du token (exécuté une seule fois côté client) ─────────────
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const urlToken = p.get("token");
    if (urlToken) {
      // Token dans l'URL : on le persiste en sessionStorage et on nettoie l'URL
      sessionStorage.setItem(SS_KEY, urlToken);
      window.history.replaceState(null, "", window.location.pathname);
      setToken(urlToken);
      setTokenStatus("ok");
    } else {
      const ssToken = sessionStorage.getItem(SS_KEY);
      if (ssToken) {
        setToken(ssToken);
        setTokenStatus("ok");
      } else {
        setTokenStatus("missing");
      }
    }
  }, []);

  // ── Fetch de la table active ─────────────────────────────────────────────
  useEffect(() => {
    if (tokenStatus !== "ok" || !token) return;
    const tab = TABS.find(t => t.id === activeTab)!;
    if (loadedRef.current.has(activeTab)) return;
    loadedRef.current.add(activeTab);

    setTableData(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], loading: true, error: "" } }));
    dashFetchTable(token, tab.tableId)
      .then(({ rows, columns }) => {
        setTableData(prev => ({ ...prev, [activeTab]: { rows, columns, loading: false, error: "" } }));
      })
      .catch((err: unknown) => {
        loadedRef.current.delete(activeTab);
        if (err instanceof TokenExpiredError) {
          sessionStorage.removeItem(SS_KEY);
          setTokenStatus("expired");
          return;
        }
        setTableData(prev => ({
          ...prev,
          [activeTab]: { ...prev[activeTab], loading: false, error: String(err) },
        }));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, token, tokenStatus, fetchKey]);

  // ── Chargement des tables Ref (refLookups) ────────────────────────────────
  // Se déclenche dès que la table principale de l'onglet actif est chargée.
  // Chaque table Ref est chargée une seule fois (loadedRefTablesRef).
  const activeRows = tableData[activeTab]?.rows;
  useEffect(() => {
    if (tokenStatus !== "ok" || !token) return;
    const tab = TABS.find(t => t.id === activeTab)!;
    if (!tab.refLookups) return;
    if (!activeRows?.length) return; // attend que la table principale soit disponible

    for (const [, { tableId, displayCol }] of Object.entries(tab.refLookups)) {
      const key = `${tableId}::${displayCol}`;
      if (loadedRefTablesRef.current.has(key)) continue;
      loadedRefTablesRef.current.add(key);

      dashFetchTable(token, tableId)
        .then(({ rows: refRows }) => {
          const map = new Map<number, string>();
          for (const r of refRows) map.set(r.id, String(r[displayCol] ?? ""));
          setRefMaps(prev => ({ ...prev, [key]: map }));
        })
        .catch(() => {
          // En cas d'erreur, on retire la clé pour permettre un retry au prochain rendu
          loadedRefTablesRef.current.delete(key);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, token, tokenStatus, activeRows]);

  function handleRefresh() {
    if (!token) return;
    const tab = TABS.find(t => t.id === activeTab)!;
    loadedRef.current.delete(activeTab);
    // Réinitialise aussi les refMaps de cet onglet pour forcer un rechargement
    if (tab.refLookups) {
      for (const [, { tableId, displayCol }] of Object.entries(tab.refLookups)) {
        loadedRefTablesRef.current.delete(`${tableId}::${displayCol}`);
      }
    }
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

  // ── Données dérivées de l'onglet actif ──────────────────────────────────
  const tabDef   = TABS.find(t => t.id === activeTab)!;
  const tabState = tableData[activeTab];
  const filters  = filterStates[activeTab] ?? {};
  const sort     = sortStates[activeTab] ?? null;

  /**
   * Lignes avec les colonnes Ref résolues (entiers → valeurs lisibles).
   * Recalculé quand les rows changent OU quand de nouvelles refMaps arrivent.
   */
  const resolvedRows = useMemo(
    () => resolveRefs(tabState.rows, tabDef, refMaps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabState.rows, tabDef, refMaps],
  );

  const filteredRows = useMemo(() => {
    let rows = resolvedRows;
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
  }, [resolvedRows, tabState.columns, tabDef, filters, sort]);

  // ── Écrans d'erreur token ────────────────────────────────────────────────
  if (tokenStatus === "resolving") {
    return (
      <div className="db-page">
        <header className="db-header">
          <span className="db-header__title">📊 Dashboard EMILE</span>
        </header>
        <div className="db-state db-state--loading">
          <span className="db-spinner" /> Chargement…
        </div>
      </div>
    );
  }

  if (tokenStatus === "missing" || tokenStatus === "expired") {
    return <TokenScreen status={tokenStatus} />;
  }

  // ── Rendu principal ──────────────────────────────────────────────────────
  return (
    <div className="db-page">

      <header className="db-header">
        <span className="db-header__title">📊 Dashboard EMILE</span>
      </header>

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
        {tabState.loading ? (
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
              tableRows={resolvedRows}
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
              hiddenColumns={tabDef.hiddenColumns}
            />
          </>
        )}
      </main>

    </div>
  );
}
