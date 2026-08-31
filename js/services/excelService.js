// =============================================================================
// excelService.js — Traitement Excel (Phase 6.5.5.8 / P5)
// Architecture: UI → excelService → Edge Function / lib JS / Mock
//   - parseFileName: détection de la convention de nommage (optionnelle)
//   - analyze: analyse d'un fichier Excel (mock en attendant Edge Function)
//   - validateFile: validation de fichier (taille, type)
// RLS: pas d'accès direct ; utilisation par les formulaires admin.
// XSS: les données fichiers sont lues via File API, jamais d'injection HTML.
// =============================================================================
import { AppConfig } from "../config/app.config.js";
import { getSupabaseClient, isSupabaseEnabled } from "./supabaseClient.js";

// Convention de nommage des fichiers Excel IPP:
// TERMINALE_F2_T2_2026.xlsx, SECONDE_D_T1_2026.xlsx
// Tolérance: nom non conforme → warning + sélection manuelle

// Expressions régulières pour parser la convention
const CONVENTION_RE = /^(SECONDE|PREMIERE|TERMINATE)[-_]([A-Z0-9]+)[-_](T[1-3]|TRIMESTRE[1-3]|S[1-3])[_-]?(\d{4})?\.xlsx$/i;

// Helper: capitalize first letter
function capitalize(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; }

// Helper: delay (utilisé pour simuler le temps de traitement)
function delay(ms){ return new Promise(r=>setTimeout(r, ms)); }

// Option A — Version réelle de analyze (à activer quand Edge Function / lib JS disponible)
// async analyzeReal({ file, level, serie, session }){ ... }
// À décommenter et implémenter quand l'infrastructure est prête.

// Option C — Version sûre (fonction supprimée si inutilisée, mais conservée avec documentation)
// L'analyze() initial n'était appelé par personne et lançait en mode réel.
// Il est conservé avec comportement sûr mais signalé comme nécessitant une implémentation future.

// Analyse sécurisée : retour structuré, jamais de throw non géré.
// Si mock : simulation via resultsService.simulateImport.
// Si réel : retour indicateur (à implémenter quand Edge Function / lib JS dispo).
async analyze({ file, level, serie, session }){
  // Validation frontend (ne remplace pas la validation backend)
  const v = this.validateFile(file);
  if(!v.ok) throw new Error(v.error);

  // Détection depuis le nom de fichier (tolérance P8)
  let detected = null;
  if(file?.name){
    const parsed = this.parseFileName(file.name);
    if(parsed.ok && (!level || !serie)){
      detected = parsed;
    } else if(!parsed.ok){
      // warning non bloquant dans la console
      console.warn("[excelService] " + parsed.warning);
    }
  }

  // Détermination du mode : cohérent avec les autres services (isSupabaseEnabled)
  const isMock = !isSupabaseEnabled();
  
  if(isMock){
    // Chemin mock : simulation via resultsService.simulateImport
    // Mais resultsService.simulateImport peut lui-même être mock selon la config
    try{
      const { resultsService } = await import("./resultsService.js");
      const res = await resultsService.simulateImport({ level: detected?.niveau || level, serie: detected?.serie || serie, session: detected?.session || session, fileName: file?.name || "exemple.xlsx" });
      return { ...res, autoDetected: detected, mode:"mock" };
    }catch(e){
      // Fallback si resultsService n'est pas disponible en mock
      return { success:false, error:"Service mock temporairement indisponible", mode:"mock", fallback:true };
    }
  }
  
  // Chemin réel : analyse future (Edge Function / lib JS)
  // Pour l'instant, on retourne un indicateur structuré plutôt que de lancer d'erreur non gérée
  return {
    success: false,
    error: "Traitement Excel en attente d'implémentation Edge Function / lib JS",
    mode:"real",
    needsImplementation: true,
    autoDetected: detected
  };
}

// Validation de fichier (taille 8 Mo, types autorisés)
validateFile(file){
  if(!file) return { ok:false, error:"Aucun fichier sélectionné." };
  const maxBytes = 8 * 1024 * 1024; // 8 Mo
  const allowed = [".xlsx", ".pdf"];
  const ext = (file.name||"").toLowerCase().slice(file.name.lastIndexOf("."));
  if(!allowed.includes(ext)) return { ok:false, error:`Extension non autoris\u00e9e (${ext}). Autoris\u00e9s: ${allowed.join(", ")}` };
  if(file.size > maxBytes) return { ok:false, error:`Fichier trop volumineux (${(file.size/1024/1024).toFixed(1)} Mo > 8 Mo).` };
  if(file.size === 0) return { ok:false, error:"Le fichier est vide." };
  return { ok:true };
}

// parseFileName: détection de la convention de nommage depuis le fichier
parseFileName(fileName){
  const base = (fileName||"").trim().toUpperCase();
  const m = base.match(CONVENTION_RE);
  if(!m) return { ok:false, warning:"Nom hors convention ? séléctionnez manuellement niveau/série/session." };
  const [, niveau, serie, sessionRaw] = m;
  const sessionMap = { T1:"Premier trimestre", T2:"Deuxième trimestre", T3:"Troisième trimestre" };
  const session = sessionMap[sessionRaw.toUpperCase()] || sessionRaw;
  return { ok:true, niveau: capitalize(niveau), serie: serie.toUpperCase(), session };
}

// Ancienne analyse (conservée pour compatibilité / référence, ne pas appeler directement)
// @deprecated — utiliser la méthode analyze() sécurisée ci-dessus
// async analyzeOld({ file, level, serie, session }){
//   // Ancienne version — àsupprimer quand toutes les références sont migrées
//   const v = this.validateFile(file);
//   if(!v.ok) throw new Error(v.error);
//   if(AppConfig.useMock){
//     const { resultsService } = await import("./resultsService.js");
//     return await resultsService.simulateImport({ level: detected?.niveau || level, serie: detected?.serie || serie, session: detected?.session || session, fileName: file?.name || "exemple.xlsx" });
//   }
//   throw new Error("Traitement Excel non configuré ? mode mock uniquement");
// }