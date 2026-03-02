"use client";

import { useEffect, useState } from "react";
import "./styles.css";
import logoEmile from "../assets/logo-emile-white.png";
import { FAQPanel } from "@/components/FAQPanel";

type Status = "loading" | "ok" | "already_validated" | "invalid" | "no_token" | "error";

export default function ValidationComptePage() {
  const [status,  setStatus]  = useState<Status>("loading");
  const [nom,     setNom]     = useState("");
  const [showFaq, setShowFaq] = useState(false);

  useEffect(() => {
    const p     = new URLSearchParams(window.location.search);
    const token = p.get("token");

    if (!token) {
      setStatus("no_token");
      return;
    }

    const validateUrl = process.env.NEXT_PUBLIC_OCC_VALIDATE_URL;
    if (!validateUrl) {
      setStatus("error");
      return;
    }

    const url = `${validateUrl.replace(/\/$/, "")}?token=${encodeURIComponent(token)}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data?.status === "ok") {
          setNom(data.nom ?? "");
          setStatus("ok");
        } else if (data?.status === "already_validated") {
          setStatus("already_validated");
        } else {
          setStatus("invalid");
        }
      })
      .catch(() => setStatus("error"));
  }, []);

  return (
    <div className="vc-shell">
      <header className="vc-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoEmile.src} alt="EMILE" style={{ height: "2rem", width: "auto" }} />
        <span className="vc-header__appname">Validation compte orienteur·ice</span>
        <div className="vc-header__spacer" />
        <button type="button" className="vc-faq-btn" onClick={() => setShowFaq(true)}>
          <i className="fa-solid fa-circle-question" />
          FAQ
        </button>
      </header>

      <main className="vc-body">
        <div className="vc-card">

          {/* ── Chargement ── */}
          {status === "loading" && (
            <>
              <div className="vc-spinner">
                <i className="fa-solid fa-spinner fa-spin" />
              </div>
              <p className="vc-message">Vérification en cours…</p>
            </>
          )}

          {/* ── Compte activé ── */}
          {status === "ok" && (
            <>
              <i className="fa-solid fa-circle-check vc-icon vc-icon--success" />
              <h1 className="vc-title">Compte activé&nbsp;!</h1>
              {nom && (
                <p className="vc-subtitle">Bienvenue, <strong>{nom}</strong>&nbsp;!</p>
              )}
              <p className="vc-message">
                Votre compte orienteur·ice EMILE est maintenant actif.<br />
                Vous pouvez dès à présent inscrire des candidat·e·s.
              </p>
              <a href="/widgets/emile/inscription-candidat/" className="vc-btn">
                Inscrire un·e candidat·e <i className="fa-solid fa-arrow-right" />
              </a>
            </>
          )}

          {/* ── Déjà validé ── */}
          {status === "already_validated" && (
            <>
              <i className="fa-solid fa-circle-info vc-icon vc-icon--info" />
              <h1 className="vc-title">Compte déjà activé</h1>
              <p className="vc-message">
                Ce compte a déjà été validé.<br />
                Vous pouvez inscrire des candidat·e·s.
              </p>
              <a href="/widgets/emile/inscription-candidat/" className="vc-btn">
                Inscrire un·e candidat·e <i className="fa-solid fa-arrow-right" />
              </a>
            </>
          )}

          {/* ── Lien invalide / no_token ── */}
          {(status === "invalid" || status === "no_token") && (
            <>
              <i className="fa-solid fa-circle-xmark vc-icon vc-icon--error" />
              <h1 className="vc-title">Lien invalide</h1>
              <p className="vc-message">
                Ce lien de validation est invalide ou a expiré.<br />
                Contactez votre administrateur·ice pour en obtenir un nouveau.
              </p>
            </>
          )}

          {/* ── Erreur réseau ── */}
          {status === "error" && (
            <>
              <i className="fa-solid fa-triangle-exclamation vc-icon vc-icon--warning" />
              <h1 className="vc-title">Erreur</h1>
              <p className="vc-message">
                Une erreur est survenue lors de la validation.<br />
                Veuillez réessayer ou contacter votre administrateur·ice.
              </p>
            </>
          )}

        </div>
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
