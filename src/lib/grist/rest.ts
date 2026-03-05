// src/lib/grist/rest.ts
// Client REST Grist — implémente la même interface que grist.docApi (Plugin API)
// Utilisé en mode standalone (hors iframe Grist) via le proxy n8n (NEXT_PUBLIC_GRIST_PROXY_URL).
//
// ── Sécurité / authentification ──────────────────────────────────────────────
// La clé API Grist N'EST PAS stockée ici ni dans aucune variable NEXT_PUBLIC_*.
// Elle est exclusivement dans n8n (header Authorization: Bearer des nœuds HTTP Request).
//
// Le document Grist EMILE est en accès restreint (public access = Aucun accès).
// Seul le compte de service dédié (droits Éditeur sur ce document uniquement)
// peut lire/écrire via l'API — les appels passent tous par les webhooks n8n.
//
// Si la clé de service est compromise → la révoquer dans Grist et en créer une nouvelle,
// sans toucher au code frontend ni aux variables d'environnement Next.js.
// ─────────────────────────────────────────────────────────────────────────────

import type { GristDocAPI } from "./meta";

function proxyUrl(): string {
  return (process.env.NEXT_PUBLIC_GRIST_PROXY_URL ?? "").replace(/\/$/, "");
}

/**
 * Construit l'URL du proxy n8n.
 * GET /webhook/grist-proxy?table=TABLE[&filter=JSON]   — requêtes classiques (métadonnées, ref tables)
 * GET /webhook/grist-proxy?table=TABLE&token=ID.HMAC   — magic link (vérification HMAC côté n8n)
 */
function tableUrl(tableId: string, params?: Record<string, string>): string {
  const allParams = new URLSearchParams({ table: tableId, ...params });
  return `${proxyUrl()}?${allParams.toString()}`;
}

type RestRecord = { id: number; fields: Record<string, any> };

/**
 * Convertit le format REST Grist [{id, fields: {col: val}}]
 * → format columnar {id:[], col:[]} (même format que grist.docApi.fetchTable).
 */
function toColumnar(records: RestRecord[]): Record<string, any[]> {
  const result: Record<string, any[]> = { id: records.map((r) => r.id) };
  if (!records.length) return result;
  for (const key of Object.keys(records[0].fields)) {
    result[key] = records.map((r) => r.fields[key] ?? null);
  }
  return result;
}

async function gristFetch(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
    } catch { /* ignore */ }
    throw new Error(`Grist API ${res.status}: ${detail}`);
  }
  return res.json();
}

/**
 * Récupère tous les enregistrements d'une table (format columnar).
 * Utilisé pour DPTS_REGIONS, ETABLISSEMENTS, _grist_Tables, _grist_Tables_column…
 */
async function fetchTableRest(tableId: string): Promise<Record<string, any[]>> {
  const url = tableUrl(tableId);
  const { records } = (await gristFetch(url, {})) as { records: RestRecord[] };
  return toColumnar(records);
}

/**
 * Récupère un seul enregistrement par rowId (plus efficace que fetchTable entier).
 * Retourne {id, col1, col2, ...} ou null si non trouvé.
 *
 * @param token  Token signé "rowId.HMAC" (magic link). Si fourni, envoyé à n8n qui
 *               vérifie l'HMAC côté serveur avant de faire le fetch Grist.
 *               Sans token (dev fallback ?rowId=), on utilise ?filter=.
 */
export async function fetchSingleRowRest(
  tableId: string,
  rowId: number,
  token?: string | null,
): Promise<{ id: number; [k: string]: any } | null> {
  let url: string;
  if (token) {
    // Magic link : envoie le token signé — n8n vérifie le HMAC et extrait le rowId
    url = tableUrl(tableId, { token });
  } else {
    // Dev fallback (?rowId= sans signature) : filtre direct côté proxy
    const filter = JSON.stringify({ id: [rowId] });
    url = tableUrl(tableId, { filter });
  }
  const { records } = (await gristFetch(url, {})) as { records: RestRecord[] };
  const rec = records.find((r) => r.id === rowId) ?? null;
  if (!rec) return null;
  return { id: rec.id, ...rec.fields };
}

/**
 * Applique des actions Grist via le proxy n8n.
 *
 * Pour éviter le preflight CORS OPTIONS (déclenché par Content-Type JSON et
 * par la méthode PATCH), on encode les écritures en requêtes "simples" :
 *
 *   AddRecord    → POST text/plain  (text/plain = simple CORS request, pas de preflight)
 *   UpdateRecord → POST text/plain  (on évite PATCH qui déclenche un preflight)
 *
 * Le body est le JSON sérialisé en string. Le champ `_action` permet à n8n
 * de distinguer AddRecord (pas de rowId) et UpdateRecord (rowId présent).
 *
 * n8n POST workflow doit détecter text/plain et parser le body comme JSON.
 */
async function applyUserActionsRest(actions: any[]): Promise<any> {
  for (const action of actions) {
    const [type, tableId, rowId, fields] = action as [
      string,
      string,
      number | null,
      Record<string, any>
    ];
    const url = tableUrl(tableId);

    if (type === "UpdateRecord") {
      // POST text/plain pour éviter le preflight CORS (PATCH déclenche OPTIONS)
      await gristFetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ _action: "update", id: rowId, fields }),
      });
    } else if (type === "AddRecord") {
      // POST text/plain : "simple CORS request" — pas de preflight OPTIONS
      return gristFetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ _action: "add", fields }),
      });
    } else {
      throw new Error(`REST applyUserActions: action "${type}" non supportée`);
    }
  }
}

/**
 * Upload des fichiers via le proxy n8n.
 * n8n doit router POST ?action=upload vers POST /attachments de Grist.
 * Retourne les rowIds des nouvelles pièces jointes.
 */
async function uploadAttachmentsRest(files: FileList): Promise<number[]> {
  // POST vers le même proxy mais méthode POST (workflow n8n séparé).
  // Pas de header custom → multipart/form-data = "simple CORS request" → pas de preflight OPTIONS.
  const url = proxyUrl();
  const newIds: number[] = [];
  for (const file of Array.from(files)) {
    const fd = new FormData();
    fd.append("upload", file, file.name);
    const res = await fetch(url, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try { const b = await res.json(); if (b?.error) detail = b.error; } catch { /* ignore */ }
      throw new Error(`Upload ${res.status}: ${detail}`);
    }
    const body = await res.json();
    // n8n peut renvoyer plusieurs formats selon sa version et sa config :
    //   26                     ← nombre brut (n8n unwrappe [26] → 26 selon config)
    //   { ids: [26] }          ← Code node qui extrait .json
    //   { data: "[26]" }       ← HTTP Request sans Code node (réponse brute en string)
    //   [26]                   ← tableau direct
    //   { "0": { json: 26 } }  ← items n8n sérialisés avec pairedItem
    let extracted: number[] = [];
    if (typeof body === "number") {
      // n8n renvoie parfois le nombre brut directement (ex: 38)
      extracted = [body];
    } else if (Array.isArray(body?.ids) && body.ids.every((v: any) => typeof v === "number")) {
      extracted = body.ids;
    } else if (typeof body?.data === "string") {
      try { extracted = JSON.parse(body.data).filter((v: any) => typeof v === "number"); } catch { /* ignore */ }
    } else if (Array.isArray(body)) {
      extracted = body.filter((v: any) => typeof v === "number");
    } else if (body && typeof body === "object") {
      // items n8n { "0": { json: 26 }, ... } ou { ids: [{ json: 26 }] }
      const candidates = Array.isArray(body.ids) ? body.ids : Object.values(body);
      for (const c of candidates) {
        if (typeof c === "number") extracted.push(c);
        else if (typeof c?.json === "number") extracted.push(c.json);
      }
    }
    if (extracted.length === 0) {
      throw new Error(`n8n réponse inattendue: ${JSON.stringify(body).slice(0, 300)}`);
    }
    newIds.push(...extracted);
  }
  return newIds;
}

/** Crée un objet GristDocAPI utilisant le proxy n8n. */
export function createRestDocApi(): GristDocAPI {
  return {
    fetchTable:               fetchTableRest,
    applyUserActions:         applyUserActionsRest,
    getAttachmentDownloadUrl: (attachId: number) =>
      `${proxyUrl()}?attachId=${attachId}`,
    uploadAttachments:        uploadAttachmentsRest,
  };
}
