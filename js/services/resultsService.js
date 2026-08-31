// =============================================================================
// resultsService.js — Recherche ciblée (P6) + confidentialité (P7)
// ⚠️  MOCK DATA actuellement — Architecture prévue pour Supabase RPC/Edge Function
// Principe: Visiteur → niveau + classe + nom (≥2 chars) → requête contrôlée → limite 8
// Ne JAMAIS exposer getAllResults() côté public.
// =============================================================================
const mockResults = [
  { id:"r1", name:"Asima Gossan Soradéo", level:"Terminale", serie:"F2", average:"14,82", rank:"03", total:"42", decision:"ADMIS", session:"Deuxième trimestre" },
  { id:"r2", name:"Asima Mireille", level:"Terminale", serie:"F2", average:"12,40", rank:"12", total:"42", decision:"ADMIS", session:"Deuxième trimestre" },
  { id:"r3", name:"Koffi Jean-Baptiste", level:"Terminale", serie:"F2", average:"09,10", rank:"30", total:"42", decision:"Ajourné", session:"Deuxième trimestre" },
  { id:"r4", name:"Dosseh Ayaovi", level:"Première", serie:"D", average:"13,55", rank:"05", total:"38", decision:"ADMIS", session:"Deuxième trimestre" },
  { id:"r5", name:"Ahoefa Mensah", level:"Seconde", serie:"C", average:"11,20", rank:"08", total:"45", decision:"ADMIS", session:"Deuxième trimestre" },
];

let currentState = "available"; // "empty" | "scheduled" | "available"
let scheduledAt = new Date(Date.now() + 8*24*3600*1000 + 14*3600*1000 + 32*60*1000 + 10000);
let sessionLabel = "Résultats du 2ᵉ trimestre";

const SEARCH_MIN_CHARS = 2;
const SEARCH_LIMIT = 8;

export const resultsService = {
  // États vitrine (P10)
  getState(){ return currentState; },
  getSessionLabel(){ return sessionLabel; },
  getScheduledAt(){ return scheduledAt; },
  setState(s){ currentState = s; },
  setScheduledAt(d){ scheduledAt = d; },

  // P6 — Méthode future ciblée (à mapper vers Supabase RPC/Edge Function)
  // Ne retourne jamais toute la table. Limite + filtres obligatoires.
  async searchStudentResult({ level, className, studentName }){
    return this.search({ level, serie: className, query: studentName });
  },

  // Implémentation mock actuelle — respecte déjà P7 (niveau+classe obligatoires, limite)
  async search({ level, serie, query }){
    await delay(180);
    // P7 — confidentialité: niveau + classe obligatoires, sinon vide
    if(!level || !serie){
      return []; // le frontend doit forcer la sélection avant recherche
    }
    const q = (query || "").toLowerCase().trim();
    if(q.length < SEARCH_MIN_CHARS) return [];
    let list = mockResults.filter(r => r.level===level && r.serie===serie);
    list = list.filter(r=>r.name.toLowerCase().includes(q));
    return list.slice(0, SEARCH_LIMIT);
  },

  async getById(id){
    await delay(80);
    return mockResults.find(r=>r.id===id) || null;
  },

  async getByExactName(name, level, serie){
    const q = (name||"").toLowerCase().trim();
    if(!level || !serie || q.length < SEARCH_MIN_CHARS) return null;
    return mockResults.find(r=>r.name.toLowerCase()===q && r.level===level && r.serie===serie) || null;
  },

  // ⚠️  ADMIN UNIQUEMENT — Ne pas appeler côté public (P6)
  // Sera supprimé/RLS-protégé côté Supabase
  async listAll(){ return mockResults; },

  // Admin: simulate import (P8-9)
  async simulateImport({ level, serie, session, fileName }){
    await delay(900);
    return { detected: 42, level, serie, session, fileName, preview: mockResults.slice(0,3) };
  },

  // Constantes exposées pour validation frontend (P13)
  SEARCH_MIN_CHARS,
  SEARCH_LIMIT
};

function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
