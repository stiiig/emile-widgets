"use client";

/**
 * airtable-to-grist — Convertisseur CSV Airtable → CSV Grist
 *
 * Page statique côté client (aucun serveur).
 * Deux onglets :
 *  1. Accompagnants  — convertit la table Airtable ACCOMPAGNANTS
 *  2. Candidats      — convertit la table Airtable CANDIDATS
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
  convertAccompagnants,
  convertCandidats,
} from "./convert";

type TableType = "accompagnants" | "candidats";

interface ConvResult {
  fileName: string;
  rowCount: number;
  headers: string[];
  preview: Record<string, string>[];
  csvBlob: string;
}

export default function AirtableToGristPage() {
  const [tab,           setTab]           = useState<TableType>("accompagnants");
  const [accResult,     setAccResult]     = useState<ConvResult | null>(null);
  const [candResult,    setCandResult]    = useState<ConvResult | null>(null);
  const [accError,      setAccError]      = useState("");
  const [candError,     setCandError]     = useState("");

  const accInputRef  = useRef<HTMLInputElement>(null);
  const candInputRef = useRef<HTMLInputElement>(null);

  function handleFile(type: TableType, file: File) {
    const setError  = type === "accompagnants" ? setAccError  : setCandError;
    const setResult = type === "accompagnants" ? setAccResult : setCandResult;

    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const rows = parseCSV(text);
        if (rows.length === 0) { setError("Le fichier semble vide ou mal formaté."); return; }

        const { headers, rows: converted } =
          type === "accompagnants"
            ? convertAccompagnants(rows)
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

  const result = tab === "accompagnants" ? accResult  : candResult;
  const error  = tab === "accompagnants" ? accError   : candError;
  const ref    = tab === "accompagnants" ? accInputRef : candInputRef;

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
        {(["accompagnants", "candidats"] as TableType[]).map((t, i) => (
          <button
            key={t}
            className={`atg-tab${tab === t ? " atg-tab--active" : ""}`}
            onClick={() => setTab(t)}
          >
            {i + 1}. {t.charAt(0).toUpperCase() + t.slice(1)}
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
