"use client";

/**
 * liste-candidats — Vue orienteur·rice
 *
 * Affiche la liste des candidat·e·s rattaché·e·s à l'orienteur identifié
 * par le token OCC passé en query string (?token=<rowId>.<HMAC-SHA256>).
 *
 * Flux :
 *  1. Le token est extrait de l'URL et transmis au workflow n8n `occ-list`.
 *  2. n8n vérifie le HMAC, lit la table CANDIDATS filtrée sur Responsable_candidat,
 *     et renvoie { status, orienteurNom, candidats[] }.
 *  3. Chaque card candidat affiche : nom/prénom, référence, statut coloré,
 *     chips (âge + tooltip date de naissance, genre, nationalité),
 *     ligne de contact (email + téléphone), lien vers la fiche.
 *
 * Variables d'environnement requises (baked au build) :
 *  - NEXT_PUBLIC_OCC_LIST_URL  — URL du webhook n8n occ-list
 */

import { useEffect, useState } from "react";
import "./styles.css";
import logoEmile from "../assets/logo-emile-white.png";
import { FAQPanel } from "@/components/FAQPanel";

// ── Types ────────────────────────────────────────────────────────────────────

type Status = "loading" | "ok" | "invalid" | "no_token" | "error";

/** Données d'un candidat renvoyées par le workflow occ-list */
interface Candidat {
  id: number;
  prenom: string;
  nom: string;
  email: string;
  tel?: string | null;
  genre?: string | null;
  /** Timestamp Unix en secondes ($Date_de_naissance — seule source pour l'âge) */
  dateNaissance?: number | string | null;
  reference?: string | null;
  /** Timestamp Unix en secondes (colonne CreatedAt de Grist) */
  createdAt?: number | string | null;
  /** Libellé de la nationalité (colonne formule $Nationalite_Nom_du_pays) */
  nationalite?: string | null;
  /** Valeur du Choice Statut dans CANDIDATS */
  statut?: string | null;
  /** "✅ OK" | "❌ KO" — colonne formula Eligibilite_overall */
  eligibilite?: string | null;
  /**
   * Champs source pour le popover "Non éligible".
   * Les KO sont dérivés de ces valeurs brutes côté frontend,
   * sans passer par les colonnes calculées Eligibilite_*.
   * La majorité est dérivée de `dateNaissance` via computeAge().
   */
  aie?:                 string | null;                     // "Oui" | "Non"
  territoireDepart?:    boolean | string | number | null;  // $Departement_domicile_inscription_Territoire_depart
  niveauLangueElig?:    boolean | string | number | null;  // $Niveau_de_langue_Eligibilite
  regulariteSituation?: string | null;                     // "Oui" | "Non"
  precariteLogement?:   string | null;                     // valeur du Choice
  volontariteMobilite?: string | null;                     // "Oui" | "Non"
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calcule l'âge en années depuis un timestamp Unix (secondes) ou une chaîne ISO.
 * Renvoie null si la date est absente, invalide ou donne un âge ≤ 0.
 * On ne se fie PAS à la colonne formule Grist `Age` (peut renvoyer 0).
 */
function computeAge(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === 0) return null;
  const ms = typeof raw === "number" ? raw * 1000 : Date.parse(raw as string);
  if (isNaN(ms)) return null;
  const birth = new Date(ms);
  const today = new Date();
  let a = today.getUTCFullYear() - birth.getUTCFullYear();
  const dm = today.getUTCMonth() - birth.getUTCMonth();
  if (dm < 0 || (dm === 0 && today.getUTCDate() < birth.getUTCDate())) a--;
  return a > 0 ? a : null;
}

/**
 * Formate une date Grist en JJ/MM/AAAA.
 * Grist renvoie les colonnes Date comme un timestamp Unix en secondes (number).
 * Fallback string accepté au cas où une version renverrait du YYYY-MM-DD.
 */
function formatDate(raw: string | number | null | undefined): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "number") {
    const d   = new Date(raw * 1000);
    const dd  = String(d.getUTCDate()).padStart(2, "0");
    const mm  = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyy}`;
  }
  // Fallback YYYY-MM-DD
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return raw;
}

/** Formate une date en toutes lettres françaises : "1er janvier 2008". */
const MOIS_FR = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
function formatDateLong(raw: string | number | null | undefined): string | undefined {
  if (raw == null) return undefined;
  const ms = typeof raw === "number" ? raw * 1000 : Date.parse(raw as string);
  if (isNaN(ms)) return undefined;
  const d   = new Date(ms);
  const day = d.getUTCDate();
  return `${day === 1 ? "1er" : day} ${MOIS_FR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Retourne la classe CSS de couleur du chip statut selon la valeur.
 * Les valeurs "Sortie (...)" et "Suspension (...)" sont traitées par préfixe
 * pour couvrir tous les variants sans liste exhaustive.
 */
function statutChipClass(statut: string): string {
  if (statut === "À traiter")          return "lc-chip--statut-traiter";
  if (statut === "En cours")           return "lc-chip--statut-en-cours";
  if (statut === "Étape terminée")     return "lc-chip--statut-termine";
  if (statut.startsWith("Suspension")) return "lc-chip--statut-suspension";
  if (statut.startsWith("Sortie"))     return "lc-chip--statut-sortie";
  return "lc-chip--statut-traiter";
}

// ── Popover "Non éligible" ────────────────────────────────────────────────────

/**
 * Affiche le chip "Non éligible" avec, au survol, une card listant
 * chaque critère KO. Si les données individuelles ne sont pas disponibles
 * (n8n non encore mis à jour), affiche le chip sans info icon.
 */
function EligibilitePopover({ c }: { c: Candidat }) {
  const [open, setOpen] = useState(false);

  /** Critères KO dérivés des champs source (pas des colonnes calculées Grist). */
  const koItems: { label: string; detail: string }[] = [];

  // 1. Accompagnant·e engagé·e — $AIE doit valoir "Oui"
  if (c.aie != null && c.aie !== "Oui")
    koItems.push({ label: "Accompagnant·e engagé·e", detail: c.aie || "Non" });

  // 2. Territoire de départ — $Departement_domicile_inscription_Territoire_depart booléen/chaîne truthy
  const terrOk =
    c.territoireDepart === true   ||
    c.territoireDepart === 1      ||
    c.territoireDepart === "Oui"  ||
    c.territoireDepart === "true" ||
    c.territoireDepart === "1";
  if (c.territoireDepart != null && !terrOk)
    koItems.push({ label: "Territoire de départ", detail: "Hors territoire éligible" });

  // 3. Majorité — calculée depuis dateNaissance (bypass colonne formule Grist)
  const ageCalc = computeAge(c.dateNaissance);
  if (ageCalc != null && ageCalc < 18)
    koItems.push({ label: "Majorité", detail: `${ageCalc} ans — mineur·e` });

  // 4. Niveau de langue — $Niveau_de_langue_Eligibilite booléen/chaîne truthy
  const langOk =
    c.niveauLangueElig === true   ||
    c.niveauLangueElig === 1      ||
    c.niveauLangueElig === "Oui"  ||
    c.niveauLangueElig === "true" ||
    c.niveauLangueElig === "1";
  if (c.niveauLangueElig != null && !langOk)
    koItems.push({ label: "Niveau de langue", detail: "Niveau insuffisant" });

  // 5. Situation régulière — $Regularite_situation doit valoir "Oui"
  if (c.regulariteSituation != null && c.regulariteSituation !== "Oui")
    koItems.push({ label: "Situation régulière", detail: c.regulariteSituation || "Non" });

  // 6. Précarité de logement — KO si la personne n'est dans aucune situation éligible
  if (c.precariteLogement != null && c.precariteLogement.startsWith("Aucun"))
    koItems.push({ label: "Précarité de logement", detail: "Aucune situation éligible" });

  // 7. Volontariat pour le programme EMILE — $Volontariat_mobilite doit valoir "Oui"
  if (c.volontariteMobilite != null && c.volontariteMobilite !== "Oui")
    koItems.push({ label: "Volontariat pour le programme EMILE", detail: c.volontariteMobilite || "Non" });

  const hasDetails = koItems.length > 0;

  return (
    <span
      className="lc-popover-anchor"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className={`lc-chip lc-chip--non-eligible${hasDetails ? " lc-chip--has-popover" : ""}`}>
        Non éligible
        {hasDetails && <i className="fa-solid fa-circle-info" />}
      </span>
      {open && hasDetails && (
        <div className="lc-popover lc-popover--error" role="tooltip">
          <p className="lc-popover__title">
            <i className="fa-solid fa-circle-xmark" />
            Critères non satisfaits
          </p>
          <ul className="lc-popover__list">
            {koItems.map(({ label, detail }) => (
              <li key={label} className="lc-popover__item">
                <i className="fa-solid fa-xmark" />
                <span className="lc-popover__item-label">{label}</span>
                <span className="lc-popover__item-detail">{detail}</span>
              </li>
            ))}
          </ul>
          <span className="lc-popover__arrow" />
        </div>
      )}
    </span>
  );
}

// ── Popover info (ref / date de naissance) ────────────────────────────────────

/** Chip de référence avec popover "Candidature créée le …" au survol. */
function RefChip({ reference, createdAt }: {
  reference: string;
  createdAt: string | number | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const line = createdAt ? `Dossier créé le ${formatDate(createdAt)}` : null;
  return (
    <span
      className="lc-popover-anchor"
      onMouseEnter={() => { if (line) setOpen(true); }}
      onMouseLeave={() => setOpen(false)}
    >
      <span className={`lc-chip lc-chip--ref${line ? " lc-chip--has-popover" : ""}`}>
        {reference}
      </span>
      {open && line && (
        <div className="lc-popover lc-popover--info" role="tooltip">
          <p className="lc-popover__title lc-popover__title--info">
            <i className="fa-solid fa-calendar-check" />
            Référence {reference}
          </p>
          <p className="lc-popover__info-line">{line}</p>
          <span className="lc-popover__arrow lc-popover__arrow--info" />
        </div>
      )}
    </span>
  );
}

/** Chip âge avec popover "Né·e le DD/MM/YYYY" au survol. */
function AgeChip({ displayAge, dateNaissance }: {
  displayAge: number;
  dateNaissance: string | number | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const dateStr = formatDateLong(dateNaissance);
  return (
    <span
      className="lc-popover-anchor"
      onMouseEnter={() => { if (dateStr) setOpen(true); }}
      onMouseLeave={() => setOpen(false)}
    >
      <span className={`lc-chip${dateStr ? " lc-chip--has-popover" : ""}`}>
        <i className="fa-solid fa-cake-candles" />{displayAge} ans
      </span>
      {open && dateStr && (
        <div className="lc-popover lc-popover--info" role="tooltip">
          <p className="lc-popover__title lc-popover__title--info">
            <i className="fa-solid fa-cake-candles" />
            Date de naissance
          </p>
          <p className="lc-popover__info-line">{dateStr}</p>
          <span className="lc-popover__arrow lc-popover__arrow--info" />
        </div>
      )}
    </span>
  );
}

// ── Menu orienteur (username + dropdown déconnexion) ──────────────────────────

function OrienteurMenu({ nom, onLogout }: { nom: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{ position: "relative", display: "inline-block", flexShrink: 0 }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}
    >
      <button type="button" className="lc-user-btn" onClick={() => setOpen((v) => !v)}>
        <i className="fa-solid fa-circle-user" />
        {nom}
        <i className={`fa-solid fa-chevron-${open ? "up" : "down"} lc-user-btn__chevron`} />
      </button>
      {open && (
        <div className="lc-user-dropdown" role="menu">
          <button
            type="button"
            role="menuitem"
            className="lc-user-dropdown__item"
            onClick={onLogout}
          >
            <i className="fa-solid fa-right-from-bracket" />
            Déconnexion
          </button>
        </div>
      )}
    </div>
  );
}

export default function ListeCandidatsPage() {
  const [status,        setStatus]        = useState<Status>("loading");
  const [orienteurNom,  setOrienteurNom]  = useState("");
  const [candidats,     setCandidats]     = useState<Candidat[]>([]);
  const [occToken,      setOccToken]      = useState<string | null>(null);
  const [ficheBase,     setFicheBase]     = useState("");
  const [showFaq,       setShowFaq]       = useState(false);

  useEffect(() => {
    const STORAGE_KEY = "emile_occ_token";
    const p           = new URLSearchParams(window.location.search);

    // Priorité : token dans l'URL, sinon token sauvegardé en session
    const token = p.get("token") ?? localStorage.getItem(STORAGE_KEY);

    if (!token) {
      setStatus("no_token");
      return;
    }

    setOccToken(token);

    // Calcule l'URL de base vers fiche-candidat (même domaine, même déploiement)
    const base = window.location.href
      .split("?")[0]
      .replace(/\/liste-candidats\/?$/, "/fiche-candidat");
    setFicheBase(base);

    const listUrl = process.env.NEXT_PUBLIC_OCC_LIST_URL;
    if (!listUrl) {
      setStatus("error");
      return;
    }

    const url = `${listUrl.replace(/\/$/, "")}?token=${encodeURIComponent(token)}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data?.status === "ok") {
          // Token valide → on le mémorise pour les prochaines visites
          localStorage.setItem(STORAGE_KEY, token);
          setOrienteurNom(data.orienteurNom ?? "");
          setCandidats(data.candidats ?? []);
          setStatus("ok");
        } else {
          // Token invalide ou expiré → on purge la session
          localStorage.removeItem(STORAGE_KEY);
          setStatus("invalid");
        }
      })
      .catch(() => setStatus("error")); // erreur réseau : on garde le token, c'est peut-être temporaire
  }, []);

  // ── Sections ──────────────────────────────────────────────────────────────
  const avecStatut   = candidats.filter((c) => !!c.statut);
  const sansStatut   = candidats.filter((c) => !c.statut);
  const showSections = avecStatut.length > 0 && sansStatut.length > 0;

  /**
   * Rendu d'une card candidat.
   * - Sans statut → bordure colorée par éligibilité, pas de chip statut.
   * - Avec statut → bordure bleue standard, chip statut affiché.
   */
  const renderCard = (c: Candidat) => {
    // Âge calculé depuis dateNaissance (bypass de la colonne formule Grist qui renvoie 0)
    const displayAge = computeAge(c.dateNaissance);
    const eligCls = !c.statut
      ? c.eligibilite === "✅ OK" ? " lc-item--eligible"
      : c.eligibilite === "❌ KO" ? " lc-item--non-eligible" : ""
      : "";
    return (
      <li key={c.id} className={`lc-item${eligCls}`}>
        {/* Ligne 1 — Nom + chips droite */}
        <div className="lc-item__header">
          <span className="lc-item__name">
            {[c.prenom, c.nom].filter(Boolean).join(" ") || "—"}
          </span>
          <div className="lc-item__chips-right">
            {c.eligibilite === "✅ OK" && (
              <span className="lc-chip lc-chip--eligible">Éligible<i className="fa-solid fa-check" /></span>
            )}
            {c.eligibilite === "❌ KO" && <EligibilitePopover c={c} />}
            {c.statut && (
              <span className={`lc-chip ${statutChipClass(c.statut)}`}>{c.statut}</span>
            )}
          </div>
        </div>
        {/* Ligne 2 — Référence */}
        {c.reference && (
          <div className="lc-item__ref">
            <RefChip reference={c.reference} createdAt={c.createdAt} />
          </div>
        )}
        {/* Ligne 3 — Chips info */}
        {(displayAge != null || c.genre || c.nationalite) && (
          <div className="lc-item__meta">
            {displayAge != null && (
              <AgeChip displayAge={displayAge} dateNaissance={c.dateNaissance} />
            )}
            {c.genre && (
              <span className="lc-chip"><i className="fa-solid fa-venus-mars" />{c.genre}</span>
            )}
            {c.nationalite && (
              <span className="lc-chip"><i className="fa-solid fa-passport" />{c.nationalite}</span>
            )}
          </div>
        )}
        {/* Ligne 4 — Contact + bouton */}
        <div className="lc-item__footer">
          <div className="lc-item__contact">
            <span className="lc-item__contact-item">
              <i className="fa-solid fa-envelope" />{c.email}
            </span>
            {c.tel && (
              <span className="lc-item__contact-item">
                <i className="fa-solid fa-phone" />{c.tel}
              </span>
            )}
          </div>
          <a
            href={`${ficheBase}?token=${occToken}&id=${c.id}`}
            className="lc-btn lc-btn--sm"
          >
            <i className="fa-solid fa-folder-open" />
            Voir la fiche
          </a>
        </div>
      </li>
    );
  };

  return (
    <div className="lc-shell">
      <header className="lc-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoEmile.src} alt="EMILE" style={{ height: "2rem", width: "auto" }} />
        <span className="lc-header__appname">Mes candidat·e·s</span>
        <div className="lc-header__spacer" />
        {orienteurNom && (
          <OrienteurMenu
            nom={orienteurNom}
            onLogout={() => {
              localStorage.removeItem("emile_occ_token");
              window.location.replace(window.location.pathname);
            }}
          />
        )}
        <button type="button" className="lc-faq-btn" onClick={() => setShowFaq(true)}>
          <i className="fa-solid fa-circle-question" />
          FAQ
        </button>
      </header>

      <main className="lc-body">

        {/* ── Chargement ── */}
        {status === "loading" && (
          <div className="lc-card lc-card--center">
            <div className="lc-spinner">
              <i className="fa-solid fa-spinner fa-spin" />
            </div>
            <p className="lc-message">Chargement de la liste…</p>
          </div>
        )}

        {/* ── Liste ── */}
        {status === "ok" && (
          <div className="lc-container">
            <div className="lc-page-header">
              <h1 className="lc-page-title">
                <i className="fa-solid fa-users" />
                {orienteurNom ? `Candidat·e·s de ${orienteurNom}` : "Mes candidat·e·s"}
              </h1>
              <span className="lc-badge">
                {candidats.length === 0
                  ? "Aucun candidat"
                  : candidats.length === 1
                  ? "1 candidat·e"
                  : `${candidats.length} candidat·e·s`}
              </span>
            </div>

            {candidats.length === 0 ? (
              <div className="lc-card lc-card--center">
                <i className="fa-solid fa-inbox lc-icon lc-icon--muted" />
                <p className="lc-message">Aucun candidat·e inscrit·e pour le moment.</p>
                <a href="/widgets/emile/inscription-candidat/" className="lc-btn">
                  <i className="fa-solid fa-user-plus" />
                  Inscrire un·e candidat·e
                </a>
              </div>
            ) : (
              <>
                {/* ── Section 1 — En accompagnement (candidats avec statut) ── */}
                {avecStatut.length > 0 && (
                  <>
                    {showSections && (
                      <div className="lc-section-header">
                        <h2 className="lc-section-title">
                          <i className="fa-solid fa-user-check" />
                          En accompagnement
                        </h2>
                        <span className="lc-badge lc-badge--sm">{avecStatut.length}</span>
                      </div>
                    )}
                    <ul className="lc-list">{avecStatut.map(renderCard)}</ul>
                  </>
                )}

                {/* ── Section 2 — Nouvelles inscriptions (candidats sans statut) ── */}
                {sansStatut.length > 0 && (
                  <>
                    {showSections && (
                      <div className="lc-section-header lc-section-header--new">
                        <div className="lc-section-header__top">
                          <h2 className="lc-section-title">
                            <i className="fa-solid fa-user-clock" />
                            Nouvelles inscriptions
                          </h2>
                          <span className="lc-badge lc-badge--sm">{sansStatut.length}</span>
                        </div>
                        <p className="lc-section-subtitle">
                          En attente de validation dans le programme
                        </p>
                      </div>
                    )}
                    <ul className="lc-list">{sansStatut.map(renderCard)}</ul>
                  </>
                )}
              </>
            )}

            {candidats.length > 0 && (
              <div className="lc-footer-actions">
                <a href="/widgets/emile/inscription-candidat/" className="lc-btn lc-btn--outline">
                  <i className="fa-solid fa-user-plus" />
                  Inscrire un·e autre candidat·e
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── Pas de token : invitation à se connecter ── */}
        {status === "no_token" && (
          <div className="lc-card lc-card--center">
            <i className="fa-solid fa-lock lc-icon lc-icon--warning" />
            <h2 className="lc-title">Connexion requise</h2>
            <p className="lc-message">
              Une connexion est nécessaire pour accéder à cet espace.<br />
              Utilisez votre lien personnel ou récupérez-le ci-dessous.
            </p>
            <a
              href="/grist-widgets/widgets/emile/recuperer-lien-connexion/"
              className="lc-btn"
              style={{ marginTop: "0.25rem" }}
            >
              <i className="fa-solid fa-envelope-open-text" />
              Récupérer mon lien de connexion
            </a>
          </div>
        )}

        {/* ── Token invalide / expiré ── */}
        {status === "invalid" && (
          <div className="lc-card lc-card--center">
            <i className="fa-solid fa-circle-xmark lc-icon lc-icon--error" />
            <h2 className="lc-title">Lien invalide</h2>
            <p className="lc-message">
              Ce lien est invalide ou a expiré.<br />
              Contactez votre administrateur·ice pour en obtenir un nouveau.
            </p>
          </div>
        )}

        {/* ── Erreur réseau ── */}
        {status === "error" && (
          <div className="lc-card lc-card--center">
            <i className="fa-solid fa-triangle-exclamation lc-icon lc-icon--warning" />
            <h2 className="lc-title">Erreur</h2>
            <p className="lc-message">
              Une erreur est survenue lors du chargement.<br />
              Veuillez réessayer ou contacter votre administrateur·ice.
            </p>
          </div>
        )}

      </main>

      {showFaq && (
        <FAQPanel
          proxyUrl={process.env.NEXT_PUBLIC_GRIST_PROXY_URL}
          onClose={() => setShowFaq(false)}
        />
      )}
    </div>
  );
}
