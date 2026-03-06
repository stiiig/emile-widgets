"use client";

/**
 * airtable-to-grist — Convertisseur CSV Airtable → CSV Grist
 *
 * Page statique côté client (aucun serveur).
 * Trois onglets :
 *  1. Établissements — convertit la table Airtable ETABLISSEMENTS
 *  2. Accompagnants  — convertit la table Airtable ACCOMPAGNANTS
 *  3. Candidats      — convertit la table Airtable CANDIDATS
 *
 * Usage :
 *  1. Exporter la table Airtable en CSV (UTF-8)
 *  2. Uploader ici → aperçu des 5 premières lignes
 *  3. Optionnel : cocher « Échantillon aléatoire » pour ne garder que 30 lignes
 *  4. Télécharger le CSV Grist prêt à l'import
 */

import { useRef, useState } from "react";
import "./styles.css";
import {
  parseCSV,
  toCSV,
  convertEtablissements,
  convertAccompagnants,
  convertCandidats,
} from "./convert";

type TableType = "etablissements" | "accompagnants" | "candidats";

const TABS: { key: TableType; label: string }[] = [
  { key: "candidats",      label: "Candidats"       },
  { key: "accompagnants",  label: "Accompagnants"  },
  { key: "etablissements", label: "Établissements" },
];

const SAMPLE_N = 30;

interface ConvResult {
  fileName: string;
  rowCount: number;
  headers: string[];
  preview: Record<string, string>[];
  csvBlob: string;
}

/** Données brutes conservées pour re-convertir si l'option échantillon change */
interface RawData {
  rows: Record<string, string>[];
  fileName: string;
}

/** Fisher-Yates — retourne n lignes tirées au hasard sans remise */
function sampleRows(rows: Record<string, string>[], n: number): Record<string, string>[] {
  if (rows.length <= n) return rows;
  const arr = [...rows];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

export default function AirtableToGristPage() {
  const [tab, setTab] = useState<TableType>("candidats");
  const [sampleMode, setSampleMode] = useState(false);

  // Résultats de conversion par onglet
  const [etabResult, setEtabResult] = useState<ConvResult | null>(null);
  const [accResult,  setAccResult]  = useState<ConvResult | null>(null);
  const [candResult, setCandResult] = useState<ConvResult | null>(null);

  // Messages d'erreur par onglet
  const [etabError, setEtabError] = useState("");
  const [accError,  setAccError]  = useState("");
  const [candError, setCandError] = useState("");

  // Données brutes conservées pour re-appliquer l'échantillonnage sans ré-upload
  const [etabRaw, setEtabRaw] = useState<RawData | null>(null);
  const [accRaw,  setAccRaw]  = useState<RawData | null>(null);
  const [candRaw, setCandRaw] = useState<RawData | null>(null);

  const etabInputRef = useRef<HTMLInputElement>(null);
  const accInputRef  = useRef<HTMLInputElement>(null);
  const candInputRef = useRef<HTMLInputElement>(null);

  // ── Conversion ──────────────────────────────────────────────────────────────

  function processAndSetResult(
    type: TableType,
    rawRows: Record<string, string>[],
    sample: boolean,
    fileName: string,
  ) {
    const setError  = type === "etablissements" ? setEtabError  : type === "accompagnants" ? setAccError  : setCandError;
    const setResult = type === "etablissements" ? setEtabResult : type === "accompagnants" ? setAccResult : setCandResult;

    try {
      // L'échantillonnage s'applique uniquement à Accompagnants et Candidats
      const inputRows = (sample && type !== "etablissements")
        ? sampleRows(rawRows, SAMPLE_N)
        : rawRows;

      const { headers, rows: converted } =
        type === "etablissements" ? convertEtablissements(inputRows)
        : type === "accompagnants" ? convertAccompagnants(inputRows)
        : convertCandidats(inputRows);

      setResult({
        fileName,
        rowCount: converted.length,
        headers,
        preview: converted.slice(0, 5),
        csvBlob: "\ufeff" + toCSV(converted, headers), // BOM UTF-8 pour Excel
      });
      setError("");
    } catch (err: any) {
      setError("Erreur de conversion : " + (err?.message ?? String(err)));
      setResult(null);
    }
  }

  function handleFile(type: TableType, file: File) {
    const setError = type === "etablissements" ? setEtabError : type === "accompagnants" ? setAccError : setCandError;
    const setRaw   = type === "etablissements" ? setEtabRaw   : type === "accompagnants" ? setAccRaw   : setCandRaw;

    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const rows = parseCSV(text);
        if (rows.length === 0) { setError("Le fichier semble vide ou mal formaté."); return; }
        setRaw({ rows, fileName: file.name });
        processAndSetResult(type, rows, sampleMode, file.name);
      } catch (err: any) {
        setError("Erreur de conversion : " + (err?.message ?? String(err)));
      }
    };
    reader.onerror = () => setError("Impossible de lire le fichier.");
    reader.readAsText(file, "utf-8");
  }

  /** Quand la checkbox change → re-convertir avec les données déjà chargées */
  function handleSampleChange(checked: boolean) {
    setSampleMode(checked);
    const raw = tab === "etablissements" ? etabRaw : tab === "accompagnants" ? accRaw : candRaw;
    if (raw) processAndSetResult(tab, raw.rows, checked, raw.fileName);
  }

  function download(result: ConvResult, type: TableType) {
    const blob = new Blob([result.csvBlob], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `grist_${type}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Valeurs dérivées de l'onglet actif ──────────────────────────────────────

  const result = tab === "etablissements" ? etabResult : tab === "accompagnants" ? accResult : candResult;
  const error  = tab === "etablissements" ? etabError  : tab === "accompagnants" ? accError  : candError;
  const ref    = tab === "etablissements" ? etabInputRef : tab === "accompagnants" ? accInputRef : candInputRef;

  return (
    <div className="atg-page">

      {/* ── En-tête ── */}
      <header className="atg-header">
        <h1 className="atg-header__title">Convertisseur Airtable → Grist</h1>
        <p  className="atg-header__sub">
          Importez un export CSV Airtable, téléchargez un CSV prêt pour Grist
        </p>
      </header>

      {/* ── Onglets ── */}
      <nav className="atg-tabs">
        {TABS.map(({ key, label }, i) => (
          <button
            key={key}
            className={`atg-tab${tab === key ? " atg-tab--active" : ""}`}
            onClick={() => setTab(key)}
          >
            {i + 1}. {label}
          </button>
        ))}
      </nav>

      {/* ── Corps ── */}
      <main className="atg-main">

        {/* Option échantillon — Accompagnants et Candidats seulement */}
        {tab !== "etablissements" && (
          <label className="atg-sample">
            <input
              type="checkbox"
              checked={sampleMode}
              onChange={e => handleSampleChange(e.target.checked)}
            />
            Échantillon aléatoire de {SAMPLE_N} lignes
            <span className="atg-sample__hint">(utile pour tester l'import dans Grist)</span>
          </label>
        )}

        {/* Zone de dépôt */}
        <div
          className={`atg-drop${result ? " atg-drop--done" : ""}`}
          onClick={() => ref.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) handleFile(tab, f);
          }}
        >
          <input
            ref={ref}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(tab, f); }}
          />
          <span className="atg-drop__icon">{result ? "✅" : "📂"}</span>
          {result ? (
            <span>
              <strong>{result.fileName}</strong>
              <em> — {result.rowCount} ligne{result.rowCount > 1 ? "s" : ""} converties</em>
              <span className="atg-drop__hint"> · cliquer pour changer de fichier</span>
            </span>
          ) : (
            <span>
              Glissez votre CSV Airtable ici ou{" "}
              <u>cliquez pour choisir</u>
            </span>
          )}
        </div>

        {/* Erreur */}
        {error && <p className="atg-error">{error}</p>}

        {/* Aperçu + téléchargement */}
        {result && (
          <>
            <section className="atg-preview">
              <h2 className="atg-preview__title">
                Aperçu — 5 premières lignes
                <span className="atg-preview__count">
                  {result.headers.length} colonnes Grist
                </span>
              </h2>
              <div className="atg-table-wrap">
                <table className="atg-table">
                  <thead>
                    <tr>{result.headers.map(h => <th key={h}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {result.preview.map((row, i) => (
                      <tr key={i}>
                        {result.headers.map(h => (
                          <td key={h} title={row[h] ?? ""}>{row[h] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <button
              className="atg-btn-download"
              onClick={() => download(result, tab)}
            >
              ⬇ Télécharger le CSV Grist
            </button>
          </>
        )}
      </main>
    </div>
  );
}
