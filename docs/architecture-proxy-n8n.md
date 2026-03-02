# Architecture proxy n8n — Gestion déportée de Grist

*Document technique — contexte, choix d'architecture, état actuel*

---

## Contexte

Les widgets EMILE sont des interfaces React hébergées sur **GitHub Pages** (`stiiig.github.io`). En mode normal, ils tournent dans un **iframe embarqué dans Grist** : c'est le plugin Grist qui leur fournit l'accès aux données via `grist.docApi` (une API JavaScript injectée dans l'iframe).

Ce mode fonctionne bien pour les utilisateurs qui ouvrent Grist. Il ne couvre pas deux besoins clés :

- **Magic links** — envoyer un lien par email ou SMS à un candidat pour qu'il consulte/complète son dossier, sans qu'il ait accès à Grist
- **Formulaires publics** — `ajout-etablissement`, `creation-compte-orienteur` accessibles sans compte Grist

L'objectif : faire fonctionner ces widgets **hors iframe**, en appelant directement l'API Grist depuis le navigateur.

---

## Pourquoi on ne peut pas appeler Grist directement depuis le browser

Deux obstacles rendent l'appel direct impossible :

### 1. CORS

Le navigateur applique la politique *Same-Origin* : un script chargé depuis `stiiig.github.io` ne peut pas faire de requête vers `grist.incubateur.dnum.din.developpement-durable.gouv.fr` sauf si ce dernier répond avec le header `Access-Control-Allow-Origin: *`. L'instance Grist interne ne le fait pas — les appels sont bloqués avant même d'atteindre le serveur.

### 2. Clé API exposée

L'API Grist REST exige un `Authorization: Bearer <clé>` sur chaque requête. Si on appelle Grist depuis le browser, la clé est visible dans le JS du bundle ou dans les DevTools — n'importe qui peut la récupérer et lire ou modifier toute la base de données.

> **Note** : ce problème sera partiellement résolu par une **clé de service** (compte applicatif Grist avec permissions restreintes à lecture/écriture sur les tables EMILE uniquement, sans accès admin). En attente de provisionnement côté infra. Même avec une clé de service, le problème CORS reste entier — le proxy reste nécessaire.

---

## Solution : proxy n8n

**n8n** est la plateforme d'automatisation déjà déployée sur l'infra. Elle est accessible depuis internet et gère le CORS côté serveur.

```
Browser (GitHub Pages)
      │
      │  GET https://n8n.incubateur.dnum.../webhook/grist?table=CANDIDATS&token=ID.HMAC
      │  (pas de clé API, pas de contrainte CORS)
      ▼
n8n (accessible publiquement)
      │  vérifie HMAC-SHA256 du token
      │  Authorization: Bearer <clé API>   ← jamais vue par le browser
      │  GET https://grist.incubateur.dnum.../api/docs/{docId}/tables/CANDIDATS/records
      ▼
Grist (réseau interne, inaccessible depuis internet)
      │  {"records": [...]}
      ▼
n8n → ajoute Access-Control-Allow-Origin: *
      ▼
Browser → données disponibles dans React
```

Le proxy joue quatre rôles :
1. **Contournement CORS** — il appelle Grist server-side, sans contrainte cross-origin
2. **Isolation de la clé API** — elle reste dans les credentials n8n, jamais dans le bundle JS
3. **Passerelle réseau** — Grist est sur le réseau interne, n8n peut l'atteindre, le browser non
4. **Vérification du magic link** — HMAC-SHA256 vérifié côté n8n, secret jamais exposé

---

## Architecture actuelle — huit workflows n8n

### Workflow GET — lecture + téléchargement + vérification magic link fiche-candidat

```
Webhook GET (?table=X&token=ID.HMAC  ou  ?table=X&filter=JSON  ou  ?attachId=Y)
    │
    ▼
IF query.token est présent
    ├─ True  → Code (extrait rowId + sig)
    │          → Crypto HMAC-SHA256 (même secret que GENERATE)
    │          → IF sig === HMAC calculé
    │              ├─ True  → IF query.attachId est présent
    │              │           ├─ True  → GET /attachments/{id}/download → Respond Binary
    │              │           └─ False → GET /tables/CANDIDATS/records?filter={"id":[rowId]}
    │              └─ False → Respond 403 { "error": "Token invalide" }
    │
    └─ False → IF query.attachId est présent
                ├─ True  → GET /attachments/{id}/download → Respond Binary
                └─ False → GET /tables/{table}/records    → Respond JSON
```

La branche **faux** (pas de token) couvre toutes les requêtes de métadonnées et de tables de référence qui ne nécessitent pas de vérification (`_grist_Tables`, `_grist_Tables_column`, `DPTS_REGIONS`, etc.).

> ⚠️ **Piège critique** : la branche **faux** du IF token doit pointer vers **IF attachId**, pas vers un Respond 403. Les requêtes de métadonnées (`_grist_Tables`, etc.) n'ont jamais de token — si elles tombent sur un 403, le widget ne peut plus charger les types de colonnes et les dropdowns.

### Workflow POST — écritures Grist (AddRecord/UpdateRecord) + upload de pièces jointes

Le workflow POST gère deux cas selon le `Content-Type` de la requête entrante :

```
Webhook POST
    │
    ▼
IF Content-Type contient "text/plain"
    │
    ├─ True  → Code (JSON.parse du body texte → extrait table, _action, id, fields)
    │           │
    │           IF _action = "update"
    │           ├─ True  → Code (build PATCH body)
    │           │           → HTTP Request PATCH /tables/{table}/records (body JSON { records:[{id,fields}] })
    │           │               → Respond JSON {} + CORS header
    │           │
    │           └─ False → Code (build POST body)
    │                       → HTTP Request POST /tables/{table}/records (body JSON { records:[{fields}] })
    │                           → Code { retValues: [newId] }
    │                               → Respond JSON { retValues: [newId] } + CORS header
    │
    └─ False → (multipart/form-data — upload de pièce jointe)
                HTTP Request POST /attachments (Form-Data, champ upload, Bearer Auth)
                    → Respond JSON { data: "[42]" } + CORS header
```

**Clé : éviter le preflight CORS OPTIONS**

Ni les écritures ni l'upload ne déclenchent de preflight, parce que :
- `text/plain;charset=UTF-8` sans header custom → *simple CORS request* (spec WHATWG Fetch)
- `multipart/form-data` sans header custom → également une *simple CORS request*

À l'inverse, `Content-Type: application/json` ou la méthode `PATCH` depuis le navigateur déclenchent un preflight OPTIONS que n8n ne gère pas. La solution consiste à n'utiliser que `text/plain` côté `rest.ts` pour toutes les écritures — le champ `_action` dans le body JSON permet à n8n de distinguer AddRecord d'UpdateRecord.

Le code `rest.ts` parse la réponse de manière défensive car n8n sérialise les tableaux JSON de manière non déterministe selon sa version (`{"data":"[42]"}`, `[42]`, ou des objets items `{json: 42, pairedItem: ...}`).

### Workflow GENERATE — génération de magic links fiche-candidat

```
Webhook GET /webhook/grist-generate?rowId=X
    │
    ▼
Code (extrait rowId depuis $json.query.rowId)
    │
    ▼
Crypto HMAC-SHA256 (même secret que le workflow GET)
    │
    ▼
Code (construit token = rowId.HMAC et URL complète → fiche-candidat?token=X.HMAC)
    │
    ▼
Respond to Webhook { rowId, token, url }  ← le frontend reçoit l'URL immédiatement
    │
    ▼
Code (construit body PATCH)
    │
    ▼
HTTP PATCH CANDIDATS.Lien_acces = url  ← sauvegarde en background dans Grist
```

Génère un token signé `rowId.HMAC` pour un candidat donné. Appelé automatiquement par le formulaire `inscription-candidat` après la création du candidat, ou manuellement via un script.

**Clé : Respond to Webhook AVANT le PATCH Grist** — n8n continue l'exécution du workflow après avoir répondu au browser. Le frontend reçoit `{rowId, token, url}` sans attendre la mise à jour Grist. Le champ `Lien_acces` dans `CANDIDATS` est mis à jour en arrière-plan.

**Pas d'authentification côté webhook** — le formulaire appelle ce GET sans header custom (pas de preflight CORS). La sécurité repose sur :
- l'obscurité de l'URL du webhook
- le secret HMAC : même en connaissant l'URL, on ne peut pas forger un token valide sans le secret
- en production : possibilité d'ajouter une restriction IP côté n8n si nécessaire

### Workflow OCC-GENERATE — génération de magic links orienteur

```
Webhook GET /webhook/occ-generate?rowId=X
    │
    ▼
Code (extrait rowId depuis $json.query.rowId)
    │
    ▼
Crypto HMAC-SHA256 (même secret EMILE HMAC Secret)
    │
    ▼
Code (construit token = rowId.HMAC et URL → validation-compte?token=X.HMAC)
    │
    ▼
Respond to Webhook { rowId, token, url }  ← frontend reçoit l'URL immédiatement
    │
    ▼
Code (construit body PATCH)
    │
    ▼
HTTP PATCH ACCOMPAGNANTS.Lien_validation = url  ← sauvegarde en background dans Grist
```

OCC = **Orienteur Compte Créer**. Génère un lien d'activation de compte orienteur. Appelé automatiquement par `creation-compte-orienteur` après AddRecord dans `ACCOMPAGNANTS`. Même pattern HMAC que GENERATE, même credential secret — seule l'URL de destination change (`validation-compte` au lieu de `fiche-candidat`).

### Workflow OCC-REQUEST-LINK — renvoi du lien de connexion orienteur

```
Webhook POST /webhook/occ-request-link  { email }
    │
    ▼
Code (normalise email en minuscules)
    │
    ▼
HTTP GET ACCOMPAGNANTS?filter={"Email":[email]}
    │
    ▼
Code (extrait rowId du premier enregistrement trouvé)
    │
    ▼
IF rowId trouvé
    ├─ False → Respond { "status": "not_found" }
    └─ True  → HTTP GET /webhook/occ-generate?rowId=X
                │
                ▼
               Code (extrait le token depuis la réponse)
                │
                ▼
               Code (construit l'URL liste-candidats?token=X.HMAC)
                │
                ▼
               Respond { "status": "ok", "url": "https://.../liste-candidats/?token=..." }
```

Appelé par la page `recuperer-lien-connexion`. Renvoie un lien pointant vers
`liste-candidats` (espace de travail de l'orienteur·rice).

> ⚠️ **Attention au champ `url` de occ-generate** : ce workflow retourne une `url`
> qui pointe vers `validation-compte` (lien créé à la genèse du compte). Il ne faut
> **pas** utiliser ce champ directement — le Code node reconstruit l'URL manuellement
> avec le token extrait, en ciblant `liste-candidats`.

---

### Workflow OCC-REQUEST-VALIDATION-LINK — renvoi du lien de validation orienteur

```
Webhook POST /webhook/occ-request-validation-link  { email }
    │
    ▼
(idem OCC-REQUEST-LINK jusqu'à la résolution du rowId)
    │
    ▼
IF rowId trouvé
    ├─ False → Respond { "status": "not_found" }
    └─ True  → HTTP GET /webhook/occ-generate?rowId=X
                │
                ▼
               Respond { "status": "ok", "url": $json.url }
               ← utilise directement l'url validation-compte retournée par occ-generate
```

Appelé par la page `recuperer-lien-validation`. Contrairement à OCC-REQUEST-LINK,
utilise directement le champ `url` de occ-generate car il pointe déjà vers
`validation-compte`.

---

### Workflow OCC-LIST — liste des candidats d'un orienteur

```
Webhook GET /webhook/occ-list?token=X.HMAC
    │
    ▼
Code (extrait rowId + sig du token)
    │
    ▼
Crypto HMAC-SHA256 (credential EMILE HMAC Secret)
    │
    ▼
IF sig === HMAC calculé
    ├─ False → Respond { "status": "invalid" }
    └─ True  → HTTP GET ACCOMPAGNANTS?filter={"id":[rowId]}
                │  (récupère le nom de l'orienteur)
                ▼
               HTTP GET CANDIDATS?filter={"Responsable_candidat":[rowId]}
                │  (récupère les candidats rattachés)
                ▼
               Code (formate la réponse)
                │  Pour chaque candidat : id, prenom, nom, email, tel,
                │  genre, age, dateNaissance, reference, nationalite, statut
                ▼
               Respond {
                 "status": "ok",
                 "orienteurNom": "Prénom Nom",
                 "candidats": [...]
               }
```

Appelé par la page `liste-candidats` au chargement. Le token est le même format
que les autres workflows OCC (`rowId.HMAC`) — l'orienteur est donc identifié de
manière cryptographiquement vérifiée sans session ni cookie.

> **Champ `Responsable_candidat`** : colonne Reference dans CANDIDATS pointant vers
> ACCOMPAGNANTS. Grist renvoie un rowId entier — le filtre doit utiliser l'entier,
> pas le nom affiché.

---

### Workflow OCC-VALIDATE — vérification et activation du compte orienteur

```
Webhook GET /webhook/occ-validate?token=X.HMAC
    │
    ▼
Code (extrait rowId + sig du token)
    │
    ▼
Crypto HMAC-SHA256 (credential EMILE HMAC Secret)
    │
    ▼
IF sig === HMAC calculé
    ├─ False → Respond { "status": "invalid" }
    │
    └─ True  → HTTP GET ACCOMPAGNANTS?filter={"id":[rowId]}
                │
                ▼
               Code (extrait Compte_valide)
                │
                ▼
               IF Compte_valide === "Oui"
                ├─ True  → Respond { "status": "already_validated" }
                └─ False → HTTP PATCH Compte_valide = "Oui"
                              → Respond { "status": "ok", "nom": "..." }
```

Appelé par la page `validation-compte` au chargement. Vérifie le token, lit le compte dans `ACCOMPAGNANTS`, et passe `Compte_valide` de `"En attente"` à `"Oui"` si le token est valide et que le compte n'était pas encore activé.

---

## Ce que ça permet concrètement

Sans modifier Grist, sans plugin, sans compte Grist côté utilisateur :

| Fonctionnalité | Workflow | Page appelante |
|----------------|----------|----------------|
| Afficher la fiche d'un candidat via lien signé | GET `?table=CANDIDATS&token=ID.HMAC` | `fiche-candidat` |
| Charger les listes déroulantes (départements, établissements…) | GET `?table=DPTS_REGIONS` etc. | `fiche-candidat`, `inscription-candidat` |
| Lire les types/options de colonnes | GET `?table=_grist_Tables` + `_grist_Tables_column` | `fiche-candidat` |
| Afficher les pièces jointes (noms) | GET `?table=_grist_Attachments` | `fiche-candidat` |
| Télécharger une pièce jointe | GET `?attachId=42` → binaire | `fiche-candidat` |
| Uploader une pièce jointe | POST `multipart/form-data` | `fiche-candidat` |
| Soumettre le formulaire d'inscription (AddRecord) | POST `text/plain { _action:"add", fields }` | `inscription-candidat` |
| Générer un magic link fiche-candidat | GET `occ-generate?rowId=X` + sauvegarde `Lien_acces` dans CANDIDATS | `inscription-candidat` (automatique) |
| Générer un magic link orienteur (OCC) | GET `occ-generate?rowId=X` + sauvegarde `Lien_validation` dans ACCOMPAGNANTS | `creation-compte-orienteur` (automatique) |
| Activer un compte orienteur via lien signé | GET `occ-validate?token=ID.HMAC` → passe `Compte_valide` à `"Oui"` | `validation-compte` |
| Lister les candidats d'un orienteur | GET `occ-list?token=ID.HMAC` | `liste-candidats` |
| Renvoyer le lien de connexion orienteur (liste-candidats) | POST `occ-request-link { email }` | `recuperer-lien-connexion` |
| Renvoyer le lien de validation de compte orienteur | POST `occ-request-validation-link { email }` | `recuperer-lien-validation` |

---

## Sécurité du magic link

### Token format (commun à tous les workflows)

```
token = rowId + "." + HMAC-SHA256(rowId.toString(), SECRET)
```

- **rowId** — identifiant de l'enregistrement Grist (entier) : rowId dans `CANDIDATS` pour fiche-candidat, rowId dans `ACCOMPAGNANTS` pour OCC
- **HMAC-SHA256** — signature cryptographique avec un secret partagé entre les workflows n8n
- **SECRET** — stocké uniquement dans les credentials n8n (credential `EMILE HMAC Secret` de type Crypto), jamais dans le code ni dans le repo

> ⚠️ Les workflows GENERATE, OCC-GENERATE et OCC-VALIDATE utilisent **tous le même credential** `EMILE HMAC Secret`. Un token généré par GENERATE ne peut pas être utilisé sur OCC-VALIDATE (et vice versa) car les rowIds appartiennent à des tables différentes — mais techniquement la signature est valide. Si une isolation renforcée est souhaitée, utiliser deux credentials secrets distincts.

### Propriétés

| Propriété | Valeur |
|-----------|--------|
| Forgeable sans le secret | ❌ Non |
| Expiration | ❌ Permanent (pas d'expiration) |
| Révocable | ⚠️ Uniquement en changeant le secret (invalide **tous** les tokens — fiche-candidat ET orienteur) |
| Lié à un enregistrement spécifique | ✅ Oui (rowId dans le token) |

### Fallback dev

Le paramètre `?rowId=123` (sans signature) est conservé comme **fallback de développement** uniquement — le workflow GET n'exige pas de token pour les requêtes sans `?token=`. Ne pas utiliser en production.

---

## Limitations et chantiers ouverts

### ~~Sauvegarde et soumission de formulaires~~ — ✅ Résolu

La soumission du formulaire `inscription-candidat` (AddRecord) est opérationnelle en mode REST. La technique retenue : `rest.ts` envoie toutes les écritures avec `Content-Type: text/plain;charset=UTF-8` (pas de preflight CORS), et le workflow POST n8n détecte ce Content-Type via un nœud IF pour router vers la branche AddRecord/UpdateRecord. Le champ `_action` dans le body JSON permet de distinguer les deux opérations.

Voir le workflow POST dans `docs/rest-mode.md` pour la configuration n8n détaillée.

### Clé de service Grist

Actuellement la clé API configurée dans n8n est une clé personnelle. Une **clé de service** (compte applicatif, permissions minimales, rotation sans impact humain) est nécessaire pour la production. En attente de provisionnement côté infra Grist.

### Expiration des tokens

Les magic links sont permanents. Pour des dossiers sensibles, une expiration (date butoir dans le token, vérifiée par n8n) pourrait être ajoutée ultérieurement.

---

## Fichiers concernés dans le repo

| Fichier | Rôle |
|---------|------|
| `src/lib/grist/rest.ts` | Client REST — implémente `GristDocAPI` via proxy n8n |
| `src/lib/grist/init.ts` | Détecte `NEXT_PUBLIC_GRIST_PROXY_URL` et bascule en mode REST |
| `src/lib/grist/meta.ts` | Charge métadonnées colonnes via `_grist_Tables` |
| `src/components/AttachmentField.tsx` | Gestion pièces jointes (affichage, download fetch+blob, upload) |
| `src/app/widgets/emile/inscription-candidat/page.tsx` | Formulaire d'inscription — AddRecord via `text/plain` + génération magic link fiche-candidat (`NEXT_PUBLIC_GRIST_GENERATE_URL`) |
| `src/app/widgets/emile/creation-compte-orienteur/page.tsx` | Formulaire création compte orienteur — AddRecord ACCOMPAGNANTS + génération magic link OCC (`NEXT_PUBLIC_OCC_GENERATE_URL`) |
| `src/app/widgets/emile/validation-compte/page.tsx` | Activation compte orienteur — `NEXT_PUBLIC_OCC_VALIDATE_URL?token=X.HMAC` |
| `src/app/widgets/emile/liste-candidats/page.tsx` | Espace orienteur — liste ses candidats via `NEXT_PUBLIC_OCC_LIST_URL?token=X.HMAC`, chips colorés, tooltip date de naissance |
| `src/app/widgets/emile/recuperer-lien-connexion/page.tsx` | Renvoi du lien liste-candidats par email — `NEXT_PUBLIC_OCC_REQUEST_LINK_URL` |
| `src/app/widgets/emile/recuperer-lien-validation/page.tsx` | Renvoi du lien validation-compte par email — `NEXT_PUBLIC_OCC_REQUEST_VALIDATION_URL` |
| `docs/rest-mode.md` | Config n8n pas-à-pas avec tous les pièges rencontrés |
