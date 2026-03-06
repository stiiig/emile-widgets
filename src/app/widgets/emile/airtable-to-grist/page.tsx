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
 *  3. Télécharger le CSV Grist prêt à l'import
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
  { key: "etablissements", label: "Établissements" },
  { key: "accompagnants",  label: "Accompagnants"  },
  { key: "candidats",      label: "Candidats"       },
];

interface ConvResult {
  fileName: string;
  rowCount: number;
  headers: string[];
  preview: Record<string, string>[];
  csvBlob: string;
}

export default function AirtableToGristPage() {
  const [tab, setTab] = useState<TableType>("etablissements");

  const [etabResult,  setEtabResult]  = useState<ConvResult | null>(null);
  const [accResult,   setAccResult]   = useState<ConvResult | null>(null);
  const [candResult,  setCandResult]  = useState<ConvResult | null>(null);
  const [etabError,   setEtabError]   = useState("");
  const [accError,    setAccError]    = useState("");
  const [candError,   setCandError]   = useState("");

  const etabInputRef = useRef<HTMLInputElement>(null);
  const accInputRef  = useRef<HTMLInputElement>(null);
  const candInputRef = useRef<HTMLInputElement>(null);

  function handleFile(type: TableType, file: File) {
    const setError  = type === "etablissements" ? setEtabError
                    : type === "accompagnants"  ? setAccError
                    : setCandError;
    const setResult = type === "etablissements" ? setEtabResult
                    : type === "accompagnants"  ? setAccResult
                    : setCandResult;

    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const rows = parseCSV(text);
        if (rows.length === 0) { setError("Le fichier semble vide ou mal formaté."); return; }

        const { headers, rows: converted } =
          type === "etablissements" ? convertEtablissements(rows)
          : type === "accompagnants" ? convertAccompagnants(rows)
          : convertCandidats(rows);

        setResult({
          fileName: file.name,
          rowCount: converted.length,
          headers,
          preview: converted.slice(0, 5),
          csvBlob: "\ufeff" + toCSV(converted, headers), // BOM UTF-8 pour Excel
        });
      } catch (err: any) {
        setError("Erreur de conversion : " + (err?.message ?? String(err)));
      }
    };
    reader.onerror = () => setError("Impossible de lire le fichier.");
    reader.readAsText(file, "utf-8");
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

  const result = tab === "etablissements" ? etabResult
               : tab === "accompagnants"  ? accResult
               : candResult;
  const error  = tab === "etablissements" ? etabError
               : tab === "accompagnants"  ? accError
               : candError;
  const ref    = tab === "etablissements" ? etabInputRef
               : tab === "accompagnants"  ? accInputRef
               : candInputRef;

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
