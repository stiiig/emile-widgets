# EMILE — Widgets Grist

Interfaces React hébergées sur **GitHub Pages**, utilisées dans le cadre du projet EMILE (accompagnement de candidats par des orienteur·rice·s).

Les pages fonctionnent en deux modes :
- **Mode iframe** (intégré dans Grist) — accès aux données via `grist.docApi`
- **Mode standalone** (lien direct, magic link) — accès aux données via proxy n8n

---

## Pages disponibles

| Page | URL | Accès |
|------|-----|-------|
| Inscription candidat | `/widgets/emile/inscription-candidat/` | Public |
| Fiche candidat | `/widgets/emile/fiche-candidat/?token=X.HMAC` | Magic link signé |
| Création compte orienteur | `/widgets/emile/creation-compte-orienteur/` | Public |
| Validation compte orienteur | `/widgets/emile/validation-compte/?token=X.HMAC` | Magic link signé |
| Liste des candidats | `/widgets/emile/liste-candidats/?token=X.HMAC` | Magic link signé (orienteur) |
| Récupérer lien de connexion | `/widgets/emile/recuperer-lien-connexion/` | Public (orienteur) |
| Récupérer lien de validation | `/widgets/emile/recuperer-lien-validation/` | Public (orienteur) |

---

## Variables d'environnement

Toutes les variables `NEXT_PUBLIC_*` sont **baked au build** (export statique Next.js).
Elles sont définies comme secrets GitHub et injectées via `.github/workflows/deploy.yml`.

| Variable | Utilisée par | Pointe vers |
|----------|--------------|-------------|
| `NEXT_PUBLIC_GRIST_PROXY_URL` | `fiche-candidat`, `inscription-candidat` | Webhook n8n GET/POST |
| `NEXT_PUBLIC_GRIST_GENERATE_URL` | `inscription-candidat` | Webhook n8n `grist-generate` |
| `NEXT_PUBLIC_OCC_GENERATE_URL` | `creation-compte-orienteur` | Webhook n8n `occ-generate` |
| `NEXT_PUBLIC_OCC_VALIDATE_URL` | `validation-compte` | Webhook n8n `occ-validate` |
| `NEXT_PUBLIC_OCC_LIST_URL` | `liste-candidats` | Webhook n8n `occ-list` |
| `NEXT_PUBLIC_OCC_REQUEST_LINK_URL` | `recuperer-lien-connexion` | Webhook n8n `occ-request-link` |
| `NEXT_PUBLIC_OCC_REQUEST_VALIDATION_URL` | `recuperer-lien-validation` | Webhook n8n `occ-request-validation-link` |

---

## Architecture

Les widgets appellent Grist via **proxy n8n** (contournement CORS + isolation de la clé API).

Voir [`docs/architecture-proxy-n8n.md`](docs/architecture-proxy-n8n.md) pour le détail des 8 workflows, le format des tokens HMAC-SHA256 et les pièges CORS.

Voir [`docs/rest-mode.md`](docs/rest-mode.md) pour la configuration n8n pas-à-pas.

---

## Développement local

```bash
npm install
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000).

Les variables d'environnement doivent être définies dans un fichier `.env.local` (non versionné) :

```env
NEXT_PUBLIC_GRIST_PROXY_URL=https://n8n.exemple.fr/webhook/grist
NEXT_PUBLIC_GRIST_GENERATE_URL=https://n8n.exemple.fr/webhook/grist-generate
NEXT_PUBLIC_OCC_GENERATE_URL=https://n8n.exemple.fr/webhook/occ-generate
NEXT_PUBLIC_OCC_VALIDATE_URL=https://n8n.exemple.fr/webhook/occ-validate
NEXT_PUBLIC_OCC_LIST_URL=https://n8n.exemple.fr/webhook/occ-list
NEXT_PUBLIC_OCC_REQUEST_LINK_URL=https://n8n.exemple.fr/webhook/occ-request-link
NEXT_PUBLIC_OCC_REQUEST_VALIDATION_URL=https://n8n.exemple.fr/webhook/occ-request-validation-link
```

## Déploiement

Le déploiement est automatique via GitHub Actions (`main` → GitHub Pages) dès qu'un push est effectué sur la branche `main`.
