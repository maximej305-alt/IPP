// =============================================================================
// resultFileService.js — Cycle de vie des fichiers de résultats (Phase 6.5.5.4)
// Architecture: UI → resultsService → resultFileService → Supabase Storage + result_files
//   - Upload initial (Storage puis DB) avec rollback automatique
//   - Liste multi-fichiers par publication (Excel + PDF …)
//   - Suppression individuelle d'un fichier (jamais silencieuse)
//   - Remplacement ciblé (upload nouveau → DB → suppression ancien, dernier)
//   - Suppression de publication (Storage + DB, CASCADE relayé)
//   - Réconciliation des orphelins Storage / result_files (admin uniquement)
//
// CONVENTION DE RÉSULTAT STRUCTURÉ :
//   { success:true,  file }                                         → OK
//   { success:true,  file, cleanupWarning:{required,filePath,reason}} → OK mais nettoyage incomplet
//   { success:false, error:{code,message} }                          → Erreur normale
//   { success:false, error:{...}, cleanupWarning:{...} }             → Erreur + incohérence détectée
//
// RÈGLES :  • Jamais .catch(()=>{}) pour masquer une erreur de nettoyage.
//           • Le remplacement ne supprime JAMAIS l'ancien avant qu'un nouveau soit
//             uploadé ET enregistré en DB.
//           • Jamais de service_role / secret ici — RLS has_role('admin') fait barrière.
// =============================================================================
import { getSupabaseClient, isSupabaseEnabled } from "./supabaseClient.js";

export const FILE_MAX_BYTES = 8 * 1024 * 1024; // 8 Mo

export function mapFile(row){
  if(!row) return null;
  return {
    id: row.id,
    publicationId: row.publication_id,
    publication_id: row.publication_id,
    filePath: row.file_path,
    file_path: row.file_path,
    fileName: row.file_name,
    file_name: row.file_name,
    fileType: row.file_type,
    file_type: row.file_type,
    fileSize: row.file_size,
    file_size: row.file_size,
    createdAt: row.created_at,
    created_at: row.created_at
  };
}

function sanitizeFileName(name){
  return (name||"").replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(0, 80);
}

function extensionOf(fileName){
  const i = (fileName||"").lastIndexOf(".");
  return i >= 0 ? fileName.slice(i).toLowerCase() : "";
}

// Signature simple (non bloquant, complémentaire à l'extension / MIME).
async function sniffSignature(file){
  try{
    if(file && typeof file.slice === "function"){
      const head = await file.slice(0, 4).arrayBuffer();
      const bytes = new Uint8Array(head);
      let sig = "";
      for(let i=0;i<bytes.length && i<4;i++) sig += String.fromCharCode(bytes[i]);
      return sig;
    }
  }catch(_){}
  return "";
}

function fileTypeFromExtension(ext){
  if(ext === ".pdf") return "application/pdf";
  if(ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if(ext === ".xls") return "application/vnd.ms-excel";
  return null;
}

export const resultFileService = {

  // ---------------------------------------------------------------------------
  // VALIDATION — extension + taille + signature simple (jamais un antivirus).
  // ---------------------------------------------------------------------------
  async validateFile(file){
    if(!file) return { ok:false, error:"Aucun fichier sélectionné." };
    const allowed = [".xlsx", ".xls", ".pdf"];
    const ext = extensionOf(file.name);
    if(!allowed.includes(ext)){
      return { ok:false, error:`Extension non autorisée (${ext || "inconnue"}). Autorisés : ${allowed.join(", ")}` };
    }
    if(file.size > FILE_MAX_BYTES){
      return { ok:false, error:`Fichier trop volumineux (${(file.size/1024/1024).toFixed(1)} Mo > 8 Mo).` };
    }
    // Signature simple quand lisible : PDF→%PDF-, XLSX→PK (ZIP), XLS→OLE D0 CF 11 E0.
    if(file.size > 0){
      const sig = await sniffSignature(file);
      const extG = extensionOf(file.name);
      if(extG === ".pdf" && sig && sig !== "%PDF"){
        return { ok:false, error:"Signature invalide : ce n'est pas un véritable fichier PDF (%PDF- absent)." };
      }
      if(extG === ".xlsx" && sig && sig !== "PK\x03\x04" && sig !== "PK\x05\x06"){
        return { ok:false, error:"Signature invalide : ce n'est pas un véritable fichier XLSX (ZIP/PK absent)." };
      }
      if(extG === ".xls" && sig && sig !== "\xD0\xCF\x11\xE0"){
        return { ok:false, error:"Signature invalide : ce n'est pas un véritable fichier XLS (OLE absent)." };
      }
    }
    const mime = fileTypeFromExtension(ext);
    return { ok:true, ext, mime, size:file.size };
  },

  // ---------------------------------------------------------------------------
  // CHEMIN — anticollision : results/{school_year}/{publication_id}/{uuid}.{ext}
  // Le nom original reste dans result_files.file_name (jamais seul dans le chemin).
  // ---------------------------------------------------------------------------
  buildPath(publicationId, fileOrExt){
    const ext = typeof fileOrExt === "string" ? fileOrExt : extensionOf(fileOrExt?.name);
    const uuid = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,8);
    // NOTE : school_year optionnel — on garde publication_id (stable, groupable) comme
    // premier segment après le bucket, conformément à la convention anticollision.
    return `results/${publicationId}/${uuid}${ext}`;
  },

  // ---------------------------------------------------------------------------
  // LISTE — tous les fichiers d'une publication (multi-fichiers), triés created_at DESC
  // ---------------------------------------------------------------------------
  async listPublicationFiles(publicationId){
    if(!isSupabaseEnabled()) return [];
    if(!publicationId) return [];
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from("result_files")
      .select("*")
      .eq("publication_id", publicationId)
      .order("created_at", { ascending: false });
    if(error) throw error;
    return (data||[]).map(mapFile);
  },

  // ---------------------------------------------------------------------------
  // UPLOAD — valide + upload Storage + INSERT result_files. Rollback auto si DB échoue.
  // ---------------------------------------------------------------------------
  async uploadResultFile(publication, file){
    if(!publication || !publication.id) return { success:false, error:{ code:"PUBLICATION_REQUIRED", message:"Publication requise." } };
    const v = await this.validateFile(file);
    if(!v.ok) return { success:false, error:{ code:"INVALID_FILE", message:v.error } };

    let supabase;
    try{ supabase = await getSupabaseClient(); }
    catch(e){ return { success:false, error:{ code:"CLIENT", message:e.message } }; }

    const path = this.buildPath(publication.id, v.ext);
    let uploaded = false;
    try{
      const { error: upErr } = await supabase.storage
        .from("results")
        .upload(path, file, { contentType: v.mime || file.type || "application/octet-stream", upsert:false });
      if(upErr){
        return { success:false, error:{ code:"STORAGE_UPLOAD_FAILED", message:upErr.message } };
      }
      uploaded = true;

      // Ligne DB — encadrée : si elle échoue, on supprime l'objet Storage (rollback explicite, signalé si échec).
      const { data, error: dbErr } = await supabase.from("result_files").insert({
        publication_id: publication.id,
        file_path: path,
        file_name: String(file.name || "fichier"),
        file_type: v.mime || file.type || null,
        file_size: file.size || 0
      }).select().single();
      if(dbErr){
        // Rollback Storage ; on ne masque pas un échec de rollback.
        const rm = await supabase.storage.from("results").remove([path]).catch(e=>({ error:e }));
        const cleanupWarning = rm && rm.error
          ? { required:true, filePath:path, reason:"Échec DB après upload, et rollback Storage lui-même en échec." }
          : undefined;
        return { success:false, error:{ code:"DB_INSERT_FAILED", message:dbErr.message }, cleanupWarning };
      }
      return { success:true, file:mapFile(data) };
    }catch(err){
      // Nettoyage best-effort, signalé (jamais silencieux).
      let warning;
      if(uploaded){
        const rm = await supabase.storage.from("results").remove([path]).catch(e=>({ error:e }));
        if(rm && rm.error) warning = { required:true, filePath:path, reason:"Nettoyage Storage après échec impossible ("+rm.error.message+")." };
      }
      return { success:false, error:{ code:"UPLOAD_FAILED", message:err.message }, cleanupWarning:warning };
    }
  },

  // ---------------------------------------------------------------------------
  // SUPPRESSION INDIVIDUELLE — un seul fichier (Storage puis DB).
  //   Storage OK + DB OK          → { success:true, file }
  //   Storage OK + DB fail        → { success:false, error:{code:"DB_DELETE_FAILED"}, cleanupWarning }
  //   Storage fail                → on NE supprime PAS la ligne DB (incohérence remontée)
  // ---------------------------------------------------------------------------
  async deleteResultFile(fileId){
    if(!isSupabaseEnabled()) return { success:false, error:{ code:"MOCK", message:"Mode mock inactif." } };
    if(!fileId) return { success:false, error:{ code:"FILE_REQUIRED", message:"Identifiant de fichier requis." } };
    const supabase = await getSupabaseClient();

    // 1) Lit la ligne DB (autorité) pour connaître file_path.
    const { data: row, error: findErr } = await supabase
      .from("result_files").select("*").eq("id", fileId).single();
    if(findErr && findErr.code === "PGRST116") return { success:false, error:{ code:"NOT_FOUND", message:"Fichier introuvable." } };
    if(findErr) return { success:false, error:{ code:"DB_FIND_FAILED", message:findErr.message } };

    // 2) Supprime l'objet Storage.
    const storagePath = row.file_path;
    let storageDeleted = false;
    let storageError = null;
    if(storagePath){
      // En mode non-mock réel, on supprime ; en cas d'échec on remonte SANS supprimer la DB.
      try{
        const { error } = await supabase.storage.from("results").remove([storagePath]);
        if(error){ storageError = error; }
        else storageDeleted = true;
      }catch(e){ storageError = e; }
      if(storageError){
        return { success:false, error:{ code:"STORAGE_DELETE_FAILED", message:storageError.message||"Échec de suppression Storage." },
                 cleanupWarning:{ required:true, filePath:storagePath, reason:"Storage non supprimé — ligne DB conservée pour éviter un orphelin silencieux." } };
      }
    } else {
      storageDeleted = true; // pas de Storage associé
    }

    // 3) Supprime la ligne DB.
    const { error: delErr } = await supabase.from("result_files").delete().eq("id", fileId);
    if(delErr){
      // Storage déjà supprimé mais DB non supprimée → incohérence : SIGNALER.
      return { success:false, error:{ code:"DB_DELETE_FAILED", message:delErr.message },
               cleanupWarning:{ required:true, filePath:storagePath||"", reason:"Objet Storage supprimé mais ligne result_files non supprimée — DB à réparer." } };
    }
    return { success:true, file:mapFile(row) };
  },

  // ---------------------------------------------------------------------------
  // REMPLACEMENT CIBLÉ — remplace UN fichier précis (oldFileId) par un nouveau.
  //   1. valider nouveau
  //   2. upload nouveau Storage
  //   3. INSERT nouvelle ligne DB
  //   4. vérifier
  //   5. supprimer ancien objet Storage
  //   6. supprimer ancienne ligne DB
  // Jamais d'inversion ; jamais de .catch(()=>{}) pour le nettoyage.
  // Autres fichiers (ex: PDF si on remplace le xlsx) INTACTS.
  // ---------------------------------------------------------------------------
  async replaceResultFile(publication, oldFileId, file){
    if(!publication || !publication.id) return { success:false, error:{ code:"PUBLICATION_REQUIRED", message:"Publication requise." } };
    if(!oldFileId) return { success:false, error:{ code:"OLD_FILE_REQUIRED", message:"Fichier à remplacer non identifié." } };

    // 1) Validation + upload du nouveau.
    const v = await this.validateFile(file);
    if(!v.ok) return { success:false, error:{ code:"INVALID_FILE", message:v.error } };

    let supabase;
    try{ supabase = await getSupabaseClient(); }
    catch(e){ return { success:false, error:{ code:"CLIENT", message:e.message } }; }

    const newPath = this.buildPath(publication.id, v.ext);

    // (a) Ancien fichier (pour suppression différée).
    const { data: oldRow, error: oldFindErr } = await supabase
      .from("result_files").select("*").eq("id", oldFileId).single();
    if(oldFindErr) return { success:false, error:{ code:"OLD_READ_FAILED", message:oldFindErr.message } };

    let uploaded = false;
    try{
      // 2) Upload nouveau.
      const { error: upErr } = await supabase.storage.from("results").upload(newPath, file, { contentType: v.mime || file.type || "application/octet-stream", upsert:false });
      if(upErr) return { success:false, error:{ code:"STORAGE_UPLOAD_FAILED", message:upErr.message } };
      uploaded = true;

      // 3) INSERT nouvelle ligne DB.
      const { data: newRow, error: dbErr } = await supabase.from("result_files").insert({
        publication_id: publication.id,
        file_path: newPath,
        file_name: String(file.name || "fichier"),
        file_type: v.mime || file.type || null,
        file_size: file.size || 0
      }).select().single();
      if(dbErr){
        const rm = await supabase.storage.from("results").remove([newPath]).catch(e=>({ error:e }));
        return {
          success:false,
          error:{ code:"DB_INSERT_FAILED", message:dbErr.message },
          cleanupWarning: rm && rm.error ? { required:true, filePath:newPath, reason:"Échec DB après upload ; rollback Storage en échec." } : undefined
        };
      }

      // 5) Supprimer ANCIEN objet Storage (explicite, erreur remontée).
      let cleanupWarning;
      if(oldRow.file_path){
        const { error: oldRmErr } = await supabase.storage.from("results").remove([oldRow.file_path]);
        if(oldRmErr){
          cleanupWarning = { required:true, filePath:oldRow.file_path, reason:"Ancien objet Storage non supprimé après remplacement — réparation requise." };
        }
      }

      // 6) Supprimer ANCIENNE ligne DB (après Storage). Si celle-ci échoue, on signale.
      const { error: oldDelErr } = await supabase.from("result_files").delete().eq("id", oldFileId);
      if(oldDelErr){
        const warning = cleanupWarning || { required:true, filePath:newPath, reason:"Suppression de l'ancienne ligne result_files en échec après remplacement." };
        return { success:true, file:mapFile(newRow), cleanupWarning:warning };
      }

      return { success:true, file:mapFile(newRow), cleanupWarning };
    }catch(err){
      // Rollback du nouveau (explicite).
      let warning;
      if(uploaded){
        const rm = await supabase.storage.from("results").remove([newPath]).catch(e=>({ error:e }));
        if(rm && rm.error) warning = { required:true, filePath:newPath, reason:"Nettoyage du nouveau fichier après échec impossible." };
      }
      return { success:false, error:{ code:"REPLACE_FAILED", message:err.message }, cleanupWarning:warning };
    }
  },

  // ---------------------------------------------------------------------------
  // SUPPRESSION PUBLICATION — retire Storage (tous fichiers) puis publication.
  //   Stratégie contrôlée : liste références → supprime Storage (collecte échecs) →
  //   supprime publication (CASCADE) → remonte cleanupWarning si Storage non nettoyé.
  //   Le fait de supprimer Storage en premier, AVEC capture des échecs, permet de
  //   ne jamais laisser un objet sans suivi : si le DELETE publication échoue, on
  //   remonte une erreur avec cleanupWarning explicite.
  // ---------------------------------------------------------------------------
  async deletePublicationFiles(publication){
    if(!publication || !publication.id) return { success:true, filesDeleted:0 };
    const files = await this.listPublicationFiles(publication.id);
    const paths = files.map(f => f.file_path).filter(Boolean);
    let failures = [];
    if(paths.length){
      const supabase = await getSupabaseClient();
      for(const p of paths){
        try{
          const { error } = await supabase.storage.from("results").remove([p]);
          if(error) failures.push({ path:p, message:error.message });
        }catch(e){ failures.push({ path:p, message:e.message }); }
      }
    }
    return { success: failures.length === 0, filesDeleted: paths.length - failures.length, total: paths.length, failures };
  },

  async deletePublication(publication){
    if(!publication || !publication.id) return { success:false, error:{ code:"PUBLICATION_REQUIRED", message:"Publication requise." } };
    const supabase = await getSupabaseClient();

    // 1) Nettoyage Storage d'abord (tous fichiers), avec capture des échecs.
    const clean = await this.deletePublicationFiles(publication);

    // 2) Suppression publication (CASCADE → result_files + result_search_index).
    const { error: pubErr } = await supabase.from("result_publications").delete().eq("id", publication.id);
    if(pubErr){
      // Publication non supprimée : s'il reste des objets Storage supprimés, il peut y avoir
      // des lignes DB pointant vers des fichiers inexistants → on le signale.
      return {
        success:false,
        error:{ code:"PUBLICATION_DELETE_FAILED", message:pubErr.message },
        cleanupWarning: clean.total > 0
          ? { required:true, filePath: clean.failures[0]?.path || "", reason:"Objets Storage supprimés mais publication non supprimée — références DB potentielles cassées." }
          : undefined
      };
    }

    // 3) Storage non entièrement nettoyé → succès avec avertissement (jamais masqué).
    if(clean.failures.length){
      return {
        success:true,
        publicationDeleted:true,
        cleanupWarning:{
          required:true,
          filePath: clean.failures[0].path,
          reason:`${clean.failures.length} objet(s) Storage non supprimé(s) après suppression de publication — réparation requise.`
        }
      };
    }
    return { success:true, publicationDeleted:true };
  },

  // ---------------------------------------------------------------------------
  // RÉCONCILIATION — compare result_files.file_path ↔ Storage objets du bucket.
  //   Réservée à admin/super_admin (RLS). Ne supprime JAMAIS automatiquement.
  //   Retourne un rapport ; les actions de réparation sont explicites et séparées.
  // ---------------------------------------------------------------------------
  async reconcileResultFiles(){
    if(!isSupabaseEnabled()) return { dbFiles:[], storageFiles:[], missingInStorage:[], orphanedInStorage:[] };
    const supabase = await getSupabaseClient();

    const { data: dbRows, error: dbErr } = await supabase.from("result_files").select("id, file_path, file_name");
    if(dbErr) throw dbErr;
    const dbFiles = (dbRows||[]).map(r => ({ id:r.id, file_path:r.file_path, file_name:r.file_name }));

    // Listing récursif du bucket privé results (relative au bucket, sans préfixe "results/").
    const storageFiles = [];
    async function walk(prefix){
      const { data, error } = await supabase.storage.from("results").list(prefix || "");
      if(error) throw error;
      for(const entry of (data||[])){
        if(entry.id){ // fichier
          storageFiles.push(prefix ? `${prefix}/${entry.name}` : entry.name);
        }else{ // dossier → parcours récursif
          await walk(prefix ? `${prefix}/${entry.name}` : entry.name);
        }
      }
    }
    await walk("");

    // file_path stocké : "results/{pubId}/{uuid}.{ext}" ; le listing Storage (relatif au
    // bucket) renvoie exactement ce même chemin (buildPath préfixe déjà "results/", le SDK
    // ajoute le bucket). On compare donc sans transformation.
    const dbRel = p => p || "";
    const dbPaths = new Set(dbFiles.map(r => dbRel(r.file_path)));
    const storageSet = new Set(storageFiles);

    const missingInStorage = dbFiles.filter(r => !storageSet.has(dbRel(r.file_path)));
    const orphanedInStorage = storageFiles.filter(p => !dbPaths.has(p));

    return { dbFiles, storageFiles, missingInStorage, orphanedInStorage };
  },

  // Actions de réparation EXPLICITES (jamais automatiques côté API).
  //   removeOrphanedInStorage(orphanNames)  → supprime les objets Storage sans ligne DB
  //   removeMissingInStorage(filePath)      → supprime la ligne DB pointant vers un fichier absent
  async removeOrphanedInStorage(orphanNames){
    if(!Array.isArray(orphanNames) || orphanNames.length === 0) return { removed:0, failures:[] };
    const supabase = await getSupabaseClient();
    const { error } = await supabase.storage.from("results").remove(orphanNames);
    if(error) return { removed:0, failures: orphanNames.map(n=>({ path:n, message:error.message })) };
    return { removed: orphanNames.length, failures:[] };
  },
  async removeMissingInStorage(filePath){
    if(!filePath) return { success:false, error:{ code:"PATH_REQUIRED", message:"Chemin requis." } };
    const supabase = await getSupabaseClient();
    const { error } = await supabase.from("result_files").delete().eq("file_path", filePath);
    if(error) return { success:false, error:{ code:"DB_DELETE_FAILED", message:error.message } };
    return { success:true };
  }
};

// Utile pour consumption front (config fournit enabled). Non utilisé directement ici,
// mais exporté pour clarté de l'architecture.
export function resultsStorageEnabled(){ return isSupabaseEnabled(); }
