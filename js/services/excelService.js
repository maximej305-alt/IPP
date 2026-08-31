// =============================================================================
// excelService.js — Abstraction traitement Excel (P9)
// Ne verrouille PAS la technologie (JS lib / Edge Function / service futur)
// Flux: Admin UI → resultsService → excelService → implémentation future
// Convention IPP: NIVEAU_SERIE_SESSION_ANNEE.xlsx (P8)
//   Ex: TERMINALE_F2_T2_2026.xlsx, SECONDE_D_T1_2026.xlsx
// Tolérance: nom non conforme → warning + sélection manuelle (P8)
// =============================================================================
import { AppConfig } from "../config/app.config.js";

// Expressions pour parser la convention
const CONVENTION_RE = /^(SECONDE|PREMIERE|TERMINALE)[-_]([A-Z0-9]+)[-_](T[1-3]|TRIMESTRE[1-3]|S[1-3])[_-]?(\d{4})?\.xlsx$/i;

export const excelService = {
  // P8 — Tente de déduire niveau/serie/session depuis le nom de fichier
  parseFileName(fileName){
    const base = (fileName||"").trim().toUpperCase();
    const m = base.match(CONVENTION_RE);
    if(!m) return { ok:false, warning:"Nom hors convention — sélectionnez manuellement niveau/série/session." };
    const [, niveau, serie, sessionRaw] = m;
    const sessionMap = { T1:"Premier trimestre", T2:"Deuxième trimestre", T3:"Troisième trimestre" };
    const session = sessionMap[sessionRaw.toUpperCase()] || sessionRaw;
    return { ok:true, niveau: capitalize(niveau), serie: serie.toUpperCase(), session };
  },

  // P9 — Couche d'analyse (mock actuel)
  async analyze({ file, level, serie, session }){
    // Validation frontend (P13) — ne remplace pas la validation backend
    const v = this.validateFile(file);
    if(!v.ok) throw new Error(v.error);

    // Si nom fourni, tente auto-détection pour aider l'admin (P8 tolérance)
    let detected = null;
    if(file?.name){
      const parsed = this.parseFileName(file.name);
      if(parsed.ok && (!level || !serie)){
        detected = parsed;
      } else if(!parsed.ok){
        // warning non bloquant
        console.warn("[excelService] " + parsed.warning);
      }
    }

    await delay(800);
    // Mock: retourne aperçu (sera remplacé par Edge Function ou lib JS)
    if(AppConfig.useMock){
      const { resultsService } = await import("./resultsService.js");
      const res = await resultsService.simulateImport({ level: detected?.niveau || level, serie: detected?.serie || serie, session: detected?.session || session, fileName: file?.name || "exemple.xlsx" });
      return { ...res, autoDetected: detected };
    }
    // Future: appel Edge Function / lib locale
    throw new Error("Excel processing non configuré — mode mock uniquement");
  },

  validateFile(file){
    if(!file) return { ok:false, error:"Aucun fichier sélectionné." };
    const maxBytes = 8 * 1024 * 1024; // 8 Mo
    const allowed = [".xlsx", ".pdf"];
    const ext = (file.name||"").toLowerCase().slice(file.name.lastIndexOf("."));
    if(!allowed.includes(ext)) return { ok:false, error:`Extension non autorisée (${ext}). Autorisés: ${allowed.join(", ")}` };
    if(file.size > maxBytes) return { ok:false, error:`Fichier trop volumineux (${(file.size/1024/1024).toFixed(1)} Mo > 8 Mo).` };
    return { ok:true };
  }
};

function capitalize(s){ return s.charAt(0) + s.slice(1).toLowerCase(); }
function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
