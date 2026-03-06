// src/app/widgets/emile/airtable-to-grist/convert.ts
//
// Logique de conversion CSV Airtable → CSV Grist (côté client, aucun serveur).
// Appelé depuis page.tsx — aucune dépendance externe.

// ─── CSV parser/serializer ────────────────────────────────────────────────────

/**
 * Parseur CSV RFC 4180 complet.
 * Lit le fichier caractère par caractère pour gérer correctement les champs
 * entre guillemets contenant des sauts de ligne (ex. champs texte libre Airtable).
 * Un split("\n") naïf cassait ces champs multi-lignes.
 */
export function parseCSV(text: string): Record<string, string>[] {
  // Normalise les fins de ligne ; retire le BOM UTF-8 éventuel
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const allRows: string[][] = [];
  let currentRow: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }  // "" → guillemet littéral
        else inQuotes = false;                           // fin du champ quoté
      } else {
        field += ch;   // retours à la ligne inclus — c'est voulu
      }
    } else {
      if      (ch === '"') { inQuotes = true; }
      else if (ch === ',') { currentRow.push(field); field = ""; }
      else if (ch === '\n') {
        currentRow.push(field); field = "";
        allRows.push(currentRow); currentRow = [];
      } else {
        field += ch;
      }
    }
  }
  // Dernière ligne sans \n terminal
  if (field || currentRow.length > 0) {
    currentRow.push(field);
    allRows.push(currentRow);
  }

  if (allRows.length < 2) return [];
  const headers = allRows[0];
  return allRows
    .slice(1)
    .filter(row => row.some(cell => cell.trim()))   // ignore les lignes entièrement vides
    .map(vals => {
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = vals[idx] ?? ""; });
      return row;
    });
}

export function toCSV(rows: Record<string, string>[], headers: string[]): string {
  const esc = (v: string) =>
    v.includes(",") || v.includes('"') || v.includes("\n")
      ? '"' + v.replace(/"/g, '""') + '"'
      : v;
  return [
    headers.map(esc).join(","),
    ...rows.map(r => headers.map(h => esc(r[h] ?? "")).join(",")),
  ].join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** MM/DD/YYYY HH:MM[:SS] ou MM/DD/YYYY → ISO 8601 (Airtable CSV exporte en format américain) */
export function parseEuropeanDate(raw: string): string {
  const s = raw?.trim();
  if (!s) return "";
  const dtM = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dtM) {
    const [, mo, da, y, hh, mi, ss = "00"] = dtM;  // groupe 1 = MM, groupe 2 = DD
    return `${y}-${mo.padStart(2,"0")}-${da.padStart(2,"0")}T${hh.padStart(2,"0")}:${mi}:${ss}`;
  }
  const dM = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dM) {
    const [, mo, da, y] = dM;  // groupe 1 = MM, groupe 2 = DD
    return `${y}-${mo.padStart(2,"0")}-${da.padStart(2,"0")}`;
  }
  return s; // déjà ISO ou autre format inconnu
}

/**
 * Extrait le nom du département depuis une valeur Airtable pour matcher
 * la colonne $Nom_departement (données stockées) de DPTS_REGIONS dans Grist.
 *
 * La colonne visible $Numero_et_nom est une formule Grist → non matchable au CSV import.
 * On extrait uniquement le nom après " - " :
 *   "75 - Paris"            → "Paris"
 *   "93 - Seine-Saint-Denis"→ "Seine-Saint-Denis"
 *   "2A - Corse-du-Sud"     → "Corse-du-Sud"
 *   "Paris" (déjà un nom)   → "Paris"
 */
function normalizeDept(raw: string): string {
  const s = raw
    .trim()
    .replace(/\u2013|\u2014/g, "-")   // en dash / em dash → tiret simple
    .replace(/\u00A0/g, " ")           // espace insécable → espace normale
    .trim();
  const idx = s.indexOf(" - ");
  return idx >= 0 ? s.slice(idx + 3).trim() : s;
}

/** "Oui" / case cochée → true */
function isYes(val: string): boolean {
  const v = val?.trim().toLowerCase();
  return v === "oui" || v === "yes" || v === "true" || v === "1" || v === "✓";
}

/**
 * Format ChoiceList pour CSV import Grist : valeurs séparées par "\n".
 * (Le format JSON ["L",...] est le format interne Grist — au CSV import
 *  Grist traite "L" comme une valeur de choix littérale, d'où l'affichage [L].)
 */
function toChoiceList(values: string[]): string {
  const clean = values.filter(Boolean);
  return clean.join("\n");
}

// ─── ACCOMPAGNANTS ────────────────────────────────────────────────────────────

const ACC_DIRECT: [string, string][] = [
  ["Prénom accompagnant",    "Prenom"],
  ["Nom accompagnant",       "Nom"],
  ["Email accompagnant",     "Email"],
  ["Téléphone accompagnant", "Tel"],
  ["Fonction",               "Fonction"],
  ["Établissement",          "Etablissement"],
];

export const ACC_GRIST_HEADERS = [
  "Prenom", "Nom", "Email", "Tel", "Fonction", "Etablissement", "Date_ajout_Airtable",
];

export function convertAccompagnants(
  rows: Record<string, string>[],
): { headers: string[]; rows: Record<string, string>[] } {
  return {
    headers: ACC_GRIST_HEADERS,
    rows: rows.map(r => {
      const o: Record<string, string> = {};
      for (const [from, to] of ACC_DIRECT) o[to] = r[from] ?? "";
      o["Date_ajout_Airtable"] = parseEuropeanDate(r["Date d'ajout"] ?? "");
      return o;
    }),
  };
}

// ─── CANDIDATS — mapping direct 1:1 ──────────────────────────────────────────

const CAND_DIRECT: [string, string][] = [
  ["Prénom candidat",                   "Prenom"],
  ["Nom candidat",                      "Nom_de_famille"],
  ["Genre",                             "Genre"],
  ["Nationalité",                       "Nationalite"],
  ["Accompagnant identifié et engagé",  "AIE"],
  ["Niveau de langue",                  "Niveau_de_langue"],
  ["Niveau d'études reconnu en France", "Niveau_etudes_reconnu_en_France"],
  ["PMR",                               "PMR"],
  ["RQTH",                              "RQTH"],
  ["Adresse de domiciliation",          "Adresse"],
  ["Email candidat",                    "Email"],
  ["Téléphone candidat",                "Tel"],
  // Département géré via normalizeDept dans la boucle — voir convertCandidats
  ["Département domicile inscription",  "Departement_domicile_inscription"],
  ["Régularité situation",              "Regularite_situation"],
  ["Numéro unique d'enregistrement",    "Numero_unique_enregistrement"],
  ["Primo arrivants",                   "Primo_arrivant"],
  ["En précarité de logement",          "Precarite_de_logement"],
  ["Situation hébergement (sensibilisation)", "Situation_hebergement"],
  ["Situation hébergement (Installation)",    "Situation_hebergement_installation"],
  ["Situation financière (Sensibilisation)",  "Situation_financiere"],
  ["Situation face à l'emploi",         "Situation_face_emploi"],
  ["Besoin mise à l'abri",              "Besoin_mise_a_l_abri"],
  ["Besoin prise en charge enfant(s)",  "Besoin_prise_en_charge_enfant_s_"],
  ["Besoin accompagner conjoint(e) vers emploi / formation", "Besoin_accompagner_conjoint_e_vers_emploi_formation"],
  ["DLS formulée",                      "DLS_formulee"],
  ["Statut",                            "Statut"],
  ["Étape",                             "Etape"],
  ["Commentaire du statut",             "Commentaire_du_statut"],
  ["Motivation candidat",               "Motivation_candidat"],
  ["Autres initiatives personnelles favorables à l'emploi / formation", "Autres_initiatives_perso"],
  ["BPI",                               "Bpi"],
  ["Durée droits France Travail restants", "Droits_FT"],
  ["Situation de couple",               "Situation_de_couple"],
  ["Possession animal compagnie",       "Possession_animal_compagnie"],
  ["Nombre d'adultes (18 ans et plus)", "Nombre_adultes_18_ans_et_plus_"],
  ["Nombre enfants (0-2 ans)",          "Nombre_enfants_0_2_ans_"],
  ["Nombre enfants (3-5 ans)",          "Nombre_enfants_3_5_ans_"],
  ["Nombre enfants (6-17 ans)",         "Nombre_enfants_6_17_ans_"],
  ["Nombre total d'enfants du foyer",   "Nombre_total_enfants_du_foyer"],
  ["Nombre total de personnes du foyer","Nombre_total_de_personnes_du_foyer"],
  ["Réside en QPV",                     "Reside_en_QPV"],
  ["Avis d'expulsion (filtre)",         "Avis_expulsion2"],
  ["Violence intrafamiliale (filtre)",  "Violence_intrafamilliale"],
  ["Colocation Accord",                 "Colocation_accord"],
  ["Colocation commentaire",            "Colocation_commentaire"],
  ["Demande DALO",                      "Demande_DALO"],
  ["Détention d'un véhicule",           "Vehicule"],
  ["Détention du code",                 "Code_de_la_route"],
  ["Accompagnement mobilité nécessaire ou en cours", "Accompagnement_mobilite"],
  ["Accompagnement numérique nécessaire ou en cours","Accompagnement_numerique"],
  ["Actions numériques réalisables en autonomie",    "Actions_numeriques"],
  ["Secteur emploi actuel",             "Secteur_emploi_actuel"],
  ["Expériences récentes",              "Experiences_recentes"],
  ["Accompagnement Cap Emploi",         "Accompagnement_Cap_Emploi"],
  ["Métier du projet de coeur",         "Metier_du_projet_de_coeur"],
  ["Secteur du projet de coeur",        "Secteur_projet_coeur"],
  ["Métier du projet retenu pour Emile","Metier_du_projet_retenu_pour_Emile"],
  ["Secteur du projet retenu pour Emile","Secteur_projet_EMILE"],
  ["Formation relative au projet retenu pour Emile","Formation_relative_au_projet_retenu_pour_Emile"],
  ["PMSMP Appétence",                   "PMSMP_Appetence"],
  ["PMSMP Compétences",                 "PMSMP_Competences"],
  ["Adresse lieu de travail / formation","Adresse_lieu_de_travail_formation"],
  ["Intitulé du poste",                 "Intitule_du_poste"],
  ["Nom employeur / formateur",         "Nom_employeur_formateur"],
  // "Bilan(s) séjour(s) immersion" — skippé (non importé dans Grist)
  ["Volontariat mobilité",              "Volontariat_mobilite"],
  ["Composition du foyer",              "Foyer"],
  ["Responsable Candidat",              "Responsable_candidat"],
  ["Territoire(s) d'accueil souhaité(s)","Territoire_s_accueil_souhaite_s_"],
  ["Établissement(s) intéressé(s)",     "Etablissement_s_interesse_s_"],
  ["Complément info Administratif",     "Complement_info_Administratif"],
  ["Complément info DLS",               "Complement_info_DLS"],
  ["Complément info Emploi-Formation",  "Complement_info_Emploi_Formation"],
  ["Complément info Finances",          "Complement_info_Finances"],
  ["Complément info Foyer",             "Complement_info_Foyer"],
  ["Complément info Lecture-Écriture-Calcul","Complement_info_Lecture_Ecriture_Calcul"],
  ["Complément info Mobilité",          "Complement_info_Mobilite"],
  ["Complément info Numérique",         "Complement_info_Numerique"],
  ["Complément info Santé",             "Complement_info_Sante"],
];

const CAND_DATES: [string, string][] = [
  ["Date de naissance",             "Date_de_naissance"],
  ["Date de validité titre séjour", "Date_validite_titre_sejour"],
  ["Date prévue installation",      "Date_prevue_installation"],
  ["Installation effective",        "Installation_effective"],
  ["Date inscription (ARES)",       "Date_ajout_Airtable"],
  ["Last modified",                 "Date_derniere_modif_Airtable"],
];

// Permis : colonne Airtable → label dans la ChoiceList Grist
const PERMIS_COLS: [string, string][] = [
  ["Détention du permis A (moto)",                             "A"],
  ["Détention du permis AM (cyclomoteur)",                     "AM"],
  ["Détention du permis B (véhicules légers)",                 "B"],
  ["Détention du permis C (poids-lourds)",                     "C"],
  ["Détention du permis D (voyageurs - transports de personnes)", "D"],
  ["Détention du permis E (remorques)",                        "E"],
];

// Besoin_divers : colonnes booléennes Airtable → choices Grist
const BESOIN_DIVERS_COLS: [string, string][] = [
  ["Besoin accompagnement préparation CV",              "Accompagnement préparation CV"],
  ["Besoin accompagnement préparation entretien embauche","Accompagnement entretien embauche"],
  ["Besoin guidage accès aux droits",                   "Guidage accès aux droits"],
  ["Besoins spécifiques habitat",                       "Besoins spécifiques habitat"],
];

// Difficultes_diverses : colonnes booléennes Airtable → choices Grist
const DIFFICULTES_COLS: [string, string][] = [
  ["Difficultés dans les apprentissages",  "Apprentissages"],
  ["Difficultés calcul",                   "Calcul"],
  ["Difficultés français écrit",           "Français écrit"],
  ["Difficultés français oral",            "Français oral"],
  ["Difficultés français lecture",         "Français lecture"],
  ["Difficultés exercice certains métiers","Exercice certains métiers"],
  ["Difficulté d'ordre juridique",         "Ordre juridique"],
  ["Difficulté liée à démarche administrative","Démarche administrative"],
  ["Difficultés pour démarches en ligne",  "Démarches en ligne"],
];

// Colonnes texte à concaténer dans Difficultes_diverses_explications
const DIFF_DESC_COLS: string[] = [
  "Description difficultés dans les apprentissages",
  "Description difficultés calcul",
  "Description difficultés français écrit",
  "Description difficultés français oral",
  "Description difficultés français lecture",
  "Description difficultés exercice certains métiers",
];

export const CAND_GRIST_HEADERS: string[] = [
  ...CAND_DIRECT.map(([, to]) => to),
  ...CAND_DATES.map(([, to]) => to),
  "Permis",
  "Permis_statut",
  "Besoin_divers",
  "Difficultes_diverses",
  "Difficultes_diverses_explications",
];

export function convertCandidats(
  rows: Record<string, string>[],
): { headers: string[]; rows: Record<string, string>[] } {
  return {
    headers: CAND_GRIST_HEADERS,
    rows: rows.map(r => {
      const o: Record<string, string> = {};

      for (const [from, to] of CAND_DIRECT) {
        if (to === "Departement_domicile_inscription") {
          // RefList → texte brut matchant $Nom_departement de DPTS_REGIONS
          o[to] = normalizeDept(r[from] ?? "");
        } else {
          o[to] = r[from] ?? "";
        }
      }
      for (const [from, to] of CAND_DATES)  o[to] = parseEuropeanDate(r[from] ?? "");

      // Toggles Grist (booléen) — Airtable : checkbox ou "Oui"/"Non"
      o["Primo_arrivant"] = isYes(o["Primo_arrivant"]) ? "true" : "false";
      o["Bpi"]            = isYes(o["Bpi"])            ? "true" : "false";

      // Vehicule — ChoiceList (multiselect Airtable séparé par virgule)
      const vehiculeRaw = o["Vehicule"];
      o["Vehicule"] = toChoiceList(
        vehiculeRaw ? vehiculeRaw.split(",").map(v => v.trim()).filter(Boolean) : [],
      );

      // Permis
      const permisChoices: string[] = [];
      let permisStatut = "";
      for (const [col, label] of PERMIS_COLS) {
        const val = r[col]?.trim() ?? "";
        if (val === "Oui") {
          permisChoices.push(label);
        } else if (!permisStatut && (val === "En cours de préparation" || val === "Actuellement suspendu")) {
          permisStatut = val;
        }
      }
      o["Permis"]        = toChoiceList(permisChoices);
      o["Permis_statut"] = permisStatut;

      // Besoin_divers
      o["Besoin_divers"] = toChoiceList(
        BESOIN_DIVERS_COLS.filter(([col]) => isYes(r[col] ?? "")).map(([, label]) => label),
      );

      // Difficultes_diverses
      o["Difficultes_diverses"] = toChoiceList(
        DIFFICULTES_COLS.filter(([col]) => isYes(r[col] ?? "")).map(([, label]) => label),
      );

      // Difficultes_diverses_explications (concaténation des descriptions non vides)
      o["Difficultes_diverses_explications"] = DIFF_DESC_COLS
        .map(col => r[col]?.trim())
        .filter(Boolean)
        .join(" | ");

      return o;
    }),
  };
}

// ─── ETABLISSEMENTS ───────────────────────────────────────────────────────────

const ETAB_DIRECT: [string, string][] = [
  ["Nom établissement",     "Nom_etablissement"],
  ["Dispositif",            "Dispositif"],
  ["Organisme gestionnaire","Organisme_gestionnaire"],
  // Département géré séparément (normalizeDept) pour matcher DPTS_REGIONS dans Grist
];

export const ETAB_GRIST_HEADERS = [
  "Nom_etablissement", "Dispositif", "Organisme_gestionnaire",
  "Departement", "Role", "Date_ajout_Airtable",
];

export function convertEtablissements(
  rows: Record<string, string>[],
): { headers: string[]; rows: Record<string, string>[] } {
  return {
    headers: ETAB_GRIST_HEADERS,
    rows: rows.map(r => {
      const o: Record<string, string> = {};
      for (const [from, to] of ETAB_DIRECT) o[to] = r[from] ?? "";
      o["Departement"] = normalizeDept(r["Département"] ?? "");
      // Rôle — multiselect Airtable (virgule) → ChoiceList Grist
      const roleRaw = r["Rôle"]?.trim() ?? "";
      o["Role"] = roleRaw
        ? toChoiceList(roleRaw.split(",").map(v => v.trim()).filter(Boolean))
        : "";
      // Date de création Airtable (nom de colonne variable selon le plan Airtable)
      o["Date_ajout_Airtable"] = (
        r["CreatedAt"] || r["Created"] || r["Created time"] || r["Date de création"] || ""
      ).trim();
      return o;
    }),
  };
}
