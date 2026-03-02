"use client";

/**
 * FAQPanel — Panneau FAQ latéral partagé entre tous les widgets EMILE.
 *
 * Supporte deux sources de données :
 *  - `docApi`   : mode Grist iframe — fetchTable("FAQ"), format colonnaire
 *  - `proxyUrl` : mode standalone   — GET {proxyUrl}?table=FAQ, format REST records
 *
 * Le panneau s'affiche en overlay depuis la droite (portal sur document.body).
 */

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";

// ── Types ──────────────────────────────────────────────────────────────────

export type FAQItem = {
  id: number;
  titre: string;
  contenu: string;
  section: string;
  obligatoire: string;
};

export interface FAQPanelProps {
  onClose: () => void;
  /** Mode Grist iframe : objet docApi exposant fetchTable() */
  docApi?: { fetchTable: (table: string) => Promise<any> } | null;
  /** Mode standalone : URL du proxy n8n (GET ?table=FAQ) */
  proxyUrl?: string;
}

// ── Composant ──────────────────────────────────────────────────────────────

export function FAQPanel({ docApi, proxyUrl, onClose }: FAQPanelProps) {
  const [items,        setItems]        = useState<FAQItem[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState("");
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [expandedIds,  setExpandedIds]  = useState<Set<number>>(new Set());

  useEffect(() => {
    if (docApi) {
      // ── Mode Grist iframe ── format colonnaire : { id[], Titre[], ... }
      docApi.fetchTable("FAQ")
        .then((table: any) => {
          const ids  = table.id as number[];
          const next: FAQItem[] = [];
          for (let i = 0; i < ids.length; i++) {
            const titre = String(table["Titre"]?.[i] ?? "").trim();
            if (!titre) continue;
            next.push({
              id:          ids[i],
              titre,
              contenu:     String(table["Contenu"]?.[i] ?? "").trim(),
              section:     String(table["Section_de_la_question"]?.[i] ?? "Général").trim() || "Général",
              obligatoire: String(table["Obligatoire_ou_non"]?.[i] ?? "").trim(),
            });
          }
          setItems(next);
          setOpenSections(new Set(next.map((x) => x.section)));
        })
        .catch(() => {})
        .finally(() => setLoading(false));

    } else if (proxyUrl) {
      // ── Mode standalone ── format REST : { records: [{ id, fields: { Titre, ... } }] }
      fetch(`${proxyUrl.replace(/\/$/, "")}?table=FAQ`)
        .then((r) => r.json())
        .then((data) => {
          const records: any[] = data?.records ?? [];
          const next: FAQItem[] = records
            .map((r: any) => ({
              id:          r.id as number,
              titre:       String(r.fields?.Titre ?? "").trim(),
              contenu:     String(r.fields?.Contenu ?? "").trim(),
              section:     String(r.fields?.Section_de_la_question ?? "Général").trim() || "Général",
              obligatoire: String(r.fields?.Obligatoire_ou_non ?? "").trim(),
            }))
            .filter((x) => x.titre);
          setItems(next);
          setOpenSections(new Set(next.map((x) => x.section)));
        })
        .catch(() => {})
        .finally(() => setLoading(false));

    } else {
      setLoading(false);
    }
  }, [docApi, proxyUrl]);

  // ── Filtrage & groupement ──────────────────────────────────────────────

  const q        = search.trim().toLowerCase();
  const filtered = q
    ? items.filter((x) =>
        x.titre.toLowerCase().includes(q) ||
        x.contenu.toLowerCase().includes(q) ||
        x.section.toLowerCase().includes(q)
      )
    : items;

  const grouped = useMemo(() => {
    const map = new Map<string, FAQItem[]>();
    for (const item of filtered) {
      if (!map.has(item.section)) map.set(item.section, []);
      map.get(item.section)!.push(item);
    }
    return map;
  }, [filtered]);

  // ── Handlers ──────────────────────────────────────────────────────────

  function toggleSection(s: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }
  function toggleItem(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  const isObligatoire = (v: string) =>
    v.toLowerCase().includes("oui") || v.toLowerCase().includes("obligatoire");

  // ── Rendu ──────────────────────────────────────────────────────────────

  return createPortal(
    /* overlay */
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(0,0,0,0.28)", display: "flex", justifyContent: "flex-end" }}
    >
      {/* panneau latéral */}
      <div style={{ width: 400, maxWidth: "100vw", background: "#fff", display: "flex", flexDirection: "column", boxShadow: "-4px 0 28px rgba(0,0,0,0.18)", height: "100%" }}>

        {/* ── En-tête bleu ── */}
        <div style={{ background: "#000091", color: "#fff", padding: "0 1.2rem", height: "3rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
            <i className="fa-solid fa-circle-question" style={{ fontSize: "1rem" }} />
            <span style={{ fontWeight: 700, fontSize: "0.95rem", letterSpacing: "0.02em" }}>FAQ EMILE</span>
            {!loading && (
              <span style={{ fontSize: "0.7rem", opacity: 0.75, background: "rgba(255,255,255,0.18)", borderRadius: 99, padding: "0.1rem 0.5rem" }}>
                {items.length} fiche{items.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <button type="button" onClick={onClose}
            style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: "1.15rem", padding: "0.2rem", display: "flex", alignItems: "center", lineHeight: 1 }}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* ── Barre de recherche ── */}
        <div style={{ padding: "0.65rem 1rem", borderBottom: "1px solid #eee", flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <i className="fa-solid fa-magnifying-glass" style={{ position: "absolute", left: "0.6rem", top: "50%", transform: "translateY(-50%)", color: "#bbb", fontSize: "0.78rem", pointerEvents: "none" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une fiche…"
              autoFocus
              style={{ width: "100%", boxSizing: "border-box", padding: "0.42rem 0.6rem 0.42rem 2rem", border: "1px solid #d0d0d0", borderRadius: 6, fontSize: "0.83rem", fontFamily: "Marianne, arial, sans-serif", outline: "none" }}
            />
          </div>
        </div>

        {/* ── Contenu scrollable ── */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: "3rem", textAlign: "center", color: "#bbb" }}>
              <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "1.2rem" }} />
            </div>
          ) : grouped.size === 0 ? (
            <div style={{ padding: "2.5rem 1rem", textAlign: "center", color: "#999", fontSize: "0.85rem" }}>
              {q ? <>Aucun résultat pour <b>« {search} »</b></> : "Aucune fiche disponible."}
            </div>
          ) : (
            Array.from(grouped.entries()).map(([section, secItems]) => (
              <div key={section}>

                {/* En-tête de section */}
                <button type="button" onClick={() => toggleSection(section)}
                  style={{ width: "100%", textAlign: "left", padding: "0.55rem 1rem", background: "#f4f4f8", border: 0, borderBottom: "1px solid #e5e5f0", borderTop: "1px solid #e5e5f0", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontFamily: "Marianne, arial, sans-serif" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "#000091" }}>
                    {section}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span style={{ fontSize: "0.68rem", color: "#888", background: "#e8e8f0", borderRadius: 99, padding: "0.1rem 0.4rem", fontWeight: 600 }}>
                      {secItems.length}
                    </span>
                    <i className={`fa-solid fa-chevron-${openSections.has(section) ? "up" : "down"}`} style={{ fontSize: "0.68rem", color: "#888" }} />
                  </span>
                </button>

                {/* Items de la section */}
                {openSections.has(section) && secItems.map((item) => {
                  const expanded = expandedIds.has(item.id);
                  const oblig    = isObligatoire(item.obligatoire);
                  return (
                    <div key={item.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <button type="button" onClick={() => toggleItem(item.id)}
                        style={{ width: "100%", textAlign: "left", padding: "0.65rem 1rem", background: expanded ? "#f6f6ff" : "#fff", border: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem", cursor: "pointer", fontFamily: "Marianne, arial, sans-serif", transition: "background 0.1s" }}>
                        <span style={{ display: "flex", flexDirection: "column", gap: "0.28rem", flex: 1 }}>
                          <span style={{ fontWeight: 600, fontSize: "0.84rem", color: "#1e1e1e", lineHeight: 1.4 }}>
                            {item.titre}
                          </span>
                          {item.obligatoire && (
                            <span style={{ display: "inline-flex", alignSelf: "flex-start", fontSize: "0.62rem", fontWeight: 700, padding: "0.1rem 0.45rem", borderRadius: 3, background: oblig ? "#fef2f2" : "#f3f4f6", color: oblig ? "#dc2626" : "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                              {oblig ? "● Obligatoire" : `○ ${item.obligatoire}`}
                            </span>
                          )}
                        </span>
                        <i className={`fa-solid fa-chevron-${expanded ? "up" : "down"}`} style={{ fontSize: "0.68rem", color: "#aaa", marginTop: "0.3rem", flexShrink: 0 }} />
                      </button>

                      {expanded && item.contenu && (
                        <div style={{ padding: "0.5rem 1rem 0.9rem 1rem", background: "#f6f6ff", fontSize: "0.82rem", lineHeight: 1.65, color: "#333", whiteSpace: "pre-wrap", borderTop: "1px solid #eeeeff" }}>
                          {item.contenu}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

      </div>
    </div>,
    document.body
  );
}
