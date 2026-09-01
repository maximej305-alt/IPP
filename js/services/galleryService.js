// =============================================================================
// galleryService.js — Gestion réelle de la galerie (Phase 6.6.2.2)
// Architecture: UI → galleryService → supabaseClient → Supabase
//   - gallery_albums  : les albums (title, description, event_date, cover_image_path)
//   - gallery_images  : les images rattachées à un album (cascade FK)
//   - Storage bucket  : "gallery" (public, ≤5 Mo, jpeg/png/webp/jpg)
// RLS : lecture publique (anon), écriture editor (has_role('editor') inclut admin/super_admin).
// XSS : toute donnée dynamique doit être rendue via textContent (jamais innerHTML).
// Aucune donnée fictive en mode réel ; en mode mock on retourne des listes vides.
// =============================================================================
import { getSupabaseClient, isSupabaseEnabled } from "./supabaseClient.js";

const GALLERY_BUCKET = "gallery";
const MAX_SIZE = 5 * 1024 * 1024; // 5 Mo (cohérent avec la config bucket)
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];

function useMock(){ return !isSupabaseEnabled(); }

// ---------------------------------------------------------------------------
// MAPPING (DB → objet UI)
// ---------------------------------------------------------------------------
function mapAlbum(row){
  if(!row) return null;
  const year = row.event_date ? String(row.event_date).slice(0, 4) : null;
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    event_date: row.event_date,
    year,
    cover_image_path: row.cover_image_path || null,
    created_at: row.created_at,
    _imageCount: row._imageCount != null ? row._imageCount : 0
  };
}

// ---------------------------------------------------------------------------
// PUBLIC — albums
// ---------------------------------------------------------------------------
// Retourne les albums réels triés (le plus récent d'abord), avec le compteur
// d'images calculé côté serveur (agrégation) pour éviter de tout télécharger.
async function getAlbums(){
  if(useMock()) return [];
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("gallery_albums")
    .select("*, gallery_images(count)")
    .order("event_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if(error) throw error;
  return (data || []).map(r => mapAlbum({
    ...r,
    _imageCount: (r.gallery_images && r.gallery_images[0] && r.gallery_images[0].count) || 0
  }));
}

async function getAlbumById(id){
  if(!id) return null;
  if(useMock()) return null;
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("gallery_albums")
    .select("*, gallery_images(count)")
    .eq("id", id)
    .single();
  if(error) return null;
  return mapAlbum({
    ...data,
    _imageCount: (data.gallery_images && data.gallery_images[0] && data.gallery_images[0].count) || 0
  });
}

// ---------------------------------------------------------------------------
// PUBLIC — images d'un album
// ---------------------------------------------------------------------------
// Retourne les chemins Storage des images (triées par sort_order puis date).
// Le frontend construit ensuite les URLs publiques via getPublicUrl().
async function getAlbumImages(albumId){
  if(!albumId) return [];
  if(useMock()) return [];
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("gallery_images")
    .select("id, image_path, caption, sort_order")
    .eq("album_id", albumId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if(error) throw error;
  return (data || []).map(img => ({
    id: img.id,
    image_path: img.image_path,
    caption: img.caption || "",
    sort_order: img.sort_order
  }));
}

// Retourne l'URL publique d'un objet du bucket gallery (ou null).
// Les appels se font par image ; en cas d'échec on retourne null (le frontend
// affiche alors un placeholder, sans casser la grille).
async function getPublicUrl(path){
  if(!path) return null;
  if(useMock()) return null;
  const supabase = await getSupabaseClient();
  const { data } = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(path);
  return data && data.publicUrl ? data.publicUrl : null;
}

// ---------------------------------------------------------------------------
// ADMIN — création / mise à jour d'album
// ---------------------------------------------------------------------------
async function createAlbum({ title, description, event_date }){
  const t = (title || "").trim();
  if(!t) return { success: false, error: { code: "INVALID_FIELD", message: "Le titre est obligatoire." } };
  const payload = { title: t };
  if(description != null) payload.description = String(description).trim();
  if(event_date) payload.event_date = event_date;
  if(useMock()) return { success: true, album: { id: "a"+Date.now(), title: t }, mock: true };
  const supabase = await getSupabaseClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  payload.created_by = user?.id || null;
  const { data: inserted, error } = await supabase.from("gallery_albums").insert(payload).select().single();
  if(error) return { success: false, error: { code: error.code || "DB_ERROR", message: error.message } };
  return { success: true, album: mapAlbum(inserted) };
}

async function updateAlbum(id, patch){
  if(!id) return { success: false, error: { code: "INVALID_ID", message: "Identifiant manquant." } };
  if(useMock()) return { success: true, album: { id } };
  const dbPatch = {};
  if(patch.title !== undefined) dbPatch.title = String(patch.title).trim();
  if(patch.description !== undefined) dbPatch.description = String(patch.description).trim();
  if(patch.event_date !== undefined) dbPatch.event_date = patch.event_date || null;
  if(patch.cover_image_path !== undefined) dbPatch.cover_image_path = patch.cover_image_path;
  if(Object.keys(dbPatch).length === 0) return { success: true };
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.from("gallery_albums").update(dbPatch).eq("id", id).select().single();
  if(error) return { success: false, error: { code: error.code || "DB_ERROR", message: error.message } };
  return { success: true, album: mapAlbum(data) };
}

// ---------------------------------------------------------------------------
// ADMIN — upload d'image (Storage → DB avec rollback)
// ---------------------------------------------------------------------------
// Pipeline : valider → upload storage → INSERT gallery_images.
// Si l'INSERT échoue après l'upload, on tente de supprimer l'objet Storage
// (rollback) et on remonte un résultat structuré avec cleanupWarning éventuel.
async function uploadImage({ albumId, file }){
  const v = validateImage(file);
  if(!v.ok){
    return { success: false, error: { code: v.code || "INVALID_FILE", message: v.error } };
  }
  if(useMock()) return { success: true, mock: true };

  const path = buildImagePath(albumId, file.name);
  const supabase = await getSupabaseClient();

  // 1) UPLOAD STORAGE
  const up = await supabase.storage.from(GALLERY_BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type || "application/octet-stream",
    upsert: false
  });
  if(up.error){
    return { success: false, error: { code: up.error.code || "STORAGE_UPLOAD", message: up.error.message } };
  }

  // 2) INSERT DB
  const { data, error } = await supabase.from("gallery_images").insert({
    album_id: albumId,
    image_path: path,
    caption: null,
    sort_order: 0
  }).select("id, image_path, caption, sort_order").single();

  if(error){
    // ROLLBACK Storage — explicite ; un échec de nettoyage est signalé.
    const del = await supabase.storage.from(GALLERY_BUCKET).remove([path]);
    const result = {
      success: false,
      error: { code: error.code || "DB_INSERT", message: error.message }
    };
    if(del.error){
      result.cleanupWarning = {
        operation: "storage_rollback",
        reason: del.error.message,
        path
      };
    }
    return result;
  }

  // 3) Mise à jour de la couverture si l'album n'en a pas encore.
  await ensureCover(albumId, path);

  return { success: true, image: { id: data.id, image_path: data.image_path, caption: data.caption || "", sort_order: data.sort_order } };
}

// Si l'album n'a pas de couverture, on utilise la première image uploadée.
async function ensureCover(albumId, path){
  if(!albumId || !path) return;
  try{
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("gallery_albums").select("cover_image_path").eq("id", albumId).single();
    if(error || !data || data.cover_image_path) return;
    await supabase.from("gallery_albums").update({ cover_image_path: path }).eq("id", albumId);
  }catch(_){ /* non bloquant */ }
}

// ---------------------------------------------------------------------------
// ADMIN — upload multiple
// ---------------------------------------------------------------------------
async function uploadImages({ albumId, files }){
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  const results = [];
  let successCount = 0, failCount = 0, warnings = [];
  for(const file of list){
    const r = await uploadImage({ albumId, file });
    results.push(r);
    if(r.success) successCount++;
    else {
      failCount++;
      if(r.cleanupWarning) warnings.push(r.cleanupWarning);
    }
  }
  return { success: failCount === 0, successCount, failCount, results, cleanupWarnings: warnings };
}

// ---------------------------------------------------------------------------
// ADMIN — suppression d'image (DB d'abord, puis Storage)
// ---------------------------------------------------------------------------
// Stratégie : DELETE DB d'abord (sécurité : supprime la référence), puis DELETE
// Storage. Si le DELETE Storage échoue, on ne masque pas : on remonte un
// cleanupWarning (le fichier devient orphelin à réconcilier).
async function deleteImage(imageId){
  if(!imageId) return { success: false, error: { code: "INVALID_ID", message: "Identifiant manquant." } };
  if(useMock()) return { success: true };
  const supabase = await getSupabaseClient();
  const { data: row, error: getErr } = await supabase.from("gallery_images").select("id, image_path").eq("id", imageId).single();
  if(getErr || !row){
    return { success: false, error: { code: getErr?.code || "NOT_FOUND", message: getErr?.message || "Image introuvable." } };
  }
  const { error: delDb } = await supabase.from("gallery_images").delete().eq("id", imageId);
  if(delDb){
    return { success: false, error: { code: delDb.code || "DB_DELETE", message: delDb.message } };
  }
  // Si la couverture supprimée était celle de l'album → on réinitialise la couverture.
  await clearCoverIfNeeded(row.image_path);

  const delSt = await supabase.storage.from(GALLERY_BUCKET).remove([row.image_path]);
  if(delSt.error){
    return {
      success: true,
      cleanupWarning: {
        operation: "storage_delete",
        reason: delSt.error.message,
        path: row.image_path
      }
    };
  }
  return { success: true };
}

// Si l'image supprimée était la couverture de son album, on la remet à null
// (uniquement si le schéma et le besoin le permettent — décision documentée).
async function clearCoverIfNeeded(imagePath){
  if(!imagePath) return;
  try{
    const supabase = await getSupabaseClient();
    const { data } = await supabase.from("gallery_albums").select("id, cover_image_path").eq("cover_image_path", imagePath);
    if(!data || data.length === 0) return;
    for(const a of data){
      await supabase.from("gallery_albums").update({ cover_image_path: null }).eq("id", a.id);
    }
  }catch(_){ /* non bloquant */ }
}

// ---------------------------------------------------------------------------
// ADMIN — suppression d'album (Storage puis DB)
// ---------------------------------------------------------------------------
// gallery_images est en ON DELETE CASCADE → supprimer l'album supprime ses lignes
// images. MAIS les objets Storage ne sont PAS supprimés par la cascade : on les
// liste et on les retire explicitement. Stratégie : on supprime d'abord les objets
// Storage puis la ligne album ; un échec Storage est signalé (cleanupWarning)
// sans bloquer la suppression de l'album.
async function deleteAlbum(albumId){
  if(!albumId) return { success: false, error: { code: "INVALID_ID", message: "Identifiant manquant." } };
  if(useMock()) return { success: true };

  const supabase = await getSupabaseClient();
  // Chemins Storage des images de l'album
  const { data: imgs, error: imgErr } = await supabase.from("gallery_images").select("image_path").eq("album_id", albumId);
  if(imgErr){
    return { success: false, error: { code: imgErr.code || "DB_ERROR", message: imgErr.message } };
  }
  const paths = (imgs || []).map(i => i.image_path).filter(Boolean);

  let cleanupWarning = null;
  if(paths.length > 0){
    const delSt = await supabase.storage.from(GALLERY_BUCKET).remove(paths);
    if(delSt.error){
      cleanupWarning = {
        operation: "storage_delete_album",
        reason: delSt.error.message,
        paths
      };
    }
  }

  const { error: delAlbum } = await supabase.from("gallery_albums").delete().eq("id", albumId);
  if(delAlbum){
    return { success: false, error: { code: delAlbum.code || "DB_DELETE", message: delAlbum.message }, cleanupWarning };
  }
  return { success: true, cleanupWarning };
}

// ---------------------------------------------------------------------------
// VALIDATION FICHIER (5 Mo, types autorisés)
// ---------------------------------------------------------------------------
function validateImage(file){
  if(!file) return { ok: false, code: "NO_FILE", error: "Aucun fichier sélectionné." };
  const type = (file.type || "").toLowerCase();
  if(!ALLOWED_TYPES.includes(type)){
    return { ok: false, code: "INVALID_TYPE", error: `Type non autorisé (${type || "inconnu"}). Autorisés: ${ALLOWED_TYPES.join(", ")}` };
  }
  if(file.size > MAX_SIZE){
    return { ok: false, code: "INVALID_SIZE", error: `Fichier trop volumineux (${(file.size/1024/1024).toFixed(1)} Mo > 5 Mo).` };
  }
  if(file.size === 0){
    return { ok: false, code: "EMPTY_FILE", error: "Le fichier est vide." };
  }
  return { ok: true };
}

// Construit un chemin Storage sécurisé : gallery/{albumId}/{timestamp}-{sanitized name}
function buildImagePath(albumId, fileName){
  const safe = String(fileName || "image").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60);
  const ext = safe.slice(safe.lastIndexOf("."));
  const base = safe.slice(0, safe.lastIndexOf(".")) || "image";
  return `${albumId}/${Date.now()}-${base}${ext}`;
}

export const galleryService = {
  getAlbums,
  getAlbumById,
  getAlbumImages,
  getPublicUrl,
  createAlbum,
  updateAlbum,
  uploadImage,
  uploadImages,
  deleteImage,
  deleteAlbum,
  validateImage,
  GALLERY_BUCKET,
  MAX_SIZE,
  ALLOWED_TYPES
};
