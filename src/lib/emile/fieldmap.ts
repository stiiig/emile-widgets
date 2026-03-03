// src/lib/emile/fieldmap.ts
import type { L1TabKey } from "@/lib/emile/tabs";
import { GROUPS } from "@/lib/emile/groups";

export type SubtabKey = string;

/**
 * Mapping de colonnes (colId Grist) par (tab L1, subtab L2).
 * Les colonnes formules (isFormula=true) sont affichées en lecture seule.
 */
export const FIELD_MAP: Record<L1TabKey, Record<SubtabKey, string[]>> = {

  /* ── ADMINISTRATIF ─────────────────────────────────────────── */
  administratif: {
    infos_perso:     GROUPS.perso,
    coordonnees:     GROUPS.coord,
    situation_admin: GROUPS.admin,
    besoins:         GROUPS.besoins,
    complements:     GROUPS.complements,
  },

  /* ── DLS ────────────────────────────────────────────────────── */
  dls: {
    status: [
      "DLS_formulee",
      "Statut",
      "Etape",
      "Responsable_candidat",
      "Commentaire_du_statut",
      "Complement_info_DLS",
    ],
    pieces_admin: [
      "Document_identite_sejour_candidats",
      "Document_identite_sejour_autres_personnes",
      "Attestation_MSA_CAF",
      "Attestation_de_droits_sociaux",
      "Attestation_de_domicile",
      "Attestation_de_situation_de_couple",
      "Document_de_situation_de_couple",
      "Documents_relatifs_a_la_garde_des_enfants_en_cas_de_parents_separes",
    ],
    revenus: [
      "Derniers_bulletins_de_salaire",
      "Avis_imposition_ou_non",
      "Attestation_periode_inscription_France_Travail",
      "Contrats_travail",
      "Dossier_de_surendettement",
      "Documents_FT",
    ],
    complements: [
      "Complement_info_Administratif",
    ],
  },

  /* ── EMPLOI-FORMATION ──────────────────────────────────────── */
  emploi_formation: {
    situation: [
      "Situation_face_emploi",
      "Secteur_emploi_actuel",
      "Experiences_recentes",
      "Accompagnement_Cap_Emploi",
      "Pret_a_se_former",
    ],
    projet: [
      "Metier_du_projet_de_coeur",
      "Secteur_projet_coeur",
      "Metier_du_projet_retenu_pour_Emile",
      "Secteur_projet_EMILE",
      "Formation_relative_au_projet_retenu_pour_Emile",
    ],
    demarches: [
      "PMSMP_Appetence",
      "PMSMP_Competences",
      "Territoire_s_accueil_souhaite_s_",
      "Etablissement_s_interesse_s_",
      "Adresse_lieu_de_travail_formation",
      "Intitule_du_poste",
      "Nom_employeur_formateur",
      "Bilan_s_sejour_s_immersion",
      "Date_prevue_installation",
      "Installation_effective",
    ],
    cv: [
      "CV",
      "Attestations_de_formations",
      "Attestations_expe_pro",
    ],
    besoins: [
      "Volontariat_mobilite",
    ],
    complements: [
      "Complement_info_Emploi_Formation",
    ],
  },

  /* ── FINANCES ──────────────────────────────────────────────── */
  finances: {
    situation: [
      "Situation_financiere",
      "Droits_FT",
      "Bpi",
    ],
    france_travail: [
      "Attestation_periode_inscription_France_Travail",
      "Documents_FT",
    ],
    avis: [
      "Avis_imposition_ou_non",
      "Derniers_bulletins_de_salaire",
      "Contrats_travail",
      "Dossier_de_surendettement",
    ],
    complements: [
      "Complement_info_Finances",
    ],
  },

  /* ── FOYER ──────────────────────────────────────────────────── */
  foyer: {
    composition: [
      "Foyer",
      "Nombre_adultes_18_ans_et_plus_",
      "Nombre_enfants_0_2_ans_",
      "Nombre_enfants_3_5_ans_",
      "Nombre_enfants_6_17_ans_",
      "Nombre_total_enfants_du_foyer",
      "Nombre_total_de_personnes_du_foyer",
    ],
    couple_famille: [
      "Situation_de_couple",
      "Attestation_de_situation_de_couple",
      "Document_de_situation_de_couple",
      "Documents_relatifs_a_la_garde_des_enfants_en_cas_de_parents_separes",
      "Possession_animal_compagnie",
    ],
    besoins: [
      "Besoin_prise_en_charge_enfant_s_",
      "Besoin_accompagner_conjoint_e_vers_emploi_formation",
    ],
    complements: [
      "Complement_info_Foyer",
    ],
  },

  /* ── HABITAT ────────────────────────────────────────────────── */
  habitat: {
    infos: [
      "Situation_hebergement",
      "Precarite_de_logement",
      "Reside_en_QPV",
      "Avis_expulsion2",
      "Violence_intrafamilliale",
    ],
    etapes: [
      "Situation_hebergement_installation",
      "Adresse_lieu_de_travail_formation",
    ],
    attestations: [
      "Attestation_de_domicile",
      "Attestation_situation_hebergement",
      "Quittances_de_loyer",
      "Avis_expulsion",
    ],
    colocation: [
      "Colocation_accord",
      "Colocation_commentaire",
    ],
    besoins: [
      "Besoin_mise_a_l_abri",
      "Demande_DALO",
    ],
    complements: [
      "Difficultes_diverses",
      "Difficultes_diverses_explications",
    ],
  },

  /* ── LEC (Lecture-Écriture-Calcul) ─────────────────────────── */
  lec: {
    infos: [
      "Niveau_de_langue",
      "Niveau_de_langue_Eligibilite",
      "Niveau_etudes_reconnu_en_France",
      "Primo_arrivant",
    ],
    francais: [
      "Niveau_de_langue",
    ],
    calcul: [],
    apprentissages: [],
    complements: [
      "Complement_info_Lecture_Ecriture_Calcul",
    ],
  },

  /* ── MOBILITÉ ───────────────────────────────────────────────── */
  mobilite: {
    vehicules: [
      "Vehicule",
      "Permis",
      "Permis_statut",
      "Code_de_la_route",
      "Volontariat_mobilite",
      "Accompagnement_mobilite",
    ],
    besoins: [
      "Besoin_divers",
    ],
    complements: [
      "Complement_info_Mobilite",
    ],
  },

  /* ── NUMÉRIQUE ──────────────────────────────────────────────── */
  numerique: {
    materiel: [
      "Accompagnement_numerique",
      "Actions_numeriques",
    ],
    besoins: [],
    complements: [
      "Complement_info_Numerique",
    ],
  },

  /* ── SANTÉ ──────────────────────────────────────────────────── */
  sante: {
    situation: [
      "PMR",
      "RQTH",
    ],
    documents: [
      "Attestation_RQTH",
    ],
    besoins: [
      "Besoin_mise_a_l_abri",
    ],
    complements: [
      "Complement_info_Sante",
    ],
  },
};
