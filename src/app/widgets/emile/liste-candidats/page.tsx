"use client";

import { useEffect, useState } from "react";
import "./styles.css";
import logoEmile from "../assets/logo-emile-white.png";

type Status = "loading" | "ok" | "invalid" | "no_token" | "error";

interface Candidat {
  id: number;
  prenom: string;
  nom: string;
  email: string;
  lienAcces?: string | null;
  tel?: string | null;
  genre?: string | null;
  age?: number | null;
  reference?: string | null;
  nationalite?: string | null;
  statut?: string | null;
}

function statutChipClass(statut: string): string {
  if (statut === "À traiter")        return "lc-chip--statut-traiter";
  if (statut === "En cours")         return "lc-chip--statut-en-cours";
  if (statut === "Étape terminée")   return "lc-chip--statut-termine";
  if (statut.startsWith("Suspension")) return "lc-chip--statut-suspension";
  if (statut.startsWith("Sortie"))   return "lc-chip--statut-sortie";
  return "lc-chip--statut-traiter";
}

export default function ListeCandidatsPage() {
  const [status,        setStatus]        = useState<Status>("loading");
  const [orienteurNom,  setOrienteurNom]  = useState("");
  const [candidats,     setCandidats]     = useState<Candidat[]>([]);
  const [occToken,      setOccToken]      = useState<string | null>(null);
  const [ficheBase,     setFicheBase]     = useState("");

  useEffect(() => {
    const p     = new URLSearchParams(window.location.search);
    const token = p.get("token");

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
          setOrienteurNom(data.orienteurNom ?? "");
          setCandidats(data.candidats ?? []);
          setStatus("ok");
        } else {
          setStatus("invalid");
        }
      })
      .catch(() => setStatus("error"));
  }, []);

  return (
    <div className="lc-shell">
      <header className="lc-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoEmile.src} alt="EMILE" style={{ height: "2rem", width: "auto" }} />
        <span className="lc-header__appname">Mes candidat·e·s</span>
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
                    {/* Ligne 1 — Nom + référence + statut */}
                    <div className="lc-item__header">
                      <span className="lc-item__name">
                        {[c.prenom, c.nom].filter(Boolean).join(" ") || "—"}
                      </span>
                      <div className="lc-item__header-right">
                        {c.reference && (
                          <span className="lc-chip lc-chip--ref">
                            <i className="fa-solid fa-hashtag" />{c.reference}
                          </span>
                        )}
                        {c.statut && (
                          <span className={`lc-chip ${statutChipClass(c.statut)}`}>{c.statut}</span>
                        )}
                      </div>
                    </div>
                    {/* Ligne 2 — Chips info */}
                    {(c.age != null || c.genre || c.nationalite) && (
                      <div className="lc-item__meta">
                        {c.age != null && (
                          <span className="lc-chip"><i className="fa-solid fa-cake-candles" />{c.age} ans</span>
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

        {/* ── Lien invalide / no_token ── */}
        {(status === "invalid" || status === "no_token") && (
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
    </div>
  );
}
