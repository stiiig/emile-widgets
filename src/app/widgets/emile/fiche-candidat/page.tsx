"use client";

import "./styles.css";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import logoEmile from "../assets/logo-emile-white.png";
import { useGristInit } from "@/lib/grist/hooks";
import { fetchSingleRowRest } from "@/lib/grist/rest";
import {
  loadColumnsMetaFor,
  buildColRowIdMap,
  ensureRefCache,
  decodeListCell,
  encodeListCell,
  unixSecondsToISODate,
  isoDateToUnixSeconds,
  isEditable,
  ColMeta,
  GristDocAPI,
} from "@/lib/grist/meta";
import { SearchDropdown, SearchMultiDropdown, Option } from "@/components/SearchDropdown";
import { AttachmentField } from "@/components/AttachmentField";
import { EMILE_TABS, L1TabKey } from "@/lib/emile/tabs";
import { FIELD_MAP } from "@/lib/emile/fieldmap";

const TABLE_ID = "CANDIDATS";

type Row = { id: number; [k: string]: any };

function fullName(r: Row) {
  const prenom = (r["Prenom"] ?? "").toString().trim();
  const nom = (r["Nom_de_famille"] ?? "").toString().trim();
  return `${prenom} ${nom}`.trim();
}

function candidateHint(r: Row) {
  return (r["ID2"] ?? "").toString().trim();
}

function computeAge(dateIso: string): number | null {
  if (!dateIso) return null;
  const birth = new Date(dateIso);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 0 ? age : null;
}

/* 2A → 20.1, 2B → 20.2  (Corse entre 19 et 21) */
function deptSortKey(numero: string | undefined): number {
  if (!numero) return 9999;
  const n = numero.toUpperCase();
  if (n === "2A") return 20.1;
  if (n === "2B") return 20.2;
  const p = parseFloat(n);
  return isNaN(p) ? 9999 : p;
}

function StatusAlert({ status }: { status: string }) {
  if (!status) return null;
  const isError = status.toLowerCase().includes("erreur") || status.toLowerCase().includes("error");
  const isSuccess = status.includes("✅") || status.toLowerCase().includes("enregistr");
  const cls = isError
    ? "fr-alert fr-alert--error"
    : isSuccess
    ? "fr-alert fr-alert--success"
    : "fr-alert fr-alert--info";
  return (
    <div className={cls} style={{ marginTop: 10 }}>
      <p className="fr-alert__title">{isError ? "Erreur" : isSuccess ? "Succès" : "Info"}</p>
      <p>{status.replace("Erreur:", "").trim()}</p>
    </div>
  );
}

/* ─── Style inline bouton actif (override DSFR) ─────── */
const OUINON_ACTIVE: React.CSSProperties = {
  background: "#000091", borderColor: "#000091", color: "#fff",
};

/* ─── InfoPopover (portal → jamais coupé par overflow) ── */
function InfoPopover({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef  = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function calcPos() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
  }

  return (
    <span
      ref={rootRef}
      onMouseLeave={() => setOpen(false)}
      style={{ display: "inline-flex", verticalAlign: "middle", marginLeft: "0.35rem" }}
    >
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={() => { calcPos(); setOpen(true); }}
        onClick={(e) => { e.preventDefault(); if (!open) { calcPos(); setOpen(true); } else setOpen(false); }}
        style={{ background: "none", border: "none", cursor: "pointer", color: "#000091", fontSize: "0.85rem", padding: "0 0.1rem", display: "inline-flex", alignItems: "center", lineHeight: 1 }}
      >
        <i className="fa-solid fa-circle-info" aria-hidden="true" />
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div style={{
          position: "fixed", zIndex: 9999, top: pos.top, left: pos.left,
          width: "22rem", maxWidth: "calc(100vw - 2rem)",
          background: "#fff", border: "1px solid #c8c8e8", borderRadius: 6,
          boxShadow: "0 6px 20px rgba(0,0,145,.12)",
          padding: "0.75rem 1rem",
          fontSize: "0.82rem", lineHeight: 1.55, color: "#1e1e1e", fontWeight: 400,
          whiteSpace: "normal",
        }}>
          {children}
        </div>,
        document.body
      )}
    </span>
  );
}

/* ─── FieldLabel avec info popover optionnel ─────────── */
function FieldLabel({ col, disabled }: { col: ColMeta; disabled: boolean }) {
  return (
    <div className={`emile-field__label${disabled ? " emile-field__label--readonly" : ""}`}>
      {col.label}
      {col.description && <InfoPopover>{col.description}</InfoPopover>}
    </div>
  );
}

/* ─── Styles partagés dropdowns custom ───────────────── */
const SD_TRIGGER: React.CSSProperties = {
  width: "100%", textAlign: "left", height: "1.875rem",
  padding: "0 1.75rem 0 0.5rem", borderRadius: 4,
  border: "1px solid #d0d0d0", background: "#f9f9f9",
  cursor: "pointer", fontSize: "0.82rem",
  fontFamily: "Marianne, arial, sans-serif", color: "#1e1e1e",
  position: "relative", display: "flex", alignItems: "center",
  boxSizing: "border-box", whiteSpace: "nowrap",
  overflow: "hidden", textOverflow: "ellipsis",
};
const SD_TRIGGER_DISABLED: React.CSSProperties = {
  ...SD_TRIGGER, background: "#f3f3f3", color: "#999",
  border: "1px solid #e5e5e5", cursor: "default",
};
const SD_PANEL: React.CSSProperties = {
  position: "absolute", zIndex: 500, top: "calc(100% + 3px)", left: 0,
  minWidth: "100%", border: "1px solid #c8c8e8", borderRadius: 6,
  background: "#fff", boxShadow: "0 6px 20px rgba(0,0,145,.1)", overflow: "hidden",
};
const SD_SEARCH: React.CSSProperties = {
  width: "100%", padding: "0.3rem 0.5rem", border: "none",
  borderBottom: "1px solid #eee", fontSize: "0.8rem",
  fontFamily: "Marianne, arial, sans-serif", outline: "none",
  boxSizing: "border-box",
};

/* ─── Nationalité ─────────────────────────────────────── */
type PaysOption = Option & { typeNationalite: string };

const PINNED_PAYS = [
  "France",
  "Afghanistan", "Algérie", "Cameroun",
  "Congo (la République démocratique du)", "Côte d'Ivoire",
  "Guinée", "Haïti", "Maroc", "Sénégal", "Tunisie",
];

const TYPE_TAG: Record<string, { bg: string; color: string }> = {
  "France":           { bg: "#dbeafe", color: "#1d4ed8" },
  "UE (hors France)": { bg: "#dcfce7", color: "#166534" },
  "Extra-UE":         { bg: "#fef3c7", color: "#92400e" },
};

function NationaliteSpecialField({ value, onChange, disabled, docApi, col }: {
  value: number | null; onChange: (id: number | null) => void;
  disabled: boolean; docApi: GristDocAPI; col: ColMeta;
}) {
  const [options, setOptions] = useState<PaysOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLoading(true);
    docApi.fetchTable("PAYS").then((table: any) => {
      const ids = table.id as number[];
      const opts: PaysOption[] = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const label = String(table["Nom_du_pays"]?.[i] ?? "").trim();
        if (!label) continue;
        const typeNat = String(table["Type_de_nationalite"]?.[i] ?? "").trim();
        opts.push({ id, label, q: label.toLowerCase(), typeNationalite: typeNat });
      }
      opts.sort((a, b) => a.label.localeCompare(b.label, "fr"));
      setOptions(opts);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [docApi]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) { setOpen(false); setQ(""); }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selected = value != null ? options.find((o) => o.id === value) ?? null : null;
  const pinnedOptions = useMemo(() =>
    PINNED_PAYS.map((name) => options.find((o) => o.label === name)).filter((o): o is PaysOption => !!o),
    [options]);
  const pinnedIds = useMemo(() => new Set(pinnedOptions.map((o) => o.id)), [pinnedOptions]);
  const otherOptions = useMemo(() => options.filter((o) => !pinnedIds.has(o.id)), [options, pinnedIds]);
  const qq = q.trim().toLowerCase();
  const filteredPinned = qq ? pinnedOptions.filter((o) => (o.q ?? o.label).toLowerCase().includes(qq)) : pinnedOptions;
  const filteredOther = qq
    ? otherOptions.filter((o) => (o.q ?? o.label).toLowerCase().includes(qq)).slice(0, 80)
    : otherOptions.slice(0, 80);

  function renderOption(o: PaysOption) {
    const tag = TYPE_TAG[o.typeNationalite];
    const isSelected = value === o.id;
    return (
      <button
        key={o.id} type="button"
        onClick={() => { if (!disabled) { onChange(o.id); setOpen(false); setQ(""); } }}
        onMouseEnter={() => setHoveredId(o.id)}
        onMouseLeave={() => setHoveredId(null)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", textAlign: "left", padding: "0.35rem 0.6rem",
          border: 0, borderBottom: "1px solid #f5f5f5",
          background: isSelected ? "#f0f0ff" : hoveredId === o.id ? "#f5f5ff" : "white",
          cursor: disabled ? "default" : "pointer", fontSize: "0.82rem",
          fontFamily: "Marianne, arial, sans-serif", color: "#1e1e1e", fontWeight: isSelected ? 700 : 400,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
        {o.typeNationalite && (
          <span style={{
            fontSize: "0.62rem", fontWeight: 700, padding: "0.1rem 0.35rem", borderRadius: 3,
            marginLeft: "0.5rem", flexShrink: 0,
            background: tag?.bg ?? "#f3f4f6", color: tag?.color ?? "#555", whiteSpace: "nowrap",
          }}>{o.typeNationalite}</span>
        )}
      </button>
    );
  }

  return (
    <div className="emile-field">
      <FieldLabel col={col} disabled={disabled} />
      <div ref={rootRef} style={{ position: "relative" }}>
        <button
          type="button"
          style={disabled || (loading && options.length === 0) ? SD_TRIGGER_DISABLED : SD_TRIGGER}
          onClick={() => { if (!disabled && !(loading && options.length === 0)) setOpen((v) => !v); }}
        >
          {selected
            ? <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{selected.label}</span>
            : <span style={{ opacity: 0.5 }}>{loading && options.length === 0 ? "Chargement…" : "—"}</span>}
          <span style={{ position: "absolute", right: "0.4rem", top: "50%", transform: "translateY(-50%)", fontSize: "0.65rem", color: "#888", pointerEvents: "none" }}>▾</span>
        </button>
        {open && !disabled && (
          <div style={SD_PANEL}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un pays…" style={SD_SEARCH} autoFocus />
            <div style={{ maxHeight: 280, overflowY: "auto" }}>
              {filteredPinned.map(renderOption)}
              {filteredPinned.length > 0 && filteredOther.length > 0 && (
                <div style={{ padding: "0.2rem 0.6rem", fontSize: "0.7rem", fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em", background: "#f9f9f9", borderBottom: "1px solid #eee" }}>Autres pays</div>
              )}
              {filteredOther.map(renderOption)}
              {filteredPinned.length === 0 && filteredOther.length === 0 && (
                <div style={{ padding: "0.5rem 0.6rem", fontSize: "0.8rem", color: "#999" }}>Aucun résultat.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Département domicile ────────────────────────────── */
function DeptSpecialField({ value, onChange, disabled, docApi, col }: {
  value: number | null; onChange: (id: number | null) => void;
  disabled: boolean; docApi: GristDocAPI; col: ColMeta;
}) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    docApi.fetchTable("DPTS_REGIONS").then((table: any) => {
      const ids = table.id as number[];
      const opts: Option[] = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const label = String(table["Nom_departement"]?.[i] ?? "").trim();
        if (!label) continue;
        if (table["Territoire_depart"]?.[i] !== "Oui") continue;
        const numero = String(table["Numero"]?.[i] ?? "").trim() || undefined;
        const region = String(table["Nom_region"]?.[i] ?? "").trim() || undefined;
        opts.push({ id, label, q: `${numero ?? ""} ${label}`.toLowerCase(), tagLeft: numero, tag: region });
      }
      opts.sort((a, b) => deptSortKey(a.tagLeft) - deptSortKey(b.tagLeft));
      setOptions(opts);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [docApi]);

  return (
    <div className="emile-field">
      <FieldLabel col={col} disabled={disabled} />
      <SearchDropdown
        options={options}
        valueId={value}
        onChange={onChange}
        placeholder={loading && options.length === 0 ? "Chargement…" : "—"}
        disabled={disabled || (loading && options.length === 0)}
        searchable
      />
    </div>
  );
}

/* ─── FAQ Panel ───────────────────────────────────────── */
type FAQItem = {
  id: number;
  titre: string;
  contenu: string;
  section: string;
  obligatoire: string;
};

function FAQPanel({ docApi, onClose }: { docApi: GristDocAPI; onClose: () => void }) {
  const [items, setItems]         = useState<FAQItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds]   = useState<Set<number>>(new Set());

  useEffect(() => {
    docApi.fetchTable("FAQ").then((table: any) => {
      const ids = table.id as number[];
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
    }).catch(() => {}).finally(() => setLoading(false));
  }, [docApi]);

  const q = search.trim().toLowerCase();
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

  return createPortal(
    /* overlay */
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(0,0,0,0.28)", display: "flex", justifyContent: "flex-end" }}
    >
      {/* panneau */}
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

/* ─── Téléphone ───────────────────────────────────────── */
const DIAL_CODES: { flag: string; name: string; code: string }[] = [
  { flag: "🇫🇷", name: "France",                          code: "+33"  },
  { flag: "🇦🇫", name: "Afghanistan",                     code: "+93"  },
  { flag: "🇿🇦", name: "Afrique du Sud",                  code: "+27"  },
  { flag: "🇦🇱", name: "Albanie",                         code: "+355" },
  { flag: "🇩🇿", name: "Algérie",                         code: "+213" },
  { flag: "🇩🇪", name: "Allemagne",                       code: "+49"  },
  { flag: "🇦🇩", name: "Andorre",                         code: "+376" },
  { flag: "🇦🇴", name: "Angola",                          code: "+244" },
  { flag: "🇦🇬", name: "Antigua-et-Barbuda",              code: "+1"   },
  { flag: "🇸🇦", name: "Arabie saoudite",                 code: "+966" },
  { flag: "🇦🇷", name: "Argentine",                       code: "+54"  },
  { flag: "🇦🇲", name: "Arménie",                         code: "+374" },
  { flag: "🇦🇺", name: "Australie",                       code: "+61"  },
  { flag: "🇦🇹", name: "Autriche",                        code: "+43"  },
  { flag: "🇦🇿", name: "Azerbaïdjan",                     code: "+994" },
  { flag: "🇧🇸", name: "Bahamas",                         code: "+1"   },
  { flag: "🇧🇭", name: "Bahreïn",                         code: "+973" },
  { flag: "🇧🇩", name: "Bangladesh",                      code: "+880" },
  { flag: "🇧🇧", name: "Barbade",                         code: "+1"   },
  { flag: "🇧🇾", name: "Bélarus",                         code: "+375" },
  { flag: "🇧🇪", name: "Belgique",                        code: "+32"  },
  { flag: "🇧🇿", name: "Belize",                          code: "+501" },
  { flag: "🇧🇯", name: "Bénin",                           code: "+229" },
  { flag: "🇧🇹", name: "Bhoutan",                         code: "+975" },
  { flag: "🇧🇴", name: "Bolivie",                         code: "+591" },
  { flag: "🇧🇦", name: "Bosnie-Herzégovine",              code: "+387" },
  { flag: "🇧🇼", name: "Botswana",                        code: "+267" },
  { flag: "🇧🇷", name: "Brésil",                          code: "+55"  },
  { flag: "🇧🇳", name: "Brunéi",                          code: "+673" },
  { flag: "🇧🇬", name: "Bulgarie",                        code: "+359" },
  { flag: "🇧🇫", name: "Burkina Faso",                    code: "+226" },
  { flag: "🇧🇮", name: "Burundi",                         code: "+257" },
  { flag: "🇨🇻", name: "Cabo Verde",                      code: "+238" },
  { flag: "🇰🇭", name: "Cambodge",                        code: "+855" },
  { flag: "🇨🇲", name: "Cameroun",                        code: "+237" },
  { flag: "🇨🇦", name: "Canada",                          code: "+1"   },
  { flag: "🇨🇫", name: "Centrafrique",                    code: "+236" },
  { flag: "🇨🇱", name: "Chili",                           code: "+56"  },
  { flag: "🇨🇳", name: "Chine",                           code: "+86"  },
  { flag: "🇨🇾", name: "Chypre",                          code: "+357" },
  { flag: "🇨🇴", name: "Colombie",                        code: "+57"  },
  { flag: "🇰🇲", name: "Comores",                         code: "+269" },
  { flag: "🇨🇬", name: "Congo",                           code: "+242" },
  { flag: "🇨🇩", name: "Congo (RDC)",                     code: "+243" },
  { flag: "🇰🇵", name: "Corée du Nord",                   code: "+850" },
  { flag: "🇰🇷", name: "Corée du Sud",                    code: "+82"  },
  { flag: "🇨🇷", name: "Costa Rica",                      code: "+506" },
  { flag: "🇨🇮", name: "Côte d'Ivoire",                   code: "+225" },
  { flag: "🇭🇷", name: "Croatie",                         code: "+385" },
  { flag: "🇨🇺", name: "Cuba",                            code: "+53"  },
  { flag: "🇩🇰", name: "Danemark",                        code: "+45"  },
  { flag: "🇩🇯", name: "Djibouti",                        code: "+253" },
  { flag: "🇩🇲", name: "Dominique",                       code: "+1"   },
  { flag: "🇪🇬", name: "Égypte",                          code: "+20"  },
  { flag: "🇦🇪", name: "Émirats arabes unis",             code: "+971" },
  { flag: "🇪🇨", name: "Équateur",                        code: "+593" },
  { flag: "🇪🇷", name: "Érythrée",                        code: "+291" },
  { flag: "🇪🇸", name: "Espagne",                         code: "+34"  },
  { flag: "🇸🇿", name: "Eswatini",                        code: "+268" },
  { flag: "🇪🇪", name: "Estonie",                         code: "+372" },
  { flag: "🇺🇸", name: "États-Unis",                      code: "+1"   },
  { flag: "🇪🇹", name: "Éthiopie",                        code: "+251" },
  { flag: "🇫🇯", name: "Fidji",                           code: "+679" },
  { flag: "🇫🇮", name: "Finlande",                        code: "+358" },
  { flag: "🇬🇦", name: "Gabon",                           code: "+241" },
  { flag: "🇬🇲", name: "Gambie",                          code: "+220" },
  { flag: "🇬🇪", name: "Géorgie",                         code: "+995" },
  { flag: "🇬🇭", name: "Ghana",                           code: "+233" },
  { flag: "🇬🇷", name: "Grèce",                           code: "+30"  },
  { flag: "🇬🇩", name: "Grenade",                         code: "+1"   },
  { flag: "🇬🇹", name: "Guatemala",                       code: "+502" },
  { flag: "🇬🇳", name: "Guinée",                          code: "+224" },
  { flag: "🇬🇼", name: "Guinée-Bissau",                   code: "+245" },
  { flag: "🇬🇶", name: "Guinée équatoriale",              code: "+240" },
  { flag: "🇬🇾", name: "Guyana",                          code: "+592" },
  { flag: "🇭🇹", name: "Haïti",                           code: "+509" },
  { flag: "🇭🇳", name: "Honduras",                        code: "+504" },
  { flag: "🇭🇺", name: "Hongrie",                         code: "+36"  },
  { flag: "🇮🇳", name: "Inde",                            code: "+91"  },
  { flag: "🇮🇩", name: "Indonésie",                       code: "+62"  },
  { flag: "🇮🇶", name: "Irak",                            code: "+964" },
  { flag: "🇮🇷", name: "Iran",                            code: "+98"  },
  { flag: "🇮🇪", name: "Irlande",                         code: "+353" },
  { flag: "🇮🇸", name: "Islande",                         code: "+354" },
  { flag: "🇮🇱", name: "Israël",                          code: "+972" },
  { flag: "🇮🇹", name: "Italie",                          code: "+39"  },
  { flag: "🇯🇲", name: "Jamaïque",                        code: "+1"   },
  { flag: "🇯🇵", name: "Japon",                           code: "+81"  },
  { flag: "🇯🇴", name: "Jordanie",                        code: "+962" },
  { flag: "🇰🇿", name: "Kazakhstan",                      code: "+7"   },
  { flag: "🇰🇪", name: "Kenya",                           code: "+254" },
  { flag: "🇰🇬", name: "Kirghizistan",                    code: "+996" },
  { flag: "🇰🇮", name: "Kiribati",                        code: "+686" },
  { flag: "🇽🇰", name: "Kosovo",                          code: "+383" },
  { flag: "🇰🇼", name: "Koweït",                          code: "+965" },
  { flag: "🇱🇦", name: "Laos",                            code: "+856" },
  { flag: "🇱🇸", name: "Lesotho",                         code: "+266" },
  { flag: "🇱🇻", name: "Lettonie",                        code: "+371" },
  { flag: "🇱🇧", name: "Liban",                           code: "+961" },
  { flag: "🇱🇷", name: "Libéria",                         code: "+231" },
  { flag: "🇱🇾", name: "Libye",                           code: "+218" },
  { flag: "🇱🇮", name: "Liechtenstein",                   code: "+423" },
  { flag: "🇱🇹", name: "Lituanie",                        code: "+370" },
  { flag: "🇱🇺", name: "Luxembourg",                      code: "+352" },
  { flag: "🇲🇰", name: "Macédoine du Nord",               code: "+389" },
  { flag: "🇲🇬", name: "Madagascar",                      code: "+261" },
  { flag: "🇲🇾", name: "Malaisie",                        code: "+60"  },
  { flag: "🇲🇼", name: "Malawi",                          code: "+265" },
  { flag: "🇲🇻", name: "Maldives",                        code: "+960" },
  { flag: "🇲🇱", name: "Mali",                            code: "+223" },
  { flag: "🇲🇹", name: "Malte",                           code: "+356" },
  { flag: "🇲🇦", name: "Maroc",                           code: "+212" },
  { flag: "🇲🇭", name: "Marshall",                        code: "+692" },
  { flag: "🇲🇺", name: "Maurice",                         code: "+230" },
  { flag: "🇲🇷", name: "Mauritanie",                      code: "+222" },
  { flag: "🇲🇽", name: "Mexique",                         code: "+52"  },
  { flag: "🇫🇲", name: "Micronésie",                      code: "+691" },
  { flag: "🇲🇩", name: "Moldavie",                        code: "+373" },
  { flag: "🇲🇨", name: "Monaco",                          code: "+377" },
  { flag: "🇲🇳", name: "Mongolie",                        code: "+976" },
  { flag: "🇲🇪", name: "Monténégro",                      code: "+382" },
  { flag: "🇲🇿", name: "Mozambique",                      code: "+258" },
  { flag: "🇲🇲", name: "Myanmar",                         code: "+95"  },
  { flag: "🇳🇦", name: "Namibie",                         code: "+264" },
  { flag: "🇳🇷", name: "Nauru",                           code: "+674" },
  { flag: "🇳🇵", name: "Népal",                           code: "+977" },
  { flag: "🇳🇮", name: "Nicaragua",                       code: "+505" },
  { flag: "🇳🇪", name: "Niger",                           code: "+227" },
  { flag: "🇳🇬", name: "Nigéria",                         code: "+234" },
  { flag: "🇳🇴", name: "Norvège",                         code: "+47"  },
  { flag: "🇳🇿", name: "Nouvelle-Zélande",                code: "+64"  },
  { flag: "🇴🇲", name: "Oman",                            code: "+968" },
  { flag: "🇺🇬", name: "Ouganda",                         code: "+256" },
  { flag: "🇺🇿", name: "Ouzbékistan",                     code: "+998" },
  { flag: "🇵🇰", name: "Pakistan",                        code: "+92"  },
  { flag: "🇵🇼", name: "Palaos",                          code: "+680" },
  { flag: "🇵🇸", name: "Palestine",                       code: "+970" },
  { flag: "🇵🇦", name: "Panama",                          code: "+507" },
  { flag: "🇵🇬", name: "Papouasie-Nouvelle-Guinée",       code: "+675" },
  { flag: "🇵🇾", name: "Paraguay",                        code: "+595" },
  { flag: "🇳🇱", name: "Pays-Bas",                        code: "+31"  },
  { flag: "🇵🇪", name: "Pérou",                           code: "+51"  },
  { flag: "🇵🇭", name: "Philippines",                     code: "+63"  },
  { flag: "🇵🇱", name: "Pologne",                         code: "+48"  },
  { flag: "🇵🇹", name: "Portugal",                        code: "+351" },
  { flag: "🇶🇦", name: "Qatar",                           code: "+974" },
  { flag: "🇩🇴", name: "République dominicaine",          code: "+1"   },
  { flag: "🇨🇿", name: "République tchèque",              code: "+420" },
  { flag: "🇷🇴", name: "Roumanie",                        code: "+40"  },
  { flag: "🇬🇧", name: "Royaume-Uni",                     code: "+44"  },
  { flag: "🇷🇺", name: "Russie",                          code: "+7"   },
  { flag: "🇷🇼", name: "Rwanda",                          code: "+250" },
  { flag: "🇰🇳", name: "Saint-Christophe-et-Niévès",     code: "+1"   },
  { flag: "🇸🇲", name: "Saint-Marin",                     code: "+378" },
  { flag: "🇻🇨", name: "Saint-Vincent-et-les-Grenadines", code: "+1"   },
  { flag: "🇱🇨", name: "Sainte-Lucie",                    code: "+1"   },
  { flag: "🇸🇧", name: "Salomon",                         code: "+677" },
  { flag: "🇸🇻", name: "Salvador",                        code: "+503" },
  { flag: "🇼🇸", name: "Samoa",                           code: "+685" },
  { flag: "🇸🇹", name: "São Tomé-et-Príncipe",            code: "+239" },
  { flag: "🇸🇳", name: "Sénégal",                         code: "+221" },
  { flag: "🇷🇸", name: "Serbie",                          code: "+381" },
  { flag: "🇸🇨", name: "Seychelles",                      code: "+248" },
  { flag: "🇸🇱", name: "Sierra Leone",                    code: "+232" },
  { flag: "🇸🇬", name: "Singapour",                       code: "+65"  },
  { flag: "🇸🇰", name: "Slovaquie",                       code: "+421" },
  { flag: "🇸🇮", name: "Slovénie",                        code: "+386" },
  { flag: "🇸🇴", name: "Somalie",                         code: "+252" },
  { flag: "🇸🇩", name: "Soudan",                          code: "+249" },
  { flag: "🇸🇸", name: "Soudan du Sud",                   code: "+211" },
  { flag: "🇱🇰", name: "Sri Lanka",                       code: "+94"  },
  { flag: "🇸🇪", name: "Suède",                           code: "+46"  },
  { flag: "🇨🇭", name: "Suisse",                          code: "+41"  },
  { flag: "🇸🇷", name: "Suriname",                        code: "+597" },
  { flag: "🇸🇾", name: "Syrie",                           code: "+963" },
  { flag: "🇹🇼", name: "Taïwan",                          code: "+886" },
  { flag: "🇹🇯", name: "Tadjikistan",                     code: "+992" },
  { flag: "🇹🇿", name: "Tanzanie",                        code: "+255" },
  { flag: "🇹🇩", name: "Tchad",                           code: "+235" },
  { flag: "🇹🇭", name: "Thaïlande",                       code: "+66"  },
  { flag: "🇹🇱", name: "Timor oriental",                  code: "+670" },
  { flag: "🇹🇬", name: "Togo",                            code: "+228" },
  { flag: "🇹🇴", name: "Tonga",                           code: "+676" },
  { flag: "🇹🇹", name: "Trinité-et-Tobago",               code: "+1"   },
  { flag: "🇹🇳", name: "Tunisie",                         code: "+216" },
  { flag: "🇹🇲", name: "Turkménistan",                    code: "+993" },
  { flag: "🇹🇷", name: "Turquie",                         code: "+90"  },
  { flag: "🇹🇻", name: "Tuvalu",                          code: "+688" },
  { flag: "🇺🇦", name: "Ukraine",                         code: "+380" },
  { flag: "🇺🇾", name: "Uruguay",                         code: "+598" },
  { flag: "🇻🇺", name: "Vanuatu",                         code: "+678" },
  { flag: "🇻🇦", name: "Vatican",                         code: "+379" },
  { flag: "🇻🇪", name: "Venezuela",                       code: "+58"  },
  { flag: "🇻🇳", name: "Viêt Nam",                        code: "+84"  },
  { flag: "🇾🇪", name: "Yémen",                           code: "+967" },
  { flag: "🇿🇲", name: "Zambie",                          code: "+260" },
  { flag: "🇿🇼", name: "Zimbabwe",                        code: "+263" },
];

function TelSpecialField({ value, onChange, disabled, col }: {
  value: string; onChange: (v: string) => void; disabled: boolean; col: ColMeta;
}) {
  function parseTel(v: string): { codeName: string; number: string } {
    if (!v) return { codeName: "France", number: "" };
    const trimmed = String(v).trim();
    const sorted = [...DIAL_CODES].sort((a, b) => b.code.length - a.code.length);
    for (const d of sorted) {
      if (trimmed.startsWith(d.code + " ")) return { codeName: d.name, number: trimmed.slice(d.code.length + 1) };
    }
    return { codeName: "France", number: trimmed };
  }

  const [telCode, setTelCode] = useState(() => parseTel(value).codeName);
  const [telNum, setTelNum]   = useState(() => parseTel(value).number);

  useEffect(() => {
    const p = parseTel(value);
    setTelCode(p.codeName);
    setTelNum(p.number);
  }, [value]);

  const [open, setOpen]               = useState(false);
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const [dialSearch, setDialSearch]   = useState("");
  const rootRef                       = useRef<HTMLDivElement | null>(null);

  const selected = DIAL_CODES.find((d) => d.name === telCode) ?? DIAL_CODES[0];

  const filteredDial = useMemo(() => {
    const q = dialSearch.trim().toLowerCase();
    if (!q) return DIAL_CODES;
    return DIAL_CODES.filter((d) => d.name.toLowerCase().includes(q) || d.code.includes(q));
  }, [dialSearch]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) { setOpen(false); setDialSearch(""); }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function update(code: string, num: string) {
    const dialCode = DIAL_CODES.find((d) => d.name === code)?.code ?? "";
    onChange(dialCode ? `${dialCode} ${num}`.trim() : num);
  }

  return (
    <div className="emile-field">
      <FieldLabel col={col} disabled={disabled} />
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <div ref={rootRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => !disabled && setOpen((v) => !v)}
            style={{ height: "1.875rem", padding: "0 0.5rem", border: "1px solid #c1c1c1", borderRadius: 4, background: disabled ? "#f3f3f3" : "#f8f8f8", cursor: disabled ? "default" : "pointer", fontFamily: "inherit", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.3rem", whiteSpace: "nowrap" }}
          >
            <span style={{ fontSize: "1.1rem" }}>{selected.flag}</span>
            <span style={{ color: "#444", fontSize: "0.8rem", fontWeight: 600 }}>{selected.code}</span>
            <span style={{ fontSize: "0.6rem", color: "#888" }}>▾</span>
          </button>
          {open && (
            <div style={{ position: "absolute", zIndex: 500, top: "calc(100% + 3px)", left: 0, width: "16rem", border: "1px solid #c8c8e8", borderRadius: 6, background: "#fff", boxShadow: "0 6px 20px rgba(0,0,145,.1)" }}>
              <input value={dialSearch} onChange={(e) => setDialSearch(e.target.value)} placeholder="Rechercher un pays…" style={SD_SEARCH} autoFocus />
              <div style={{ maxHeight: 240, overflowY: "auto" }}>
                {filteredDial.map((d) => (
                  <button
                    key={d.name} type="button"
                    onMouseEnter={() => setHoveredName(d.name)}
                    onMouseLeave={() => setHoveredName(null)}
                    onClick={() => { setTelCode(d.name); update(d.name, telNum); setOpen(false); setDialSearch(""); }}
                    style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", padding: "0.35rem 0.6rem", border: 0, borderBottom: "1px solid #f5f5f5", background: d.name === telCode ? "#f0f0ff" : hoveredName === d.name ? "#f5f5ff" : "white", cursor: "pointer", fontSize: "0.82rem", fontFamily: "inherit", textAlign: "left", fontWeight: d.name === telCode ? 700 : 400 }}
                  >
                    <span style={{ fontSize: "1.1rem" }}>{d.flag}</span>
                    <span style={{ flex: 1 }}>{d.name}</span>
                    <span style={{ color: "#888", fontSize: "0.78rem" }}>{d.code}</span>
                  </button>
                ))}
                {filteredDial.length === 0 && <div style={{ padding: "0.5rem 0.6rem", fontSize: "0.8rem", color: "#999" }}>Aucun résultat.</div>}
              </div>
            </div>
          )}
        </div>
        <input
          className="emile-input"
          type="tel"
          value={telNum}
          onChange={(e) => { setTelNum(e.target.value); update(telCode, e.target.value); }}
          disabled={disabled}
          style={{ flex: 1 }}
        />
      </div>
    </div>
  );
}

/* ─── Date (3 dropdowns — générique + naissance) ─────── */
const MONTHS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const MAX_BIRTH_YEAR = new Date().getFullYear() - 15;
const MIN_BIRTH_YEAR = new Date().getFullYear() - 100;
const BIRTH_YEARS = Array.from({ length: MAX_BIRTH_YEAR - MIN_BIRTH_YEAR + 1 }, (_, i) => MAX_BIRTH_YEAR - i);

const THIS_YEAR = new Date().getFullYear();
const GENERIC_YEARS = Array.from({ length: THIS_YEAR + 5 - 1900 + 1 }, (_, i) => THIS_YEAR + 5 - i);

function GenericDateField({ value, onChange, disabled, col }: {
  value: number | null; onChange: (v: number | null) => void;
  disabled: boolean; col: ColMeta;
}) {
  const isoFromUnix = (v: number | null) => (v ? unixSecondsToISODate(v) : "");

  const [selY, setSelY] = useState(() => { const p = isoFromUnix(value).split("-"); return p[0] ?? ""; });
  const [selM, setSelM] = useState(() => { const p = isoFromUnix(value).split("-"); return p[1] ?? ""; });
  const [selD, setSelD] = useState(() => { const p = isoFromUnix(value).split("-"); return p[2] ?? ""; });

  useEffect(() => {
    const iso = isoFromUnix(value);
    const p = iso ? iso.split("-") : ["", "", ""];
    setSelY(p[0] ?? ""); setSelM(p[1] ?? ""); setSelD(p[2] ?? "");
  }, [value]);

  function commit(y: string, m: string, d: string) {
    if (y && m && d) {
      const maxDay = new Date(parseInt(y), parseInt(m), 0).getDate();
      const clampedDay = Math.min(parseInt(d), maxDay);
      const iso = `${y}-${m}-${String(clampedDay).padStart(2, "0")}`;
      onChange(isoDateToUnixSeconds(iso) ?? null);
    } else {
      onChange(null);
    }
  }

  const daysInMonth = selY && selM ? new Date(parseInt(selY), parseInt(selM), 0).getDate() : 31;
  const dayOptions   = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => ({ id: i + 1, label: String(i + 1) })), [daysInMonth]);
  const monthOptions = useMemo(() => MONTHS_FR.map((name, i) => ({ id: i + 1, label: name })), []);
  const yearOptions  = useMemo(() => GENERIC_YEARS.map((y) => ({ id: y, label: String(y) })), []);

  const dayId   = selD ? parseInt(selD, 10) : null;
  const monthId = selM ? parseInt(selM, 10) : null;
  const yearId  = selY ? parseInt(selY, 10) : null;

  return (
    <div className="emile-field">
      <FieldLabel col={col} disabled={disabled} />
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <div style={{ flex: "1 1 0%" }}>
          <SearchDropdown options={dayOptions} valueId={dayId}
            onChange={(id) => { if (!id) return; const d = String(id).padStart(2, "0"); setSelD(d); commit(selY, selM, d); }}
            placeholder="Jour" searchable={true} disabled={disabled} />
        </div>
        <div style={{ flex: "1 1 0%" }}>
          <SearchDropdown options={monthOptions} valueId={monthId}
            onChange={(id) => { if (!id) return; const m = String(id).padStart(2, "0"); setSelM(m); commit(selY, m, selD); }}
            placeholder="Mois" searchable={true} disabled={disabled} />
        </div>
        <div style={{ flex: "1 1 0%" }}>
          <SearchDropdown options={yearOptions} valueId={yearId}
            onChange={(id) => { if (!id) return; const y = String(id); setSelY(y); commit(y, selM, selD); }}
            placeholder="Année" searchable={true} disabled={disabled} />
        </div>
      </div>
    </div>
  );
}

function DateNaissanceSpecialField({ value, onChange, disabled, col, genreValue }: {
  value: number | null; onChange: (v: number | null) => void;
  disabled: boolean; col: ColMeta; genreValue?: string;
}) {
  const isoFromUnix = (v: number | null) => (v ? unixSecondsToISODate(v) : "");

  const [selY, setSelY] = useState(() => { const p = isoFromUnix(value).split("-"); return p[0] ?? ""; });
  const [selM, setSelM] = useState(() => { const p = isoFromUnix(value).split("-"); return p[1] ?? ""; });
  const [selD, setSelD] = useState(() => { const p = isoFromUnix(value).split("-"); return p[2] ?? ""; });

  useEffect(() => {
    const iso = isoFromUnix(value);
    const p = iso ? iso.split("-") : ["", "", ""];
    setSelY(p[0] ?? ""); setSelM(p[1] ?? ""); setSelD(p[2] ?? "");
  }, [value]);

  function commit(y: string, m: string, d: string) {
    if (y && m && d) {
      const maxDay = new Date(parseInt(y), parseInt(m), 0).getDate();
      const clampedDay = Math.min(parseInt(d), maxDay);
      const iso = `${y}-${m}-${String(clampedDay).padStart(2, "0")}`;
      onChange(isoDateToUnixSeconds(iso) ?? null);
    } else {
      onChange(null);
    }
  }

  const daysInMonth = selY && selM ? new Date(parseInt(selY), parseInt(selM), 0).getDate() : 31;
  const dayOptions   = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => ({ id: i + 1, label: String(i + 1) })), [daysInMonth]);
  const monthOptions = useMemo(() => MONTHS_FR.map((name, i) => ({ id: i + 1, label: name })), []);
  const yearOptions  = useMemo(() => BIRTH_YEARS.map((y) => ({ id: y, label: String(y) })), []);

  const dayId   = selD ? parseInt(selD, 10) : null;
  const monthId = selM ? parseInt(selM, 10) : null;
  const yearId  = selY ? parseInt(selY, 10) : null;

  const age = computeAge(isoFromUnix(value));

  return (
    <div className="emile-field">
      <FieldLabel col={col} disabled={disabled} />
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <div style={{ flex: "1 1 0%" }}>
          <SearchDropdown options={dayOptions} valueId={dayId}
            onChange={(id) => { if (!id) return; const d = String(id).padStart(2, "0"); setSelD(d); commit(selY, selM, d); }}
            placeholder="Jour" searchable={true} disabled={disabled} />
        </div>
        <div style={{ flex: "1 1 0%" }}>
          <SearchDropdown options={monthOptions} valueId={monthId}
            onChange={(id) => { if (!id) return; const m = String(id).padStart(2, "0"); setSelM(m); commit(selY, m, selD); }}
            placeholder="Mois" searchable={true} disabled={disabled} />
        </div>
        <div style={{ flex: "1 1 0%" }}>
          <SearchDropdown options={yearOptions} valueId={yearId}
            onChange={(id) => { if (!id) return; const y = String(id); setSelY(y); commit(y, selM, selD); }}
            placeholder="Année" searchable={true} disabled={disabled} />
        </div>
      </div>
      {age !== null && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.45rem", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", padding: "0.3rem 0.85rem", borderRadius: 99, fontSize: "0.85rem", fontWeight: 700, background: "#e8eeff", color: "#000091" }}>
            {age} ans
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", padding: "0.3rem 0.85rem", borderRadius: 99, fontSize: "0.85rem", fontWeight: 700, background: age >= 18 ? "#d1fae5" : "#fef3c7", color: age >= 18 ? "#065f46" : "#92400e" }}>
            {age >= 18
              ? (genreValue === "Femme" ? "Majeure ✓" : genreValue === "Homme" ? "Majeur ✓" : "Majeur·e ✓")
              : (genreValue === "Femme" ? "Mineure"   : genreValue === "Homme" ? "Mineur"   : "Mineur·e")}
          </span>
        </div>
      )}
    </div>
  );
}

/* =====================================================
   Page principale
   ===================================================== */

export default function Page() {
  const { mode, docApi } = useGristInit({ requiredAccess: "full" });

  // ── Magic link : ?token=rowId.HMAC (prod) ou ?rowId=123 (dev fallback) ──
  // ── Mode orienteur  : ?token=<OCC>&id=<candidatRowId> ──────────────────
  const [rowIdFromUrl,        setRowIdFromUrl]        = useState<number | null>(null);
  const [tokenFromUrl,        setTokenFromUrl]        = useState<string | null>(null);
  const [isOrienteurMode,     setIsOrienteurMode]     = useState(false);
  const [candidatRowIdFromUrl,setCandidatRowIdFromUrl]= useState<number | null>(null);
  const [occTokenForOrienteur,setOccTokenForOrienteur]= useState<string | null>(null);
  const [orienteurListUrl,    setOrienteurListUrl]    = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p     = new URLSearchParams(window.location.search);
    const token = p.get("token");
    const id    = p.get("id");

    if (token && id) {
      // Mode orienteur : ?token=<OCC>&id=<candidatRowId>
      const candidatId = parseInt(id, 10);
      if (!isNaN(candidatId)) {
        setIsOrienteurMode(true);
        setOccTokenForOrienteur(token);
        setCandidatRowIdFromUrl(candidatId);
        // URL de retour vers la liste de l'orienteur
        const listBase = window.location.href
          .split("?")[0]
          .replace(/\/fiche-candidat\/?$/, "/liste-candidats");
        setOrienteurListUrl(`${listBase}?token=${token}`);
      }
    } else if (token) {
      // Mode candidat : ?token=rowId.HMAC
      const rowId = parseInt(token.split(".")[0], 10);
      if (!isNaN(rowId)) {
        setTokenFromUrl(token);
        setRowIdFromUrl(rowId);
      }
    } else {
      // Fallback dev : ?rowId=123 sans signature
      const v = p.get("rowId");
      if (v) setRowIdFromUrl(parseInt(v, 10));
    }
  }, []);

  const [cols, setCols] = useState<ColMeta[]>([]);
  const colById = useMemo(() => new Map(cols.map((c) => [c.colId, c])), [cols]);
  const [colRowIdMap, setColRowIdMap] = useState<Map<number, { colId: string }>>(new Map());

  const [selected, setSelected] = useState<Row | null>(null);
  const selectedName = selected ? fullName(selected) : "";
  const selectedHint = selected ? candidateHint(selected) : "";

  const [draft, setDraft] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [loadingRest, setLoadingRest] = useState(false);
  const [showFaq, setShowFaq] = useState(false);

  const [activeTab, setActiveTab] = useState<L1TabKey>(EMILE_TABS[0].key);
  const activeTabObj = useMemo(() => EMILE_TABS.find((t) => t.key === activeTab) ?? EMILE_TABS[0], [activeTab]);

  const [activeSubtab, setActiveSubtab] = useState<string>(activeTabObj.subtabs[0].key);
  useEffect(() => {
    const first = activeTabObj.subtabs?.[0]?.key;
    if (first) setActiveSubtab(first);
  }, [activeTabObj]);

  const [candidateOptions, setCandidateOptions] = useState<Option[]>([]);
  const [candidateIdByRowId, setCandidateIdByRowId] = useState<Map<number, number>>(new Map());
  const [rowIdByCandidateId, setRowIdByCandidateId] = useState<Map<number, number>>(new Map());
  const [candidateValueId, setCandidateValueId] = useState<number | null>(null);

  // Liste des candidats de l'orienteur — pour le switcher dans la barre de navigation
  type CandidatSummary = { id: number; prenom: string; nom: string; reference?: string | null };
  const [allCandidats, setAllCandidats] = useState<CandidatSummary[]>([]);
  useEffect(() => {
    if (!isOrienteurMode || !occTokenForOrienteur) return;
    const listUrl = process.env.NEXT_PUBLIC_OCC_LIST_URL;
    if (!listUrl) return;
    fetch(`${listUrl.replace(/\/$/, "")}?token=${encodeURIComponent(occTokenForOrienteur)}`)
      .then((r) => r.json())
      .then((d) => { if (d?.status === "ok") setAllCandidats(d.candidats ?? []); })
      .catch(() => {});
  }, [isOrienteurMode, occTokenForOrienteur]);

  const switcherOptions = useMemo<Option[]>(
    () => allCandidats.map((c) => ({
      id: c.id,
      label: `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() || "—",
      hint: c.reference ?? undefined,
    })),
    [allCandidats],
  );

  // mode "none" → message d'aide
  useEffect(() => {
    if (mode === "none") setStatus("Ouvre ce widget dans Grist (ou /dev/harness).");
  }, [mode]);

  useEffect(() => {
    if (!docApi) return;
    (async () => {
      try {
        const [meta, map] = await Promise.all([loadColumnsMetaFor(docApi, TABLE_ID), buildColRowIdMap(docApi)]);
        setCols(meta);
        setColRowIdMap(map);
      } catch (e: any) {
        setStatus(`Erreur: ${e?.message ?? String(e)}`);
      }
    })();
  }, [docApi]);

  // ── Mode Grist (iframe) : onRecord ────────────────────
  useEffect(() => {
    if (!docApi || mode !== "grist") return;
    if (typeof window === "undefined") return;
    const grist = (window as any).grist;
    if (!grist) return;
    grist.onRecord((record: any) => {
      if (!record) { setSelected(null); return; }
      setSelected(record);
    });
    grist.ready({ requiredAccess: "full" });
  }, [docApi, mode]);

  // ── Mode orienteur : fetch via occ-get-candidat ──────────────────
  useEffect(() => {
    if (!isOrienteurMode || !occTokenForOrienteur || !candidatRowIdFromUrl) return;
    setLoadingRest(true);
    const getUrl = process.env.NEXT_PUBLIC_OCC_GET_CANDIDAT_URL;
    if (!getUrl) {
      setStatus("Configuration manquante (OCC_GET_CANDIDAT_URL).");
      setLoadingRest(false);
      return;
    }
    const url = `${getUrl.replace(/\/$/, "")}?token=${encodeURIComponent(occTokenForOrienteur)}&id=${candidatRowIdFromUrl}`;
    fetch(url)
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((data) => {
        if (data?.status === "ok" && data.candidat) {
          setSelected({ id: data.candidat.id, ...data.candidat });
        } else {
          setStatus("Dossier introuvable ou accès refusé.");
        }
      })
      .catch((e) => setStatus("Erreur: " + (e?.message ?? String(e))))
      .finally(() => setLoadingRest(false));
  }, [isOrienteurMode, occTokenForOrienteur, candidatRowIdFromUrl]);

  // ── Mode REST (standalone magic link) : fetch par token ou rowId ─
  useEffect(() => {
    if (!docApi || mode !== "rest" || !rowIdFromUrl || isOrienteurMode) return;
    setLoadingRest(true);
    (async () => {
      try {
        // tokenFromUrl : "rowId.HMAC" → vérification HMAC côté n8n
        // null         : dev fallback ?rowId= → filtre direct (pas de vérif HMAC)
        const row = await fetchSingleRowRest(TABLE_ID, rowIdFromUrl, tokenFromUrl);
        if (row) setSelected(row);
        else setStatus("Dossier introuvable.");
      } catch (e: any) {
        setStatus("Erreur: " + (e?.message ?? String(e)));
      } finally {
        setLoadingRest(false);
      }
    })();
  }, [docApi, mode, rowIdFromUrl, tokenFromUrl]);

  useEffect(() => {
    if (!selected) { setDraft({}); return; }
    const d: Record<string, any> = {};
    for (const c of cols) d[c.colId] = selected[c.colId];
    setDraft(d);
  }, [selected, cols]);

  useEffect(() => {
    // En mode REST (magic link), pas besoin de la liste complète des candidats
    if (!docApi || mode === "rest") return;
    (async () => {
      try {
        const t = await docApi.fetchTable(TABLE_ID);
        const opts: Option[] = [];
        const idByRow = new Map<number, number>();
        const rowById = new Map<number, number>();
        for (let i = 0; i < t.id.length; i++) {
          const rowId = t.id[i] as number;
          const prenom = (t["Prenom"]?.[i] ?? "").toString().trim();
          const nom = (t["Nom_de_famille"]?.[i] ?? "").toString().trim();
          const label = `${prenom} ${nom}`.trim() || `#${rowId}`;
          const hint = (t["ID2"]?.[i] ?? "").toString().trim();
          const q = `${label} ${hint}`.toLowerCase();
          const candidateId = i + 1;
          idByRow.set(rowId, candidateId);
          rowById.set(candidateId, rowId);
          opts.push({ id: candidateId, label, q, hint } as any);
        }
        setCandidateOptions(opts);
        setCandidateIdByRowId(idByRow);
        setRowIdByCandidateId(rowById);
      } catch (e: any) {
        setStatus(`Erreur: ${e?.message ?? String(e)}`);
      }
    })();
  }, [docApi]);

  useEffect(() => {
    if (!selected?.id) return;
    const v = candidateIdByRowId.get(selected.id) ?? null;
    setCandidateValueId(v);
  }, [selected?.id, candidateIdByRowId]);

  async function save() {
    if (!docApi || !selected?.id) return;
    setSaving(true);
    try {
      const updates: Record<string, any> = {};
      for (const c of cols) {
        if (!isEditable(c)) continue;
        // Champs Attachments non modifiés : les exclure du UpdateRecord.
        // Envoyer la valeur ["L", id1, id2] d'un champ PJ inchangé via UpdateRecord
        // provoque un effacement des pièces jointes côté Grist.
        // On n'inclut un champ Attachments que s'il a été modifié par l'utilisateur.
        if (
          c.type === "Attachments" &&
          JSON.stringify(draft[c.colId]) === JSON.stringify(selected?.[c.colId])
        ) continue;
        updates[c.colId] = draft[c.colId];
      }
      await docApi.applyUserActions([["UpdateRecord", TABLE_ID, selected.id, updates]]);
      setStatus("Enregistré ✅");
    } catch (e: any) {
      setStatus("Erreur: " + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  const subtabColIds = useMemo(() => FIELD_MAP[activeTab]?.[activeSubtab] ?? [], [activeTab, activeSubtab]);
  const subtabFields = useMemo(() => subtabColIds.map((id) => colById.get(id)).filter((c): c is ColMeta => !!c), [subtabColIds, colById]);
  const isTabMapped = useMemo(() => {
    const subMap = FIELD_MAP[activeTab] ?? {};
    return Object.values(subMap).flat().length > 0;
  }, [activeTab]);

  return (
    <div className="emile-shell">

      {/* ===== HEADER ===== */}
      <header className="emile-header">
        <img src={logoEmile.src} alt="EMILE" style={{ height: "1.8rem", width: "auto" }} />
        {/* Nom + badge uniquement en mode Grist (iframe) — en mode orienteur c'est dans la barre de navigation */}
        {!isOrienteurMode && selectedName && (
          <>
            <span className="emile-header__sep">›</span>
            <span className="emile-header__candidate">{selectedName}</span>
            {selectedHint && <span className="emile-header__badge">{selectedHint}</span>}
          </>
        )}

        <div className="emile-header__spacer" />

        <div className="emile-header__search">
          {/* Recherche candidat + FAQ : uniquement en mode Grist (iframe) */}
          {mode !== "rest" && (
            <>
              <span className="emile-header__search-label">
                <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
              </span>
              <div className="emile-header__search-wrap">
                <SearchDropdown
                  options={candidateOptions}
                  valueId={candidateValueId}
                  onChange={(candidateId) => {
                    if (!candidateId) return;
                    setCandidateValueId(candidateId);
                    const rowId = rowIdByCandidateId.get(candidateId);
                    const grist = (window as any).grist;
                    if (rowId && grist?.setCursorPos) {
                      grist.setCursorPos({ rowId });
                    } else {
                      setStatus("Info: sélection candidat active uniquement dans Grist.");
                    }
                  }}
                  placeholder="Candidat…"
                  disabled={candidateOptions.length === 0}
                  searchable={true}
                  variant="header"
                />
              </div>
              <button
                type="button"
                className="emile-faq-btn"
                onClick={() => setShowFaq(true)}
              >
                <i className="fa-solid fa-circle-question" aria-hidden="true" />
                FAQ
              </button>
            </>
          )}
          {!isOrienteurMode && (
            <button
              type="button"
              className="emile-save-btn"
              onClick={save}
              disabled={!selected?.id || !docApi || saving}
            >
              <i className="fa-solid fa-floppy-disk" aria-hidden="true" />
              {saving ? "…" : "Enregistrer"}
            </button>
          )}
        </div>
      </header>

      {/* ===== BARRE NAVIGATION ORIENTEUR ===== */}
      {isOrienteurMode && orienteurListUrl && (
        <div className="emile-orienteur-bar">
          {/* Retour + fil d'Ariane */}
          <a href={orienteurListUrl} className="emile-orienteur-bar__back">
            <i className="fa-solid fa-arrow-left" />
            Mes candidat·e·s
          </a>
          {selectedName && (
            <>
              <span className="emile-orienteur-bar__sep">›</span>
              <span className="emile-orienteur-bar__name">{selectedName}</span>
              {selectedHint && (
                <span className="emile-orienteur-bar__ref">{selectedHint}</span>
              )}
            </>
          )}
          <div className="emile-orienteur-bar__spacer" />
          {/* Switcher candidat·e·s */}
          {switcherOptions.length > 1 && (
            <div className="emile-orienteur-bar__switcher">
              <SearchDropdown
                options={switcherOptions}
                valueId={candidatRowIdFromUrl}
                onChange={(newId) => {
                  if (!newId || newId === candidatRowIdFromUrl || !occTokenForOrienteur) return;
                  const base = window.location.href.split("?")[0];
                  window.location.href = `${base}?token=${occTokenForOrienteur}&id=${newId}`;
                }}
                placeholder="Changer de candidat·e…"
                searchable={true}
              />
            </div>
          )}
        </div>
      )}

      {/* ===== BARRE L1 ===== */}
      <nav className="emile-navbar" aria-label="Onglets principaux">
        {EMILE_TABS.map((t) => (
          <button key={t.key} type="button"
            className={`emile-nav-tab${activeTab === t.key ? " active" : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            <i className={t.icon} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </nav>

      {/* ===== BARRE L2 ===== */}
      <div className="emile-subnav">
        {activeTabObj.subtabs.map((st) => (
          <button key={st.key} type="button"
            className={`emile-subnav-tab${activeSubtab === st.key ? " active" : ""}`}
            onClick={() => setActiveSubtab(st.key)}
          >
            {st.label}
          </button>
        ))}
      </div>

      {/* ===== STATUS ===== */}
      {status && (
        <div className="emile-status" style={{ padding: "0.4rem 1rem 0" }}>
          <StatusAlert status={status} />
        </div>
      )}

      {/* ===== CORPS ===== */}
      <div className="emile-body">
        {mode === "boot" ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "#bbb" }}>
            <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "1.5rem" }} />
          </div>
        ) : loadingRest ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "#bbb" }}>
            <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "1.5rem" }} />
          </div>
        ) : !selected || !docApi ? (
          <div className="fr-alert fr-alert--info">
            <p className="fr-alert__title">En attente</p>
            <p>{mode === "rest"
              ? "Aucun dossier chargé. Vérifie que le lien contient un paramètre ?token=."
              : "Sélectionne un candidat dans Grist pour afficher son dossier."
            }</p>
          </div>
        ) : !isTabMapped ? (
          <div className="fr-alert fr-alert--info">
            <p className="fr-alert__title">Onglet non mappé</p>
            <p>Pour l&apos;instant, seul <b>Administratif</b> est mappé sur des colonnes Grist.<br />
              Prochaine étape : on mappe <b>{activeTabObj.label}</b>.</p>
          </div>
        ) : (
          <div className="emile-form-card">
            <div className="emile-field-grid">
              {subtabFields.map((c) => (
                <Field
                  key={c.colId}
                  col={c}
                  value={draft[c.colId]}
                  onChange={(v) => setDraft((d) => ({ ...d, [c.colId]: v }))}
                  docApi={docApi}
                  colRowIdMap={colRowIdMap}
                  draft={draft}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ===== FAQ PANEL ===== */}
      {showFaq && docApi && <FAQPanel docApi={docApi} onClose={() => setShowFaq(false)} />}

    </div>
  );
}

/* =====================================================
   FieldRenderer
   ===================================================== */

function Field(props: {
  col: ColMeta;
  value: any;
  onChange: (v: any) => void;
  docApi: GristDocAPI;
  colRowIdMap: Map<number, { colId: string }>;
  draft?: Record<string, any>;
}) {
  const { col, value, onChange, docApi, colRowIdMap, draft } = props;

  const type = col.type || "Text";
  const isRef      = /^Ref:/.test(type);
  const isRefList  = /^RefList:/.test(type);
  const isChoice   = type === "Choice";
  const isChoiceList = type === "ChoiceList";
  const isDate     = type === "Date";
  const isAttachment = type === "Attachments";
  const isBool     = type === "Bool";

  const disabled = isAttachment ? false : !isEditable(col);

  const lowerLabel = (col.label ?? "").toLowerCase();
  const lowerId    = (col.colId ?? "").toLowerCase();
  const useTextarea = type === "Text" && (
    lowerLabel.includes("comment") || lowerLabel.includes("compl") ||
    lowerId.includes("comment") || col.colId === "Adresse"
  );

  const wrapCls = useTextarea ? "emile-field emile-field--wide" : "emile-field";

  const choiceOptions = useMemo(() => {
    const raw = col.widgetOptionsParsed?.choices;
    const arr = Array.isArray(raw) ? raw : [];
    return arr.map((label: any, i: number) => ({
      id: i + 1, label: String(label), q: String(label).toLowerCase(),
    }));
  }, [col.widgetOptionsParsed]);

  const choiceIdByLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of choiceOptions) m.set(o.label, o.id);
    return m;
  }, [choiceOptions]);

  const choiceLabelById = useMemo(() => {
    const m = new Map<number, string>();
    for (const o of choiceOptions) m.set(o.id, o.label);
    return m;
  }, [choiceOptions]);

  /* ── Champs spéciaux par colId ─────────────────────── */
  if (col.colId === "Date_de_naissance" && isDate) {
    return (
      <DateNaissanceSpecialField
        value={typeof value === "number" ? value : null}
        onChange={onChange}
        disabled={disabled}
        col={col}
        genreValue={draft?.["Genre"] ?? ""}
      />
    );
  }

  if (col.colId === "Nationalite" && isRef) {
    return (
      <NationaliteSpecialField
        value={typeof value === "number" ? value : null}
        onChange={onChange}
        disabled={disabled}
        docApi={docApi}
        col={col}
      />
    );
  }

  if (col.colId === "Departement_domicile_inscription" && isRef) {
    return (
      <DeptSpecialField
        value={typeof value === "number" ? value : null}
        onChange={onChange}
        disabled={disabled}
        docApi={docApi}
        col={col}
      />
    );
  }

  if (col.colId === "Tel") {
    return (
      <TelSpecialField
        value={value ?? ""}
        onChange={onChange}
        disabled={disabled}
        col={col}
      />
    );
  }

  /* ── Attachments ───────────────────────────────────── */
  if (isAttachment) {
    return (
      <AttachmentField
        label={col.label}
        value={value}
        onChange={onChange}
        docApi={docApi}
        disabled={disabled}
      />
    );
  }

  /* ── Bool → boutons Oui / Non ──────────────────────── */
  if (isBool) {
    return (
      <div className={wrapCls}>
        <FieldLabel col={col} disabled={disabled} />
        <div className="emile-ouinon">
          <button
            type="button"
            className={`emile-ouinon-btn${value === true ? " emile-ouinon-btn--active" : ""}`}
            style={value === true ? OUINON_ACTIVE : undefined}
            onClick={() => !disabled && onChange(true)}
            disabled={disabled}
          >Oui</button>
          <button
            type="button"
            className={`emile-ouinon-btn${value === false ? " emile-ouinon-btn--active" : ""}`}
            style={value === false ? OUINON_ACTIVE : undefined}
            onClick={() => !disabled && onChange(false)}
            disabled={disabled}
          >Non</button>
        </div>
      </div>
    );
  }

  /* ── Choice avec ≤ 3 options → boutons ─────────────── */
  if (isChoice && choiceOptions.length >= 1 && choiceOptions.length <= 3) {
    const valueStr = value == null ? "" : String(value);
    return (
      <div className={wrapCls}>
        <FieldLabel col={col} disabled={disabled} />
        <div className="emile-ouinon">
          {choiceOptions.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`emile-ouinon-btn${valueStr === o.label ? " emile-ouinon-btn--active" : ""}`}
              style={valueStr === o.label ? OUINON_ACTIVE : undefined}
              onClick={() => !disabled && onChange(valueStr === o.label ? null : o.label)}
              disabled={disabled}
            >{o.label}</button>
          ))}
        </div>
      </div>
    );
  }

  /* ── Date générique (triptique Jour/Mois/Année) ────── */
  if (isDate) {
    return (
      <GenericDateField
        value={typeof value === "number" ? value : null}
        onChange={onChange}
        disabled={disabled}
        col={col}
      />
    );
  }

  /* ── Choice (dropdown) ─────────────────────────────── */
  if (isChoice) {
    const valueStr = value == null ? "" : String(value);
    const valueId  = valueStr ? choiceIdByLabel.get(valueStr) ?? null : null;
    return (
      <div className={wrapCls}>
        <FieldLabel col={col} disabled={disabled} />
        <SearchDropdown
          options={choiceOptions}
          valueId={valueId}
          onChange={(id) => onChange(id ? choiceLabelById.get(id) ?? null : null)}
          placeholder="—"
          disabled={disabled || choiceOptions.length === 0}
          searchable={choiceOptions.length > 6}
        />
      </div>
    );
  }

  /* ── ChoiceList ─────────────────────────────────────── */
  if (isChoiceList) {
    const selectedLabels = decodeListCell(value).filter((x) => typeof x === "string") as string[];
    const selectedIds = selectedLabels
      .map((lab) => choiceIdByLabel.get(lab))
      .filter((x): x is number => typeof x === "number");
    return (
      <div className={wrapCls}>
        <FieldLabel col={col} disabled={disabled} />
        <SearchMultiDropdown
          options={choiceOptions}
          valueIds={selectedIds}
          onChange={(nextIds) => {
            const nextLabels = nextIds.map((id) => choiceLabelById.get(id)).filter((s): s is string => !!s);
            onChange(encodeListCell(nextLabels));
          }}
          placeholder="—"
          disabled={disabled || choiceOptions.length === 0}
          searchable={choiceOptions.length > 6}
        />
      </div>
    );
  }

  /* ── Ref / RefList ─────────────────────────────────── */
  if (isRef || isRefList) {
    const [refOptions, setRefOptions] = useState<Option[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      (async () => {
        setLoading(true);
        try {
          const cache = await ensureRefCache(docApi, col, colRowIdMap);
          setRefOptions((cache?.rows ?? []).map((r) => ({ id: r.id, label: r.label, q: r.q })));
        } finally {
          setLoading(false);
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [col.colId]);

    if (isRef) {
      const valueId = typeof value === "number" ? value : null;
      return (
        <div className={wrapCls}>
          <FieldLabel col={col} disabled={disabled} />
          <SearchDropdown
            options={refOptions}
            valueId={valueId}
            onChange={(id) => onChange(id)}
            placeholder={loading ? "…" : "—"}
            disabled={disabled || loading}
          />
        </div>
      );
    }

    const ids = decodeListCell(value).filter((x) => typeof x === "number") as number[];
    return (
      <div className={wrapCls}>
        <FieldLabel col={col} disabled={disabled} />
        <SearchMultiDropdown
          options={refOptions}
          valueIds={ids}
          onChange={(nextIds) => onChange(encodeListCell(nextIds))}
          placeholder={loading ? "…" : "—"}
          disabled={disabled || loading}
        />
      </div>
    );
  }

  /* ── Textarea ──────────────────────────────────────── */
  if (useTextarea) {
    return (
      <div className={wrapCls}>
        <FieldLabel col={col} disabled={disabled} />
        <textarea
          className="emile-textarea"
          rows={col.colId === "Adresse" ? 3 : 4}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      </div>
    );
  }

  /* ── Text (défaut) ─────────────────────────────────── */
  return (
    <div className={wrapCls}>
      <FieldLabel col={col} disabled={disabled} />
      <input
        className="emile-input"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}
