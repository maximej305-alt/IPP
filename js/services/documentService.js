// documentService.js — Module Documents connecté à Supabase (Phase 6.5.3)
// Architecture: UI → documentService → supabaseClient → Supabase (DB + Storage bucket documents)
// RLS: anon lit published non expiré, editor/admin/super_admin gèrent
// XSS: UI via textContent (déjà corrigé P2)

import { getSupabaseClient, isSupabaseEnabled } from "./supabaseClient.js";

const mockDocs = [
  { id:"d1", title:"Liste des fournitures — Terminale F2", description:"PDF officiel des fournitures.", file_path:"documents/2026/fournitures.pdf", file_name:"fournitures.pdf", file_type:"application/pdf", file_size: 1200000, date:"2026-08-12", size:"1.2 Mo", status:"published", expires_at:"2026-09-30T00:00:00Z", created_at:"2026-08-12T00:00:00Z" },
];

function useMock(){ return !isSupabaseEnabled(); }

function mapRow(row){
  if(!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    desc: row.description,
    file_path: row.file_path,
    file_name: row.file_name,
    file_type: row.file_type,
    file_size: row.file_size,
    status: row.status,
    expires_at: row.expires_at,
    expires: row.expires_at ? row.expires_at.slice(0,10) : null,
    date: row.created_at ? row.created_at.slice(0,10) : "",
    created_at: row.created_at,
    created_by: row.created_by,
    size: row.file_size ? (row.file_size/1024/1024).toFixed(1)+" Mo" : ""
  };
}

function sanitizeFileName(name){
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(0,80);
}

export const documentService = {
  // Public — uniquement publiés non expirés, tri récents
  async getPublishedDocuments(limit = 20){
    if(useMock()){
      await new Promise(r=>setTimeout(r,60));
      const now = new Date();
      return mockDocs.filter(d=> d.status==="published" && (!d.expires_at || new Date(d.expires_at) > now)).slice(0, limit).map(r=>({...r}));
    }
    const supabase = await getSupabaseClient();
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .eq("status", "published")
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("created_at", { ascending: false })
      .limit(limit);
    if(error) throw error;
    return (data||[]).map(mapRow);
  },

  // Legacy alias
  async list(){ return this.getPublishedDocuments(20); },

  async getAdminDocuments(){
    if(useMock()){
      await new Promise(r=>setTimeout(r,60));
      return mockDocs.map(r=>({...r}));
    }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("documents").select("*").order("created_at", { ascending: false });
    if(error) throw error;
    return (data||[]).map(mapRow);
  },

  // Upload seul — génère path, vérifie PDF ≤8Mo
  async uploadDocument(file){
    if(!file) throw new Error("Aucun fichier sélectionné");
    if(file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) throw new Error("Seuls les PDF sont autorisés");
    if(file.size > 8*1024*1024) throw new Error("Fichier trop volumineux (8 Mo max)");
    if(useMock()){
      const path = `documents/2026/${Date.now()}-${sanitizeFileName(file.name)}`;
      return { path, file_name: file.name, file_type: file.type, file_size: file.size };
    }
    const supabase = await getSupabaseClient();
    const year = new Date().getFullYear();
    const uuid = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36);
    const path = `${year}/${uuid}-${sanitizeFileName(file.name)}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || "application/pdf", upsert: false });
    if(error) throw error;
    return { path, file_name: file.name, file_type: file.type, file_size: file.size };
  },

  async createDocument({ title, description, file, status = "published", expires_at }){
    const t = (title||"").trim();
    if(!t) throw new Error("Titre obligatoire");
    if(t.length > 200) throw new Error("Titre trop long (200 max)");
    let upload = null;
    if(file) upload = await this.uploadDocument(file);
    else if(!useMock()) throw new Error("Fichier PDF obligatoire");

    const payload = {
      title: t,
      description: (description||"").trim(),
      file_path: upload ? upload.path : (file ? file.name : ""),
      file_name: upload ? upload.file_name : file?.name || "",
      file_type: upload ? upload.file_type : "application/pdf",
      file_size: upload ? upload.file_size : 0,
      status,
      expires_at: expires_at ? new Date(expires_at).toISOString() : null
    };

    if(useMock()){
      const row = { id:"d"+Date.now(), ...payload, date: new Date().toISOString().slice(0,10), created_at: new Date().toISOString(), size: payload.file_size ? (payload.file_size/1024/1024).toFixed(1)+" Mo" : "" };
      mockDocs.unshift(row);
      return mapRow(row);
    }
    const supabase = await getSupabaseClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    const { data: inserted, error } = await supabase.from("documents").insert({ ...payload, created_by: user?.id || null }).select().single();
    if(error){
      // Rollback storage si DB échoue
      if(upload) await supabase.storage.from("documents").remove([upload.path]).catch((err)=>{ if(err) console.warn("Storage remove error:", err.message); });
      throw error;
    }
    return mapRow(inserted);
  },

  async updateDocument(id, patch){
    if(useMock()){
      const idx = mockDocs.findIndex(d=>d.id===id);
      if(idx>=0) Object.assign(mockDocs[idx], patch);
      return mockDocs[idx] ? mapRow(mockDocs[idx]) : null;
    }
    const supabase = await getSupabaseClient();
    const dbPatch = {};
    if(patch.title !== undefined) dbPatch.title = patch.title;
    if(patch.description !== undefined) dbPatch.description = patch.description;
    if(patch.status !== undefined) dbPatch.status = patch.status;
    if(patch.expires_at !== undefined) dbPatch.expires_at = patch.expires_at ? new Date(patch.expires_at).toISOString() : null;
    const { data, error } = await supabase.from("documents").update(dbPatch).eq("id", id).select().single();
    if(error) throw error;
    return mapRow(data);
  },

  async deleteDocument(id){
    let row = null;
    if(useMock()){
      const idx = mockDocs.findIndex(d=>d.id===id);
      if(idx>=0) row = mockDocs.splice(idx,1)[0];
      return;
    }
    const supabase = await getSupabaseClient();
    // Récupère file_path pour suppression Storage
    const { data: existing } = await supabase.from("documents").select("file_path").eq("id", id).single();
    row = existing;
    const { error } = await supabase.from("documents").delete().eq("id", id);
    if(error) throw error;
    if(row?.file_path){
      await supabase.storage.from("documents").remove([row.file_path]).catch((err)=>{ if(err) console.warn("Storage remove error:", err.message); });
    }
  },

  // Alias legacy
  async remove(id){ return this.deleteDocument(id); },

  getPublicDocumentUrl(file_path){
    if(!file_path) return "#";
    if(useMock()) return "#";
    // file_path est stocké comme "2026/uuid.pdf" (sans prefix bucket)
    const clean = file_path.startsWith("documents/") ? file_path.slice("documents/".length) : file_path;
    return `https://kmboyqybbfeblzdkdtny.supabase.co/storage/v1/object/public/documents/${clean}`;
  },

  // Helper pour URL via client (async)
  async getPublicUrlAsync(file_path){
    if(useMock()) return "#";
    const supabase = await getSupabaseClient();
    const { data } = supabase.storage.from("documents").getPublicUrl(file_path);
    return data.publicUrl;
  }
};
