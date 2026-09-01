// =============================================================================
// resultsService.js — Gestion réelle des publications de résultats (Phase 6.5.5.3)
// Architecture: UI → resultsService → supabaseClient → Supabase (DB + Storage bucket results)
//   - result_publications  : la publication (draft/scheduled/published/expired/archived)
//   - result_files         : fichiers source (Excel/PDF) du bucket PRIVATE "results"
//   - result_search_index  : élèves indexés (jamais en lecture directe anon)
//   - search_student_result: RPC SECURITY DEFINER (seul accès public aux données)
// RLS : admin/super_admin gèrent tout ; anon ne lit que les pubs publiées/programmées.
// XSS : les données dynamiques doivent être rendues via textContent (jamais innerHTML).
// =============================================================================
import { getSupabaseClient, isSupabaseEnabled } from "./supabaseClient.js";
import { resultFileService } from "./resultFileService.js";

export const RESULT_STATUSES = ["draft", "scheduled", "published", "expired", "archived"];

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_LIMIT = 8;

// =============================================================================
// VITRINE PUBLIQUE — fallback mock (conservé jusqu'à la Phase 6.5.5.8)
// Ne pas casser la page publique actuelle. À remplacer par la RPC réelle.
// =============================================================================
const mockResults = [
  { id:"r1", name:"Asima Gossan Soradéo", level:"Terminale", serie:"F2", average:"14,82", rank:"03", total:"42", decision:"ADMIS", session:"Deuxième trimestre" },
  { id:"r2", name:"Asima Mireille", level:"Terminale", serie:"F2", average:"12,40", rank:"12", total:"42", decision:"ADMIS", session:"Deuxième trimestre" },
  { id:"r3", name:"Koffi Jean-Baptiste", level:"Terminale", serie:"F2", average:"09,10", rank:"30", total:"42", decision:"Ajourné", session:"Deuxième trimestre" },
  { id:"r4", name:"Dosseh Ayaovi", level:"Première", serie:"D", average:"13,55", rank:"05", total:"38", decision:"ADMIS", session:"Deuxième trimestre" },
  { id:"r5", name:"Ahoefa Mensah", level:"Seconde", serie:"C", average:"11,20", rank:"08", total:"45", decision:"ADMIS", session:"Deuxième trimestre" },
];
let currentState = "available";
let scheduledAt = new Date(Date.now() + 8*24*3600*1000 + 14*3600*1000 + 32*60*1000 + 10000);
let sessionLabel = "Résultats du 2ᵉ trimestre";

// Rend une valeur lisible pour l'UI à partir de la ligne SQL.
function mapPublication(row){
  if(!row) return null;
  return {
    id: row.id,
    level: row.level_name,
    level_name: row.level_name,
    className: row.class_name,
    class_name: row.class_name,
    serie: row.class_name,
    session: row.session,
    schoolYear: row.school_year,
    school_year: row.school_year,
    status: row.status,
    publish_at: row.publish_at,
    published_at: row.published_at,
    expires_at: row.expires_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    studentCount: row.student_count != null ? row.student_count : 0
  };
}

function useMock(){ return !isSupabaseEnabled(); }
function delay(ms){ return new Promise(r=>setTimeout(r, ms)); }

export const resultsService = {

  // ---- Vitrine publique (fallback mock, cf. Phase 6.5.5.8) ----
  getState(){ return currentState; },
  getSessionLabel(){ return sessionLabel; },
  getScheduledAt(){ return scheduledAt; },
  setState(s){ currentState = s; },
  setScheduledAt(d){ scheduledAt = d; },
  async search({ level, serie, query }){
    await delay(180);
    if(!level || !serie) return [];
    const q = (query||"").toLowerCase().trim();
    if(q.length < SEARCH_MIN_CHARS) return [];
    let list = mockResults.filter(r=>r.level===level && r.serie===serie);
    list = list.filter(r=>r.name.toLowerCase().includes(q));
    return list.slice(0, SEARCH_LIMIT);
  },
  async getById(id){ await delay(80); return mockResults.find(r=>r.id===id) || null; },
  async getByExactName(name, level, serie){
    const q = (name||"").toLowerCase().trim();
    if(!level || !serie || q.length < SEARCH_MIN_CHARS) return null;
    return mockResults.find(r=>r.name.toLowerCase()===q && r.level===level && r.serie===serie) || null;
  },
  async listAll(){ return mockResults; },
  async simulateImport({ level, serie, session, fileName }){
    await delay(700);
    return { detected: 42, level, serie, session, fileName, preview: mockResults.slice(0,3) };
  },

  // ===========================================================================
  // ADMIN — PUBLICATIONS
  // ===========================================================================

  // Liste toutes les publications pour l'admin, avec le vrai compteur d'élèves.
  // Le compteur est calculé côté serveur via une sous-requête (en mode réel)
  // pour ne PAS télécharger toutes les lignes élèves côté navigateur.
  async getAdminPublications(){
    if(useMock()){ await delay(80); return []; }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from("result_publications")
      .select("*, result_search_index(count)")
      .order("created_at", { ascending: false });
    if(error) throw error;
    return (data||[]).map(r => mapPublication({
      ...r,
      student_count: (r.result_search_index && r.result_search_index[0] && r.result_search_index[0].count)
    }));
  },

  async getPublicationById(id){
    if(!id) return null;
    if(useMock()){ await delay(60); return null; }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from("result_publications")
      .select("*, result_search_index(count)")
      .eq("id", id)
      .single();
    if(error) throw error;
    return mapPublication({
      ...data,
      student_count: (data.result_search_index && data.result_search_index[0] && data.result_search_index[0].count)
    });
  },

  // Vérifie l'existence d'une combinaison Niveau/Classe/Session/Année.
  // Retourne la publication existante ou null. (Prévention doublons — Phase C)
  async findExisting({ level, className, session, schoolYear }){
    if(useMock()) return null;
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from("result_publications")
      .select("id, level_name, class_name, session, school_year, status")
      .eq("level_name", level)
      .eq("class_name", className)
      .eq("session", session)
      .eq("school_year", schoolYear)
      .maybeSingle();
    if(error) throw error;
    return data ? mapPublication(data) : null;
  },

  async createPublication({ level, className, session, schoolYear, status = "draft", publish_at, expires_at }){
    const lvl = (level||"").trim();
    const cls = (className||"").trim();
    const sess = (session||"").trim();
    const yr = (schoolYear||"").trim();
    if(!lvl || !cls || !sess || !yr) throw new Error("Niveau, classe, session et année scolaire sont obligatoires.");
    if(!RESULT_STATUSES.includes(status)) throw new Error("Statut invalide.");

    // Prévention doublons (Phase C) — renvoyer une erreur explicite à l'UI
    const existing = await this.findExisting({ level:lvl, className:cls, session:sess, schoolYear:yr });
    if(existing){
      const err = new Error("EXISTS");
      err.existing = existing;
      err.message = `Une publication existe déjà pour : ${lvl} — ${cls} (Session : ${sess}, Année : ${yr}).`;
      throw err;
    }

    if(useMock()){ const row={ id:"p"+Date.now(), level_name:lvl, class_name:cls, session:sess, school_year:yr, status, publish_at, expires_at, created_at:new Date().toISOString() }; return mapPublication(row); }

    const supabase = await getSupabaseClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    const { data: inserted, error } = await supabase.from("result_publications").insert({
      level_name: lvl,
      class_name: cls,
      session: sess,
      school_year: yr,
      status,
      publish_at: publish_at ? new Date(publish_at).toISOString() : null,
      expires_at: expires_at ? new Date(expires_at).toISOString() : null,
      created_by: user?.id || null
    }).select("id, level_name, class_name, session, school_year, status, publish_at, published_at, expires_at, created_at, updated_at").single();
    if(error) throw error;
    return mapPublication(inserted);
  },

  async updatePublication(id, patch){
    if(!id) throw new Error("Identifiant manquant.");
    const dbPatch = {};
    if(patch.level !== undefined) dbPatch.level_name = patch.level;
    if(patch.className !== undefined) dbPatch.class_name = patch.className;
    if(patch.session !== undefined) dbPatch.session = patch.session;
    if(patch.schoolYear !== undefined) dbPatch.school_year = patch.schoolYear;
    if(patch.expires_at !== undefined) dbPatch.expires_at = patch.expires_at ? new Date(patch.expires_at).toISOString() : null;
    if(Object.keys(dbPatch).length === 0) return this.getPublicationById(id);
    if(useMock()){ await delay(60); return null; }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("result_publications").update(dbPatch).eq("id", id).select().single();
    if(error) throw error;
    return mapPublication(data);
  },

  // ===========================================================================
  // ADMIN — CYCLE DE VIE (Phase J/K/L/M)
  // ===========================================================================

  // Publication immédiate : exigence "non vide" (Phase J).
  async publishPublication(id){
    const pub = await this.getPublicationById(id);
    if(!pub) throw new Error("Publication introuvable.");
    const count = await this.getPublicationStudentCount(id);
    if(count <= 0) throw new Error("Impossible de publier une publication ne contenant aucun résultat élève.");
    if(useMock()) await delay(80);
    const supabase = await getSupabaseClient();
    const now = new Date().toISOString();
    const { data, error } = await supabase.from("result_publications").update({
      status: "published",
      publish_at: pub.publish_at || now,
      published_at: now
    }).eq("id", id).select().single();
    if(error) throw error;
    return mapPublication(data);
  },

  // Programmation (Phase K) : status=scheduled + publish_at dans le futur.
  async schedulePublication(id, publishAt){
    const dt = publishAt ? new Date(publishAt) : null;
    if(!dt || isNaN(dt.getTime())) throw new Error("Date de publication invalide.");
    if(useMock()){ await delay(80); return null; }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("result_publications").update({
      status: "scheduled",
      publish_at: dt.toISOString(),
      published_at: null
    }).eq("id", id).select().single();
    if(error) throw error;
    return mapPublication(data);
  },

  // Annule une programmation : revient en brouillon.
  async cancelSchedule(id){
    if(useMock()){ await delay(60); return null; }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("result_publications").update({
      status: "draft",
      publish_at: null,
      published_at: null
    }).eq("id", id).select().single();
    if(error) throw error;
    return mapPublication(data);
  },

  // Retire de la publication (publier -> brouillon).
  async unpublishPublication(id){
    if(useMock()){ await delay(60); return null; }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("result_publications").update({
      status: "draft",
      published_at: null
    }).eq("id", id).select().single();
    if(error) throw error;
    return mapPublication(data);
  },

  // Archivage (Phase M) : conservé pour admin, plus visible publiquement.
  async archivePublication(id){
    if(useMock()){ await delay(60); return null; }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("result_publications").update({
      status: "archived"
    }).eq("id", id).select().single();
    if(error) throw error;
    return mapPublication(data);
  },

  // Restauration d'un brouillon archivé.
  async restorePublication(id){
    if(useMock()){ await delay(60); return null; }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("result_publications").update({
      status: "draft",
      publish_at: null,
      published_at: null
    }).eq("id", id).select().single();
    if(error) throw error;
    return mapPublication(data);
  },

  // ===========================================================================
  // ADMIN — COMPTEUR D'ÉLÈVES (Phase I) — agrégation côté serveur
  // ===========================================================================
  async getPublicationStudentCount(id){
    if(useMock()) return 0;
    const supabase = await getSupabaseClient();
    const { count, error } = await supabase
      .from("result_search_index")
      .select("id", { count: "exact", head: true })
      .eq("publication_id", id);
    if(error && error.code === "PGRST116") return 0;
    if(error) throw error;
    return count || 0;
  },

  async getPublicationStudents(id, limit = 50){
    if(useMock()) return [];
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from("result_search_index")
      .select("id, student_name, average, rank, total, decision")
      .eq("publication_id", id)
      .order("rank", { ascending: true })
      .limit(limit);
    if(error) throw error;
    return data || [];
  },

  // ===========================================================================
  // ADMIN — FICHIERS (Storage PRIVATE + result_files) → DÉLÉGUÉ À resultFileService
  // ===========================================================================
  async getPublicationFiles(id){
    return resultFileService.listPublicationFiles(id);
  },

  async getCurrentFile(id){
    const files = await resultFileService.listPublicationFiles(id);
    return files[0] || null;
  },

  // ===========================================================================
  // ADMIN — IMPORT DES RÉSULTATS (Phase 6.5.5.7) — upload + indexation atomiques
  // ===========================================================================

  // Importe les élèves + le fichier source (premier import).
  // La partie FICHIER (upload Storage + INSERT result_files + rollback) est déléguée
  // à resultFileService ; ici on coordonne l'indexation des élèves.
  async importStudents(publicationId, { file, students }){
    if(!publicationId) throw new Error("Publication manquante.");
    const list = Array.isArray(students) ? students : [];

    let fileRow = null;
    try{
      // FICHIER → délégué (upload + ligne result_files + rollback explicite).
      if(file){
        const r = await resultFileService.uploadResultFile({ id: publicationId }, file);
        if(!r.success){
          const err = new Error(r.error?.message || "Upload du fichier impossible.");
          if(r.cleanupWarning) err.cleanupWarning = r.cleanupWarning;
          throw err;
        }
        fileRow = r.file;
      }

      // INDEXATION des élèves.
      const rows = list.map(s => ({
        publication_id: publicationId,
        student_name: String(s.name || s.student_name || "").trim(),
        student_name_normalized: this._normalize(String(s.name || s.student_name || "").trim()),
        average: s.average != null ? String(s.average) : s.total != null ? String(s.total) : null,
        rank: s.rank != null ? String(s.rank) : null,
        total: s.total != null ? String(s.total) : null,
        decision: String(s.decision || "").trim()
      })).filter(r => r.student_name.length > 0);

      if(rows.length > 0){
        const supabase = await getSupabaseClient();
        const { data, error } = await supabase.from("result_search_index").insert(rows).select("id");
        if(error) throw error;
        if(!data || data.length !== rows.length) throw new Error("Indexation incomplète.");
      }

      return { file: fileRow, importedCount: rows.length };
    }catch(err){
      // ROLLBACK : purge le fichier créé (explicite — un échec de nettoyage est signalé).
      if(fileRow && fileRow.id){
        const del = await resultFileService.deleteResultFile(fileRow.id);
        if(del && del.cleanupWarning){
          console.warn("[resultsService] importStudents : rollback fichier incomplet", del.cleanupWarning);
          if(!err.cleanupWarning) err.cleanupWarning = del.cleanupWarning;
        }
      }
      throw err;
    }
  },

  // ===========================================================================
  // ADMIN — REMPLACEMENT D'UN FICHIER (Phase H / 6.5.5.4) — ciblé + sûr
  // L'ancien fichier n'est supprimé (Storage + DB) qu'après upload ET enregistrement
  // du nouveau (garanti par resultFileService.replaceResultFile).
  //   oldFileId : fichier précis à remplacer (multi-fichiers) ; sinon le plus récent.
  // ===========================================================================
  async replacePublicationFile(publicationId, { file, students, oldFileId }){
    if(!publicationId) throw new Error("Publication manquante.");
    const list = Array.isArray(students) ? students : [];

    let fileResult = null;
    if(file){
      const targetId = oldFileId || (await this.getCurrentFile(publicationId))?.id;
      if(!targetId) throw new Error("Aucun fichier existant à remplacer.");
      const pub = await this.getPublicationById(publicationId) || { id: publicationId };
      fileResult = await resultFileService.replaceResultFile(pub, targetId, file);
      if(!fileResult.success){
        const err = new Error(fileResult.error?.message || "Remplacement du fichier impossible.");
        if(fileResult.cleanupWarning) err.cleanupWarning = fileResult.cleanupWarning;
        throw err;
      }
    }

    const createdStudentIds = [];
    try{
      // INDEXATION : purger l'ancien index, insérer le nouveau (seules nouvelles lignes).
      const supabase = await getSupabaseClient();
      const rows = list.map(s => ({
        publication_id: publicationId,
        student_name: String(s.name || s.student_name || "").trim(),
        student_name_normalized: this._normalize(String(s.name || s.student_name || "").trim()),
        average: s.average != null ? String(s.average) : s.total != null ? String(s.total) : null,
        rank: s.rank != null ? String(s.rank) : null,
        total: s.total != null ? String(s.total) : null,
        decision: String(s.decision || "").trim()
      })).filter(r => r.student_name.length > 0);

      if(rows.length > 0){
        const { data, error } = await supabase.from("result_search_index").insert(rows).select("id");
        if(error) throw error;
        data.forEach(d => createdStudentIds.push(d.id));
        if(createdStudentIds.length !== rows.length) throw new Error("Nouvelle indexation incomplète.");
      }

      const q = supabase.from("result_search_index").delete().eq("publication_id", publicationId);
      if(createdStudentIds.length){
        q.not("id", "in", `(${createdStudentIds.join(",")})`);
      }
      const { error: delIdx } = await q;
      if(delIdx) throw delIdx;

      return { file: fileResult?.file || null, importedCount: createdStudentIds.length, cleanupWarning: fileResult?.cleanupWarning };
    }catch(err){
      // ROLLBACK du nouveau fichier (+ éventuels élèves) si quelque chose échoue après.
      if(createdStudentIds.length){
        try{
          const supabase = await getSupabaseClient();
          await supabase.from("result_search_index").delete().in("id", createdStudentIds);
        }catch(_){}
      }
      if(fileResult && fileResult.file && fileResult.file.id){
        const del = await resultFileService.deleteResultFile(fileResult.file.id);
        if(del && del.cleanupWarning && !err.cleanupWarning) err.cleanupWarning = del.cleanupWarning;
      }
      throw err;
    }
  },

  // Remplacement ciblé d'UN fichier (multi-fichiers) SANS toucher à l'index des élèves.
  // Utilisé par l'UI pour remplacer le PDF / un fichier donné sans re-indexer.
  async replaceFileOnly(publicationId, oldFileId, file){
    if(!publicationId) throw new Error("Publication manquante.");
    const pub = await this.getPublicationById(publicationId) || { id: publicationId };
    const res = await resultFileService.replaceResultFile(pub, oldFileId, file);
    if(!res.success){
      const err = new Error(res.error?.message || "Remplacement du fichier impossible.");
      if(res.cleanupWarning) err.cleanupWarning = res.cleanupWarning;
      throw err;
    }
    return res; // { success, file, cleanupWarning? }
  },

  // Suppression individuelle d'un fichier (ne touche ni à la publication ni à l'index).
  async deleteResultFile(fileId){
    const res = await resultFileService.deleteResultFile(fileId);
    if(!res.success){
      const err = new Error(res.error?.message || "Suppression du fichier impossible.");
      if(res.cleanupWarning) err.cleanupWarning = res.cleanupWarning;
      throw err;
    }
    return res;
  },

  // Réconciliation des orphelins Storage / DB (admin/super_admin).
  async reconcileResultFiles(){
    return resultFileService.reconcileResultFiles();
  },

  // ===========================================================================
  // ADMIN — SUPPRESSION COHÉRENTE (Phase G / 6.5.5.4)
  // Déléguée à resultFileService : Storeage nettoyé, publication supprimée,
  // CASCADE purge result_files + result_search_index. cleanupWarning remonté.
  // ===========================================================================
  async deletePublication(id){
    if(useMock()){ await delay(60); return { success:true, publicationDeleted:true }; }
    const pub = await this.getPublicationById(id) || { id };
    const res = await resultFileService.deletePublication(pub);
    if(!res.success){
      const err = new Error(res.error?.message || "Suppression de la publication impossible.");
      if(res.cleanupWarning) err.cleanupWarning = res.cleanupWarning;
      throw err;
    }
    return res; // peut contenir cleanupWarning
  },

  // ===========================================================================
  // ADMIN — FICHIER : validation frontend (Phase 6.5.5.3 / P13)
  // ===========================================================================
  validateFile(file){
    if(!file) return { ok:false, error:"Aucun fichier sélectionné." };
    const maxBytes = 8 * 1024 * 1024; // 8 Mo
    const allowed = [".xlsx", ".xls", ".pdf"];
    const ext = (file.name||"").toLowerCase().slice(file.name.lastIndexOf("."));
    if(!allowed.includes(ext)) return { ok:false, error:`Extension non autorisée (${ext || "inconnue"}). Autorisés: ${allowed.join(", ")}` };
    if(file.size > maxBytes) return { ok:false, error:`Fichier trop volumineux (${(file.size/1024/1024).toFixed(1)} Mo > 8 Mo).` };
    return { ok:true };
  },

  // ===========================================================================
  // PUBLIC — RECHERCHE RÉELLE VIA RPC (Phase 6.5.5.8)
  // Le seul accès du public aux données. Impose niveau+classe et >=2 caractères.
  // Retourne uniquement student_name, average, rank, total, decision.
  // ===========================================================================
  async searchStudentResult({ level, className, studentName }){
    const name = (studentName || "").trim();
    if(!level || !className || name.length < 2) return [];
    if(useMock()){ await delay(180); return []; }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.rpc("search_student_result", {
      p_level: level,
      p_class_name: className,
      p_student_name: name
    });
    if(error) throw error;
    return (data || []).map(r => ({
      name: r.student_name,
      average: r.average,
      rank: r.rank,
      total: r.total,
      decision: r.decision,
      level: level,
      serie: className,
      session: ""
    }));
  },

  // ===========================================================================
  // PUBLIC — ÉTAT DE LA VITRINE
  // Détermine l'état public réel depuis result_publications (RLS anon):
  //   "empty" | "scheduled" (compte à rebours) | "available" (recherche)
  // ===========================================================================
  async getPublicState(){
    if(useMock()){ await delay(80); return { state: "empty", scheduledAt: null, session: "" }; }
    const supabase = await getSupabaseClient();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("result_publications")
      .select("id, level_name, class_name, session, school_year, status, publish_at")
      .in("status", ["published", "scheduled"])
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("publish_at", { ascending: true });
    if(error) throw error;

    const visible = (data||[]).filter(p => !p.publish_at || new Date(p.publish_at) <= new Date());
    const scheduled = (data||[]).filter(p => p.publish_at && new Date(p.publish_at) > new Date()).sort((a,b)=>new Date(a.publish_at)-new Date(b.publish_at));

    if(visible.length > 0){
      return { state: "available", scheduledAt: null, session: `Résultats — ${visible[0].session} ${visible[0].school_year}` };
    }
    if(scheduled.length > 0){
      return { state: "scheduled", scheduledAt: scheduled[0].publish_at, session: `Résultats du ${scheduled[0].session}` };
    }
    return { state: "empty", scheduledAt: null, session: "Résultats" };
  },

  // Normalisation (unaccent + minuscules) — cohérent avec le trigger DB side effect.
  _normalize(s){
    return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
};
