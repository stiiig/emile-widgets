"use client";

import { useEffect, useState } from "react";
import "./styles.css";
import logoEmile from "../assets/logo-emile-white.png";
import {
  loadColumnsMetaFor,
  normalizeChoices,
} from "@/lib/grist/meta";
import { SearchDropdown, Option } from "@/components/SearchDropdown";
import { FAQPanel } from "@/components/FAQPanel";
import { useGristInit, useDepartementOptions } from "@/lib/grist/hooks";
import { choicesToOptions } from "@/lib/emile/utils";

const TABLE_ID = "ETABLISSEMENTS";

/* ─── Types ──────────────────────────────────────────────────── */
type FormData = {
  Nom_etablissement:      string;
  Dispositif:             string;
  Departement:            number | null;   // Ref:DPTS_REGIONS → rowId
  Organisme_gestionnaire: string;
};

const INITIAL: FormData = {
  Nom_etablissement:      "",
  Dispositif:             "",
  Departement:            null,
  Organisme_gestionnaire: "",
};

/* ─── Page principale ────────────────────────────────────────── */
export default function EtablissementPage() {
  const { mode, docApi }            = useGristInit();
  const { deptOptions, dptsLoading, dptsError } = useDepartementOptions(docApi);
  const [form, setForm]             = useState<FormData>(INITIAL);
  const [done, setDone]             = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [showFaq, setShowFaq]       = useState(false);

  /* Options */
  const [dispositifOptions, setDispositifOptions] = useState<Option[]>([]);
  const [organismeOptions,   setOrganismeOptions] = useState<Option[]>([]);
  const [colsLoading,        setColsLoading]      = useState(true);

  /* ── Effet : répercute l'erreur département ─────────────────── */
  useEffect(() => {
    if (dptsError) setError(dptsError);
  }, [dptsError]);

  /* ── Effet : colonnes Choice ───────────────────────────────── */
  useEffect(() => {
    if (!docApi) return;
    setColsLoading(true);
    loadColumnsMetaFor(docApi, TABLE_ID)
      .then((cols) => {
        const dispCol = cols.find((c) => c.colId === "Dispositif");
        if (dispCol) setDispositifOptions(choicesToOptions(normalizeChoices(dispCol.widgetOptionsParsed?.choices)));
        const orgaCol = cols.find((c) => c.colId === "Organisme_gestionnaire");
        if (orgaCol) setOrganismeOptions(choicesToOptions(normalizeChoices(orgaCol.widgetOptionsParsed?.choices)));
      })
      .catch((e: any) => setError(`[colonnes] ${e?.message ?? String(e)}`))
      .finally(() => setColsLoading(false));
  }, [docApi]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Mise à jour du formulaire ──────────────────────────────── */
  function set<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /* ── Validation ─────────────────────────────────────────────── */
  function validate(): string | null {
    if (
      !form.Nom_etablissement.trim() ||
      !form.Dispositif ||
      !form.Departement ||
      !form.Organisme_gestionnaire
    ) return "Tous les champs sont requis.";
    return null;
  }

  /* ── Soumission ─────────────────────────────────────────────── */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);

    if (!docApi) { setError("Grist non disponible — ce formulaire nécessite une connexion."); return; }

    setSubmitting(true);
    try {
      // Vérification doublon nom d'établissement
      const existingTable = await docApi.fetchTable(TABLE_ID);
      const existingNames = (existingTable.Nom_etablissement as string[]) ?? [];
      const nomNorm = form.Nom_etablissement.trim().toLowerCase();
      if (existingNames.some((n) => String(n).trim().toLowerCase() === nomNorm)) {
        setError("Un établissement avec ce nom existe déjà.");
        setSubmitting(false);
        return;
      }

      await docApi.applyUserActions([
        ["AddRecord", TABLE_ID, null, {
          Nom_etablissement:      form.Nom_etablissement.trim(),
          Dispositif:             form.Dispositif,
          Departement:            form.Departement,
          Organisme_gestionnaire: form.Organisme_gestionnaire,
        }],
      ]);
      setDone(true);
    } catch {
      setError("Une erreur est survenue lors de l'enregistrement. Veuillez réessayer.");
    } finally {
      setSubmitting(false);
    }
  }

  /* ── Réinitialiser ──────────────────────────────────────────── */
  function handleReset() {
    setForm(INITIAL);
    setError(null);
    setDone(false);
  }

  /* ── Libellés pour l'écran done ─────────────────────────────── */
  const deptOpt = deptOptions.find((o) => o.id === form.Departement);

  const dataLoading = dptsLoading || colsLoading;

  /* ── Mode non disponible (pas de proxy n8n, pas d'iframe Grist) ── */
  if (mode === "none") {
    return (
      <div className="ae-shell">
        <header className="ae-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoEmile.src} alt="EMILE" style={{ height: "2rem", width: "auto" }} />
          <span className="ae-header__appname">Ajout d&apos;un établissement</span>
          <div className="ae-header__spacer" />
          <button type="button" className="ae-faq-btn" onClick={() => setShowFaq(true)}>
            <i className="fa-solid fa-circle-question" />
            FAQ
          </button>
        </header>
        <main className="ae-body">
          <div className="fr-alert fr-alert--warning">
            <p className="fr-alert__title">Non disponible</p>
            <p>Ce widget doit être ouvert dans Grist ou via une URL configurée.</p>
          </div>
        </main>
        {showFaq && <FAQPanel docApi={docApi} onClose={() => setShowFaq(false)} />}
      </div>
    );
  }

  /* ── Spinner boot ───────────────────────────────────────────── */
  if (mode === "boot") {
    return (
      <div className="ae-shell">
        <header className="ae-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoEmile.src} alt="EMILE" style={{ height: "2rem", width: "auto" }} />
          <span className="ae-header__appname">Ajout d&apos;un établissement</span>
          <div className="ae-header__spacer" />
          <button type="button" className="ae-faq-btn" onClick={() => setShowFaq(true)}>
            <i className="fa-solid fa-circle-question" />
            FAQ
          </button>
        </header>
        <main className="ae-body ae-body--center">
          <div style={{ color: "#bbb", fontSize: "1.5rem" }}><i className="fa-solid fa-spinner fa-spin" /></div>
        </main>
        {showFaq && <FAQPanel docApi={docApi} onClose={() => setShowFaq(false)} />}
      </div>
    );
  }

  /* ── Écran de confirmation ──────────────────────────────────── */
  if (done) {
    return (
      <div className="ae-shell">
        <header className="ae-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoEmile.src} alt="EMILE" style={{ height: "2rem", width: "auto" }} />
          <span className="ae-header__appname">Ajout d&apos;un établissement</span>
          <div className="ae-header__spacer" />
          <button type="button" className="ae-faq-btn" onClick={() => setShowFaq(true)}>
            <i className="fa-solid fa-circle-question" />
            FAQ
          </button>
        </header>
        <main className="ae-body">
          <div className="ae-done">
            <i className="fa-solid fa-circle-check" style={{ fontSize: "2.5rem", color: "#18753c" }} />
            <h1 className="ae-done__title">Enregistrement réussi&nbsp;!</h1>
            <p className="ae-done__subtitle">
              L&apos;établissement suivant a bien été ajouté au programme EMILE&nbsp;:
            </p>
            <div className="ae-done__name">
              <div style={{ fontWeight: 700, marginBottom: "0.4rem" }}>
                <i className="fa-solid fa-school" style={{ marginRight: "0.5rem" }} />
                {form.Nom_etablissement}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.85rem", fontWeight: 400, color: "#333" }}>
                {deptOpt && (
                  <span><strong>Département&nbsp;:</strong> {deptOpt.label}</span>
                )}
                {form.Organisme_gestionnaire && (
                  <span><strong>Organisme gestionnaire&nbsp;:</strong> {form.Organisme_gestionnaire}</span>
                )}
                {form.Dispositif && (
                  <span><strong>Dispositif&nbsp;:</strong> {form.Dispositif}</span>
                )}
              </div>
            </div>
            <div className="ae-done__actions">
              <a
                href="https://stiiig.github.io/emile-widgets/widgets/emile/creation-compte-orienteur/"
                className="ae-btn ae-btn--primary"
                style={{ textDecoration: "none" }}
              >
                Créer un compte orienteur·ice <i className="fa-solid fa-arrow-right" />
              </a>
            </div>
          </div>
        </main>
        {showFaq && <FAQPanel docApi={docApi} onClose={() => setShowFaq(false)} />}
      </div>
    );
  }

  /* ── Rendu principal ────────────────────────────────────────── */
  return (
    <div className="ae-shell">
      <header className="ae-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoEmile.src} alt="EMILE" style={{ height: "2rem", width: "auto" }} />
        <span className="ae-header__appname">Ajout d&apos;un établissement</span>
        <div className="ae-header__spacer" />
        <button type="button" className="ae-faq-btn" onClick={() => setShowFaq(true)}>
          <i className="fa-solid fa-circle-question" />
          FAQ
        </button>
      </header>
      <main className="ae-body">

        <form className="ae-form" onSubmit={handleSubmit}>

          {/* Erreur — affichée en tête de formulaire */}
          {error && (
            <div className="ae-validation-error">
              <i className="fa-solid fa-circle-exclamation" />
              <span>{error}</span>
            </div>
          )}

          {/* Nom */}
          <div className="ae-field">
            <label className="ae-label">
              Nom de l&apos;établissement <span className="ae-required">*</span>
            </label>
            <input
              className="ae-input"
              type="text"
              value={form.Nom_etablissement}
              onChange={(e) => set("Nom_etablissement", e.target.value)}
              autoFocus
            />
          </div>

          {/* Département */}
          <div className="ae-field">
            <label className="ae-label">
              Département <span className="ae-required">*</span>
            </label>
            <SearchDropdown
              options={deptOptions}
              valueId={form.Departement}
              onChange={(id) => set("Departement", id)}
              placeholder={dptsLoading ? "Chargement…" : "Rechercher un département"}
              disabled={dptsLoading}
            />
          </div>

          {/* Dispositif / Type */}
          <div className="ae-field">
            <label className="ae-label">
              Dispositif / Type <span className="ae-required">*</span>
            </label>
            <SearchDropdown
              options={dispositifOptions}
              valueId={dispositifOptions.find((o) => o.label === form.Dispositif)?.id ?? null}
              onChange={(id) => {
                const found = dispositifOptions.find((o) => o.id === id);
                set("Dispositif", found?.label ?? "");
              }}
              placeholder={colsLoading ? "Chargement…" : "Sélectionner le dispositif"}
              disabled={colsLoading}
            />
          </div>

          {/* Organisme gestionnaire */}
          <div className="ae-field">
            <label className="ae-label">
              Organisme gestionnaire <span className="ae-required">*</span>
            </label>
            <SearchDropdown
              options={organismeOptions}
              valueId={organismeOptions.find((o) => o.label === form.Organisme_gestionnaire)?.id ?? null}
              onChange={(id) => {
                const found = organismeOptions.find((o) => o.id === id);
                set("Organisme_gestionnaire", found?.label ?? "");
              }}
              placeholder={colsLoading ? "Chargement…" : "Sélectionner l'organisme"}
              disabled={colsLoading}
            />
          </div>

          {/* Bouton */}
          <div className="ae-nav-row">
            <button type="submit" className="ae-btn ae-btn--primary" disabled={submitting || dataLoading}>
              {submitting ? (
                "Enregistrement…"
              ) : (
                <>
                  <i className="fa-solid fa-floppy-disk" />
                  Enregistrer
                </>
              )}
            </button>
          </div>

        </form>
      </main>
      {showFaq && <FAQPanel docApi={docApi} onClose={() => setShowFaq(false)} />}
    </div>
  );
}
