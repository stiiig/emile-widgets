"use client";

import { useState } from "react";
import "./styles.css";
import logoEmile from "../assets/logo-emile-white.png";
import { EMAIL_REGEX } from "@/lib/emile/validators";

type Status = "idle" | "loading" | "ok" | "not_found" | "error";

export default function RecupererLienConnexionPage() {
  const [email,      setEmail]      = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [status,     setStatus]     = useState<Status>("idle");
  const [lienUrl,    setLienUrl]    = useState<string | null>(null);
  const [copied,     setCopied]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!EMAIL_REGEX.test(email.trim())) {
      setEmailError("L'adresse email n'est pas valide.");
      return;
    }
    setEmailError(null);
    setStatus("loading");
    setLienUrl(null);
    setCopied(false);

    const requestUrl = process.env.NEXT_PUBLIC_OCC_REQUEST_LINK_URL;
    if (!requestUrl) {
      setStatus("error");
      return;
    }

    try {
      const res = await fetch(requestUrl.replace(/\/$/, ""), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.status === "ok" && data.url) {
        setLienUrl(data.url);
        setStatus("ok");
      } else if (data?.status === "not_found") {
        setStatus("not_found");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  async function handleCopy() {
    if (!lienUrl) return;
    try {
      await navigator.clipboard.writeText(lienUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* fallback silencieux */
    }
  }

  return (
    <div className="rlc-shell">
      <header className="rlc-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoEmile.src} alt="EMILE" style={{ height: "2rem", width: "auto" }} />
        <span className="rlc-header__appname">Accéder à mon espace</span>
      </header>

      <main className="rlc-body">
        <div className="rlc-card">
          <h1 className="rlc-title">
            <i className="fa-solid fa-link" />
            Recevoir mon lien de connexion
          </h1>
          <p className="rlc-subtitle">
            Saisissez l'adresse email associée à votre compte orienteur·rice.
            Vous recevrez un lien pour accéder à votre espace.
          </p>

          <form onSubmit={handleSubmit}>
            <label htmlFor="rlc-email" className="rlc-label">
              Adresse email
            </label>
            <input
              id="rlc-email"
              type="text"
              className={`rlc-input${emailError ? " rlc-input--error" : ""}`}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(null); setStatus("idle"); }}
              disabled={status === "loading"}
              autoComplete="email"
            />
            {emailError && (
              <span className="rlc-field-error">{emailError}</span>
            )}

            <button
              type="submit"
              className="rlc-btn"
              disabled={status === "loading" || !email.trim()}
            >
              {status === "loading" ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" />
                  Recherche en cours…
                </>
              ) : (
                <>
                  <i className="fa-solid fa-paper-plane" />
                  Recevoir mon lien
                </>
              )}
            </button>
          </form>

          {/* ── Lien généré (encart) ── */}
          {status === "ok" && lienUrl && (
            <div className="rlc-encart">
              <p className="rlc-encart__title">
                <i className="fa-solid fa-circle-check" />
                Voici votre lien de connexion
              </p>
              <div className="rlc-encart__url">{lienUrl}</div>
              <button
                type="button"
                className={`rlc-copy-btn${copied ? " rlc-copy-btn--copied" : ""}`}
                onClick={handleCopy}
              >
                {copied ? (
                  <>
                    <i className="fa-solid fa-check" />
                    Copié !
                  </>
                ) : (
                  <>
                    <i className="fa-regular fa-copy" />
                    Copier le lien
                  </>
                )}
              </button>
            </div>
          )}

          {/* ── Email introuvable ou erreur ── */}
          {(status === "not_found" || status === "error") && (
            <div className="rlc-alert rlc-alert--warning">
              <i className="fa-solid fa-triangle-exclamation" />
              <span>
                Aucun compte orienteur·rice trouvé avec cette adresse email.
                Vérifiez l'adresse ou contactez votre administrateur·ice.
              </span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
