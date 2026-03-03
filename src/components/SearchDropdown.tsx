"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type Option = { id: number; label: string; q?: string; tagLeft?: string; tag?: string };

/* ─── styles partagés ─────────────────────────────────── */

const triggerBase: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  minHeight: "1.875rem",
  padding: "0.25rem 1.75rem 0.25rem 0.5rem",
  borderRadius: 4,
  border: "1px solid #d0d0d0",
  background: "#f9f9f9",
  cursor: "pointer",
  fontSize: "0.82rem",
  fontFamily: "Marianne, arial, sans-serif",
  color: "#1e1e1e",
  position: "relative",
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "0.25rem",
  boxSizing: "border-box" as const,
  transition: "border-color 0.12s, background 0.12s",
};

const triggerDisabled: React.CSSProperties = {
  ...triggerBase,
  background: "#f3f3f3",
  color: "#999",
  border: "1px solid #e5e5e5",
  cursor: "default",
};

const chevronStyle: React.CSSProperties = {
  position: "absolute",
  right: "0.4rem",
  top: "50%",
  transform: "translateY(-50%)",
  pointerEvents: "none",
  fontSize: "0.65rem",
  color: "#888",
};

const dropPanel: React.CSSProperties = {
  position: "absolute",
  zIndex: 500,
  top: "calc(100% + 3px)",
  left: 0,
  minWidth: "100%",
  border: "1px solid #c8c8e8",
  borderRadius: 6,
  background: "#fff",
  boxShadow: "0 6px 20px rgba(0,0,145,.1)",
  overflow: "hidden",
};

const searchInput: React.CSSProperties = {
  width: "100%",
  padding: "0.3rem 0.5rem",
  border: "none",
  borderBottom: "1px solid #eee",
  fontSize: "0.8rem",
  fontFamily: "Marianne, arial, sans-serif",
  outline: "none",
  boxSizing: "border-box" as const,
};

const optionBtn: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "0.35rem 0.6rem",
  border: 0,
  background: "white",
  cursor: "pointer",
  borderBottom: "1px solid #f5f5f5",
  fontSize: "0.82rem",
  fontFamily: "Marianne, arial, sans-serif",
  color: "#1e1e1e",
};

/* ─── SearchDropdown ──────────────────────────────────── */

export function SearchDropdown(props: {
  options: Option[];
  valueId: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;        // défaut true — mettre false si peu d'options
  variant?: "default" | "header"; // header = style pour fond sombre
}) {
  const { options, valueId, onChange, placeholder, disabled, searchable = true, variant = "default" } = props;

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => (valueId != null ? options.find((o) => o.id === valueId) ?? null : null),
    [valueId, options]
  );

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return options.slice(0, 400);
    return options.filter((o) => (o.q ?? o.label).toLowerCase().includes(qq)).slice(0, 400);
  }, [q, options]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) { setOpen(false); setQ(""); }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  /* Style variant header (fond bleu) */
  const headerTrigger: React.CSSProperties = {
    ...triggerBase,
    height: "1.875rem",
    background: "rgba(255,255,255,.15)",
    border: "1px solid rgba(255,255,255,.35)",
    color: "#fff",
    borderRadius: 3,
  };

  const trigger = disabled ? triggerDisabled : variant === "header" ? headerTrigger : triggerBase;

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        style={trigger}
      >
        {selected ? (
          <span>{selected.label}</span>
        ) : (
          <span style={{ opacity: variant === "header" ? 0.7 : 0.5 }}>
            {placeholder ?? "Sélectionner…"}
          </span>
        )}
        <span style={chevronStyle}>▾</span>
      </button>

      {open && !disabled && (
        <div style={dropPanel}>
          {searchable && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher…"
              style={searchInput}
              autoFocus
            />
          )}
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => { onChange(o.id); setOpen(false); setQ(""); }}
                onMouseEnter={() => setHoveredId(o.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  ...optionBtn,
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.4rem",
                  background: valueId === o.id ? "#f0f0ff" : hoveredId === o.id ? "#f5f5ff" : "white",
                  fontWeight: valueId === o.id ? 700 : 400,
                }}
              >
                {o.tagLeft && (
                  <span style={{
                    fontSize: "0.62rem", fontWeight: 700, padding: "0.1rem 0.35rem",
                    borderRadius: 3, flexShrink: 0,
                    background: "#e8eef8", color: "#000091", whiteSpace: "nowrap",
                  }}>{o.tagLeft}</span>
                )}
                <span style={{ whiteSpace: "normal", wordBreak: "break-word", flex: 1 }}>{o.label}</span>
                {o.tag && (
                  <span style={{
                    fontSize: "0.62rem", fontWeight: 600, padding: "0.1rem 0.35rem",
                    borderRadius: 3, flexShrink: 0,
                    background: "#f0f0f8", color: "#555", whiteSpace: "nowrap",
                  }}>{o.tag}</span>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: "0.5rem 0.6rem", fontSize: "0.8rem", color: "#999" }}>Aucun résultat.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── SearchMultiDropdown ─────────────────────────────── */

export function SearchMultiDropdown(props: {
  options: Option[];
  valueIds: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const { options, valueIds, onChange, placeholder, disabled, searchable = true } = props;

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const valueSet = useMemo(() => new Set(valueIds), [valueIds]);

  const label = useMemo(() => {
    if (valueIds.length === 0) return null;
    const names = valueIds
      .map((id) => options.find((o) => o.id === id)?.label ?? "")
      .filter(Boolean)
      .slice(0, 3);
    const more = valueIds.length > 3 ? ` +${valueIds.length - 3}` : "";
    return names.join(", ") + more;
  }, [valueIds, options]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return options.slice(0, 120);
    return options.filter((o) => (o.q ?? o.label).toLowerCase().includes(qq)).slice(0, 120);
  }, [q, options]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) { setOpen(false); setQ(""); }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function toggle(id: number) {
    const next = valueSet.has(id) ? valueIds.filter((x) => x !== id) : [...valueIds, id];
    onChange(next);
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        style={disabled ? triggerDisabled : triggerBase}
      >
        {label ? (
          <span>{label}</span>
        ) : (
          <span style={{ opacity: 0.5 }}>{placeholder ?? "Sélectionner…"}</span>
        )}
        <span style={chevronStyle}>▾</span>
      </button>

      {open && !disabled && (
        <div style={dropPanel}>
          {searchable && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher…"
              style={searchInput}
              autoFocus
            />
          )}
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {filtered.map((o) => (
              <label
                key={o.id}
                onMouseEnter={() => setHoveredId(o.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  padding: "0.35rem 0.6rem",
                  borderBottom: "1px solid #f5f5f5",
                  cursor: "pointer",
                  alignItems: "center",
                  fontSize: "0.82rem",
                  fontFamily: "Marianne, arial, sans-serif",
                  background: valueSet.has(o.id) ? "#f0f0ff" : hoveredId === o.id ? "#f5f5ff" : "white",
                  fontWeight: valueSet.has(o.id) ? 700 : 400,
                }}
              >
                <input type="checkbox" checked={valueSet.has(o.id)} onChange={() => toggle(o.id)} style={{ flexShrink: 0 }} />
                {o.label}
              </label>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: "0.5rem 0.6rem", fontSize: "0.8rem", color: "#999" }}>Aucun résultat.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
