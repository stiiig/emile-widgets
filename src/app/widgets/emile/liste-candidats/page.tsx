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
  age?: number | null;
  /** Timestamp Unix en secondes (format natif Grist pour les colonnes Date) */
  dateNaissance?: number | string | null;
  reference?: string | null;
  /** Libellé de la nationalité (colonne formule $Nationalite_Nom_du_pays) */
  nationalite?: string | null;
  /** Valeur du Choice Statut dans CANDIDATS */
  statut?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

  return (
    <div className="lc-shell">
      <header className="lc-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoEmile.src} alt="EMILE" style={{ height: "2rem", width: "auto" }} />
        <span className="lc-header__appname">Mes candidat·e·s</span>
        <div className="lc-header__spacer" />
        {orienteurNom && (
          <span className="lc-header__user">
            <i className="fa-solid fa-circle-user" />
            {orienteurNom}
          </span>
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
                <a
                  href="/widgets/emile/inscription-candidat/"
                  className="lc-btn"
                >
                  <i className="fa-solid fa-user-plus" />
                  Inscrire un·e candidat·e
                </a>
              </div>
            ) : (
              <ul className="lc-list">
                {candidats.map((c) => (
                  <li key={c.id} className="lc-item">
                    {/* Ligne 1 — Nom + statut */}
                    <div className="lc-item__header">
                      <span className="lc-item__name">
                        {[c.prenom, c.nom].filter(Boolean).join(" ") || "—"}
                      </span>
                      {c.statut && (
                        <span className={`lc-chip ${statutChipClass(c.statut)}`}>{c.statut}</span>
                      )}
                    </div>
                    {/* Ligne 2 — Référence */}
                    {c.reference && (
                      <div className="lc-item__ref">
                        <span className="lc-chip lc-chip--ref">{c.reference}</span>
                      </div>
                    )}
                    {/* Ligne 3 — Chips info */}
                    {(c.age != null || c.genre || c.nationalite) && (
                      <div className="lc-item__meta">
                        {c.age != null && (
                          <span
                            className="lc-chip"
                            data-tooltip={formatDate(c.dateNaissance)}
                          >
                            <i className="fa-solid fa-cake-candles" />{c.age} ans
                          </span>
                        )}
                        {c.genre && (
                          <span className="lc-chip"><i className="fa-solid fa-venus-mars" />{c.genre}</span>
                        )}
                        {c.nationalite && (
                          <span className="lc-chip"><i className="fa-solid fa-passport" />{c.nationalite}</span>
                        )}
                      </div>
                    )}
                    {/* Ligne 3 — Contact + bouton */}
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
                ))}
              </ul>
            )}

            {candidats.length > 0 && (
              <div className="lc-footer-actions">
                <a
                  href="/widgets/emile/inscription-candidat/"
                  className="lc-btn lc-btn--outline"
                >
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
