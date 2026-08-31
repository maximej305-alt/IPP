// =============================================================================
// resultFileService.js â€” Cycle de vie des fichiers de rÃ©sultats (Phase 6.5.5.4)
// Architecture: UI â†’ resultsService â†’ resultFileService â†’ Supabase Storage + result_files
//   - Upload initial (Storage puis DB) avec rollback automatique
//   - Liste multi-fichiers par publication (Excel + PDF â€¦)
//   - Suppression individuelle d'un fichier (jamais silencieuse)
//   - Remplacement ciblÃ© (upload nouveau â†’ DB â†’ suppression ancien, dernier)
//   - Suppression de publication (Storage + DB, CASCADE relayÃ©)
//   - RÃ©conciliation des orphelins Storage / result_files (admin uniquement)
//
// CONVENTION DE RÃ‰SULTAT STRUCTURÃ‰ :
//   { success:true,  file }                                         â†’ OK
//   { success:true,  file, cleanupWarning:{required,filePath,reason}} â†’ OK mais nettoyage incomplet
//   { success:false, error:{code,message} }                          â†’ Erreur normale
//   { success:false, error:{...}, cleanupWarning:{...} }             â†’ Erreur + incohÃ©rence dÃ©tectÃ©e
//
// RÃˆGLES :  â€¢ Jamais .catch(()=>{}) pour masquer une erreur de nettoyage.
//           â€¢ Le remplacement ne supprime JAMAIS l'ancien avant qu'un nouveau soit
//             uploadÃ© ET enregistrÃ© en DB.
//           â€¢ Jamais de service_role / secret ici â€” RLS has_role('admin') fait barriÃ¨re.
// =============================================================================
import { getSupabaseClient, isSupabaseEnabled } from "./supabaseClient.local.mjs";

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

// Signature simple (non bloquant, complÃ©mentaire Ã  l'extension / MIME).
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
  // VALIDATION â€” extension + taille + signature simple (jamais un antivirus).
  // ---------------------------------------------------------------------------
  async validateFile(file){
    if(!file) return { ok:false, error:"Aucun fichier sÃ©lectionnÃ©." };
    const allowed = [".xlsx", ".xls", ".pdf"];
    const ext = extensionOf(file.name);
    if(!allowed.includes(ext)){
      return { ok:false, error:`Extension non autorisÃ©e (${ext || "inconnue"}). AutorisÃ©s : ${allowed.join(", ")}` };
    }
    if(file.size > FILE_MAX_BYTES){
      return { ok:false, error:`Fichier trop volumineux (${(file.size/1024/1024).toFixed(1)} Mo > 8 Mo).` };
    }
    // Signature simple quand lisible : PDFâ†’%PDF-, XLSXâ†’PK (ZIP), XLSâ†’OLE D0 CF 11 E0.
    if(file.size > 0){
      const sig = await sniffSignature(file);
      const extG = extensionOf(file.name);
      if(extG === ".pdf" && sig && sig !== "%PDF"){
        return { ok:false, error:"Signature invalide : ce n'est pas un vÃ©ritable fichier PDF (%PDF- absent)." };
      }
      if(extG === ".xlsx" && sig && sig !== "PK\x03\x04" && sig !== "PK\x05\x06"){
        return { ok:false, error:"Signature invalide : ce n'est pas un vÃ©ritable fichier XLSX (ZIP/PK absent)." };
      }
      if(extG === ".xls" && sig && sig !== "\xD0\xCF\x11\xE0"){
        return { ok:false, error:"Signature invalide : ce n'est pas un vÃ©ritable fichier XLS (OLE absent)." };
      }
    }
    const mime = fileTypeFromExtension(ext);
    return { ok:true, ext, mime, size:file.size };
  },

  // ---------------------------------------------------------------------------
  // CHEMIN â€” anticollision : results/{school_year}/{publication_id}/{uuid}.{ext}
  // Le nom original reste dans result_files.file_name (jamais seul dans le chemin).
  // ---------------------------------------------------------------------------
  buildPath(publicationId, fileOrExt){
    const ext = typeof fileOrExt === "string" ? fileOrExt : extensionOf(fileOrExt?.name);
    const uuid = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,8);
    // NOTE : school_year optionnel â€” on garde publication_id (stable, groupable) comme
    // premier segment aprÃ¨s le bucket, conformÃ©ment Ã  la convention anticollision.
    return `results/${publicationId}/${uuid}${ext}`;
  },

  // ---------------------------------------------------------------------------
  // LISTE â€” tous les fichiers d'une publication (multi-fichiers), triÃ©s created_at DESC
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
  // UPLOAD â€” valide + upload Storage + INSERT result_files. Rollback auto si DB Ã©choue.
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

      // Ligne DB â€” encadrÃ©e : si elle Ã©choue, on supprime l'objet Storage (rollback explicite, signalÃ© si Ã©chec).
      const { data, error: dbErr } = await supabase.from("result_files").insert({
        publication_id: publication.id,
        file_path: path,
        file_name: String(file.name || "fichier"),
        file_type: v.mime || file.type || null,
        file_size: file.size || 0
      }).select().single();
      if(dbErr){
        // Rollback Storage ; on ne masque pas un Ã©chec de rollback.
        const rm = await supabase.storage.from("results").remove([path]).catch(e=>({ error:e }));
        const cleanupWarning = rm && rm.error
          ? { required:true, filePath:path, reason:"Ã‰chec DB aprÃ¨s upload, et rollback Storage lui-mÃªme en Ã©chec." }
          : undefined;
        return { success:false, error:{ code:"DB_INSERT_FAILED", message:dbErr.message }, cleanupWarning };
      }
      return { success:true, file:mapFile(data) };
    }catch(err){
      // Nettoyage best-effort, signalÃ© (jamais silencieux).
      let warning;
      if(uploaded){
        const rm = await supabase.storage.from("results").remove([path]).catch(e=>({ error:e }));
        if(rm && rm.error) warning = { required:true, filePath:path, reason:"Nettoyage Storage aprÃ¨s Ã©chec impossible ("+rm.error.message+")." };
      }
      return { success:false, error:{ code:"UPLOAD_FAILED", message:err.message }, cleanupWarning:warning };
    }
  },

  // ---------------------------------------------------------------------------
  // SUPPRESSION INDIVIDUELLE â€” un seul fichier (Storage puis DB).
  //   Storage OK + DB OK          â†’ { success:true, file }
  //   Storage OK + DB fail        â†’ { success:false, error:{code:"DB_DELETE_FAILED"}, cleanupWarning }
  //   Storage fail                â†’ on NE supprime PAS la ligne DB (incohÃ©rence remontÃ©e)
  // ---------------------------------------------------------------------------
  async deleteResultFile(fileId){
    if(!isSupabaseEnabled()) return { success:false, error:{ code:"MOCK", message:"Mode mock inactif." } };
    if(!fileId) return { success:false, error:{ code:"FILE_REQUIRED", message:"Identifiant de fichier requis." } };
    const supabase = await getSupabaseClient();

    // 1) Lit la ligne DB (autoritÃ©) pour connaÃ®tre file_path.
    const { data: row, error: findErr } = await supabase
      .from("result_files").select("*").eq("id", fileId).single();
    if(findErr && findErr.code === "PGRST116") return { success:false, error:{ code:"NOT_FOUND", message:"Fichier introuvable." } };
    if(findErr) return { success:false, error:{ code:"DB_FIND_FAILED", message:findErr.message } };

    // 2) Supprime l'objet Storage.
    const storagePath = row.file_path;
    let storageDeleted = false;
    let storageError = null;
    if(storagePath){
      // En mode non-mock rÃ©el, on supprime ; en cas d'Ã©chec on remonte SANS supprimer la DB.
      try{
        const { error } = await supabase.storage.from("results").remove([storagePath]);
        if(error){ storageError = error; }
        else storageDeleted = true;
      }catch(e){ storageError = e; }
      if(storageError){
        return { success:false, error:{ code:"STORAGE_DELETE_FAILED", message:storageError.message||"Ã‰chec de suppression Storage." },
                 cleanupWarning:{ required:true, filePath:storagePath, reason:"Storage non supprimÃ© â€” ligne DB conservÃ©e pour Ã©viter un orphelin silencieux." } };
      }
    } else {
      storageDeleted = true; // pas de Storage associÃ©
    }

    // 3) Supprime la ligne DB.
    const { error: delErr } = await supabase.from("result_files").delete().eq("id", fileId);
    if(delErr){
      // Storage dÃ©jÃ  supprimÃ© mais DB non supprimÃ©e â†’ incohÃ©rence : SIGNALER.
      return { success:false, error:{ code:"DB_DELETE_FAILED", message:delErr.message },
               cleanupWarning:{ required:true, filePath:storagePath||"", reason:"Objet Storage supprimÃ© mais ligne result_files non supprimÃ©e â€” DB Ã  rÃ©parer." } };
    }
    return { success:true, file:mapFile(row) };
  },

  // ---------------------------------------------------------------------------
  // REMPLACEMENT CIBLÃ‰ â€” remplace UN fichier prÃ©cis (oldFileId) par un nouveau.
  //   1. valider nouveau
  //   2. upload nouveau Storage
  //   3. INSERT nouvelle ligne DB
  //   4. vÃ©rifier
  //   5. supprimer ancien objet Storage
  //   6. supprimer ancienne ligne DB
  // Jamais d'inversion ; jamais de .catch(()=>{}) pour le nettoyage.
  // Autres fichiers (ex: PDF si on remplace le xlsx) INTACTS.
  // ---------------------------------------------------------------------------
  async replaceResultFile(publication, oldFileId, file){
    if(!publication || !publication.id) return { success:false, error:{ code:"PUBLICATION_REQUIRED", message:"Publication requise." } };
    if(!oldFileId) return { success:false, error:{ code:"OLD_FILE_REQUIRED", message:"Fichier Ã  remplacer non identifiÃ©." } };

    // 1) Validation + upload du nouveau.
    const v = await this.validateFile(file);
    if(!v.ok) return { success:false, error:{ code:"INVALID_FILE", message:v.error } };

    let supabase;
    try{ supabase = await getSupabaseClient(); }
    catch(e){ return { success:false, error:{ code:"CLIENT", message:e.message } }; }

    const newPath = this.buildPath(publication.id, v.ext);

    // (a) Ancien fichier (pour suppression diffÃ©rÃ©e).
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
          cleanupWarning: rm && rm.error ? { required:true, filePath:newPath, reason:"Ã‰chec DB aprÃ¨s upload ; rollback Storage en Ã©chec." } : undefined
        };
      }

      // 5) Supprimer ANCIEN objet Storage (explicite, erreur remontÃ©e).
      let cleanupWarning;
      if(oldRow.file_path){
        const { error: oldRmErr } = await supabase.storage.from("results").remove([oldRow.file_path]);
        if(oldRmErr){
          cleanupWarning = { required:true, filePath:oldRow.file_path, reason:"Ancien objet Storage non supprimÃ© aprÃ¨s remplacement â€” rÃ©paration requise." };
        }
      }

      // 6) Supprimer ANCIENNE ligne DB (aprÃ¨s Storage). Si celle-ci Ã©choue, on signale.
      const { error: oldDelErr } = await supabase.from("result_files").delete().eq("id", oldFileId);
      if(oldDelErr){
        const warning = cleanupWarning || { required:true, filePath:newPath, reason:"Suppression de l'ancienne ligne result_files en Ã©chec aprÃ¨s remplacement." };
        return { success:true, file:mapFile(newRow), cleanupWarning:warning };
      }

      return { success:true, file:mapFile(newRow), cleanupWarning };
    }catch(err){
      // Rollback du nouveau (explicite).
      let warning;
      if(uploaded){
        const rm = await supabase.storage.from("results").remove([newPath]).catch(e=>({ error:e }));
        if(rm && rm.error) warning = { required:true, filePath:newPath, reason:"Nettoyage du nouveau fichier aprÃ¨s Ã©chec impossible." };
      }
      return { success:false, error:{ code:"REPLACE_FAILED", message:err.message }, cleanupWarning:warning };
    }
  },

  // ---------------------------------------------------------------------------
  // SUPPRESSION PUBLICATION â€” retire Storage (tous fichiers) puis publication.
  //   StratÃ©gie contrÃ´lÃ©e : liste rÃ©fÃ©rences â†’ supprime Storage (collecte Ã©checs) â†’
  //   supprime publication (CASCADE) â†’ remonte cleanupWarning si Storage non nettoyÃ©.
  //   Le fait de supprimer Storage en premier, AVEC capture des Ã©checs, permet de
  //   ne jamais laisser un objet sans suivi : si le DELETE publication Ã©choue, on
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

    // 1) Nettoyage Storage d'abord (tous fichiers), avec capture des Ã©checs.
    const clean = await this.deletePublicationFiles(publication);

    // 2) Suppression publication (CASCADE â†’ result_files + result_search_index).
    const { error: pubErr } = await supabase.from("result_publications").delete().eq("id", publication.id);
    if(pubErr){
      // Publication non supprimÃ©e : s'il reste des objets Storage supprimÃ©s, il peut y avoir
      // des lignes DB pointant vers des fichiers inexistants â†’ on le signale.
      return {
        success:false,
        error:{ code:"PUBLICATION_DELETE_FAILED", message:pubErr.message },
        cleanupWarning: clean.total > 0
          ? { required:true, filePath: clean.failures[0]?.path || "", reason:"Objets Storage supprimÃ©s mais publication non supprimÃ©e â€” rÃ©fÃ©rences DB potentielles cassÃ©es." }
          : undefined
      };
    }

    // 3) Storage non entiÃ¨rement nettoyÃ© â†’ succÃ¨s avec avertissement (jamais masquÃ©).
    if(clean.failures.length){
      return {
        success:true,
        publicationDeleted:true,
        cleanupWarning:{
          required:true,
          filePath: clean.failures[0].path,
          reason:`${clean.failures.length} objet(s) Storage non supprimÃ©(s) aprÃ¨s suppression de publication â€” rÃ©paration requise.`
        }
      };
    }
    return { success:true, publicationDeleted:true };
  },

  // ---------------------------------------------------------------------------
  // RÃ‰CONCILIATION â€” compare result_files.file_path â†” Storage objets du bucket.
  //   RÃ©servÃ©e Ã  admin/super_admin (RLS). Ne supprime JAMAIS automatiquement.
  //   Retourne un rapport ; les actions de rÃ©paration sont explicites et sÃ©parÃ©es.
  // ---------------------------------------------------------------------------
  async reconcileResultFiles(){
    if(!isSupabaseEnabled()) return { dbFiles:[], storageFiles:[], missingInStorage:[], orphanedInStorage:[] };
    const supabase = await getSupabaseClient();

    const { data: dbRows, error: dbErr } = await supabase.from("result_files").select("id, file_path, file_name");
    if(dbErr) throw dbErr;
    const dbFiles = (dbRows||[]).map(r => ({ id:r.id, file_path:r.file_path, file_name:r.file_name }));

    // Listing rÃ©cursif du bucket privÃ© results (relative au bucket, sans prÃ©fixe "results/").
    const storageFiles = [];
    async function walk(prefix){
      const { data, error } = await supabase.storage.from("results").list(prefix || "");
      if(error) throw error;
      for(const entry of (data||[])){
        if(entry.id){ // fichier
          storageFiles.push(prefix ? `${prefix}/${entry.name}` : entry.name);
        }else{ // dossier â†’ parcours rÃ©cursif
          await walk(prefix ? `${prefix}/${entry.name}` : entry.name);
        }
      }
    }
    await walk("");

    // file_path stockÃ© : "results/{pubId}/{uuid}.{ext}" ; le listing Storage (relatif au
    // bucket) renvoie exactement ce mÃªme chemin (buildPath prÃ©fixe dÃ©jÃ  "results/", le SDK
    // ajoute le bucket). On compare donc sans transformation.
    const dbRel = p => p || "";
    const dbPaths = new Set(dbFiles.map(r => dbRel(r.file_path)));
    const storageSet = new Set(storageFiles);

    const missingInStorage = dbFiles.filter(r => !storageSet.has(dbRel(r.file_path)));
    const orphanedInStorage = storageFiles.filter(p => !dbPaths.has(p));

    return { dbFiles, storageFiles, missingInStorage, orphanedInStorage };
  },

  // Actions de rÃ©paration EXPLICITES (jamais automatiques cÃ´tÃ© API).
  //   removeOrphanedInStorage(orphanNames)  â†’ supprime les objets Storage sans ligne DB
  //   removeMissingInStorage(filePath)      â†’ supprime la ligne DB pointant vers un fichier absent
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

// Utile pour consumption front (config fournit enabled). Non utilisÃ© directement ici,
// mais exportÃ© pour clartÃ© de l'architecture.
export function resultsStorageEnabled(){ return isSupabaseEnabled(); }

