// Page de test — liste tous les widgets EMILE
// Accessible sur /dev/links (local) ou https://stiiig.github.io/grist-widgets/dev/links

const BASE = "https://stiiig.github.io/grist-widgets/widgets/emile";

const WIDGETS = [
  {
    name: "Inscription candidat·e",
    path: "inscription-candidat",
    desc: "Formulaire d'inscription d'un·e candidat·e par un orienteur (mode Grist iframe)",
    params: [],
  },
  {
    name: "Fiche candidat·e",
    path: "fiche-candidat",
    desc: "Consultation / modification d'une fiche candidat",
    params: [
      { label: "Orienteur loggué (auto-select)", qs: "" },
      { label: "Orienteur + candidat précis", qs: "?token=OCC_TOKEN&id=ROW_ID" },
      { label: "Connexion requise (no token)", qs: "?reset" },
    ],
  },
  {
    name: "Liste des candidats",
    path: "liste-candidats",
    desc: "Liste des candidat·e·s d'un orienteur (session localStorage ou ?token=)",
    params: [
      { label: "Avec token OCC", qs: "?token=OCC_TOKEN" },
      { label: "Sans token (Connexion requise)", qs: "" },
    ],
  },
  {
    name: "Validation de compte",
    path: "validation-compte",
    desc: "Active le compte orienteur depuis l'email de validation",
    params: [
      { label: "Avec token valide", qs: "?token=ROW_ID.HMAC" },
      { label: "Sans token (Lien invalide)", qs: "" },
    ],
  },
  {
    name: "Création de compte orienteur",
    path: "creation-compte-orienteur",
    desc: "Formulaire de création de compte orienteur (mode Grist iframe)",
    params: [],
  },
  {
    name: "Ajout d'établissement",
    path: "ajout-etablissement",
    desc: "Formulaire d'ajout d'un établissement (mode Grist iframe)",
    params: [],
  },
  {
    name: "Récupérer lien de connexion",
    path: "recuperer-lien-connexion",
    desc: "Envoi du lien de connexion par email à l'orienteur",
    params: [],
  },
  {
    name: "Récupérer lien de validation",
    path: "recuperer-lien-validation",
    desc: "Envoi du lien de validation de compte par email à l'orienteur",
    params: [],
  },
] as const;

export default function DevLinks() {
  return (
    <main style={{
      fontFamily: "'Marianne', 'Helvetica Neue', Arial, sans-serif",
      fontSize: "0.9rem",
      color: "#1e1e1e",
      maxWidth: 760,
      margin: "0 auto",
      padding: "2.5rem 1.5rem",
    }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.3rem", fontWeight: 700, margin: "0 0 0.35rem" }}>
          🔗 Liens de test — Widgets EMILE
        </h1>
        <p style={{ color: "#666", margin: 0, fontSize: "0.8rem" }}>
          Base : <code style={{ background: "#f0f0f0", padding: "0.1rem 0.4rem", borderRadius: 3 }}>{BASE}</code>
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {WIDGETS.map((w) => {
          const url = `${BASE}/${w.path}/`;
          return (
            <div key={w.path} style={{
              background: "#fff",
              border: "1px solid #e0e0e0",
              borderLeft: "3px solid #000091",
              borderRadius: 6,
              padding: "1rem 1.25rem",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.35rem" }}>
                <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{w.name}</span>
                <code style={{ fontSize: "0.75rem", color: "#000091", background: "#e3e3fd", padding: "0.1rem 0.45rem", borderRadius: 3 }}>
                  {w.path}
                </code>
              </div>
              <p style={{ color: "#555", margin: "0 0 0.6rem", fontSize: "0.8rem" }}>{w.desc}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                {w.params.length === 0 ? (
                  <a href={url} target="_blank" rel="noreferrer" style={linkStyle}>
                    {url}
                  </a>
                ) : (
                  w.params.map((p) => (
                    <div key={p.qs} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <a href={`${url}${p.qs}`} target="_blank" rel="noreferrer" style={linkStyle}>
                        {url}{p.qs}
                      </a>
                      <span style={{ fontSize: "0.7rem", color: "#888", whiteSpace: "nowrap" }}>— {p.label}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}

const linkStyle: React.CSSProperties = {
  color: "#000091",
  fontSize: "0.78rem",
  fontFamily: "monospace",
  wordBreak: "break-all",
};
