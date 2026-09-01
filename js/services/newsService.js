// newsService.js — Module Actualités connecté à Supabase (Phase 6.5.1)
// Architecture: UI → newsService → supabaseClient → Supabase
// RLS: anon ne voit que published + published_at <= now() + expires_at > now()
// XSS: données retournées brutes, UI doit utiliser textContent (déjà corrigé P2)

import { getSupabaseClient, isSupabaseEnabled } from "./supabaseClient.js";
import { AppConfig } from "../config/app.config.js";

// Fallback mock si Supabase non configuré (conserve compatibilité locale)
const mockNews = [
  { id: "n1", title: "Composition du premier trimestre", excerpt: "Les compositions débutent le 28 août.", date: "2026-08-10", status: "published", published_at: "2026-08-10T00:00:00Z", expires_at: null, content: "Les compositions débuteront le 28 août 2026." },
];

function useMock(){ return !isSupabaseEnabled(); }

function mapRow(row){
  // Normalise DB → frontend (compatibilité avec ancien code qui attend `date`)
  if(!row) return null;
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    content: row.content,
    status: row.status,
    date: row.published_at ? row.published_at.slice(0,10) : (row.created_at||"").slice(0,10),
    published_at: row.published_at,
    expires_at: row.expires_at,
    image_path: row.image_path,
    created_by: row.created_by,
    created_at: row.created_at
  };
}

export const newsService = {
  // Public — 3 dernières ou limitées, uniquement publiées non expirées
  async getPublishedNews(limit = 10){
    if(useMock()){
      await delay(80);
      const now = new Date();
      return mockNews.filter(n => n.status==="published" && (!n.expires_at || new Date(n.expires_at) > now)).slice(0, limit).map(mapRow);
    }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from("news")
      .select("*")
      .eq("status", "published")
      .lte("published_at", new Date().toISOString())
      .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
      .order("published_at", { ascending: false })
      .limit(limit);
    if(error) throw error;
    return (data||[]).map(mapRow);
  },

  // Legacy alias pour compatibilité (public/index.html utilisait list())
  async list({ status = "active", limit } = {}){
    if(status === "all") return this.getAdminNews();
    if(status === "active") return this.getPublishedNews(limit || 10);
    return this.getPublishedNews(limit || 10);
  },

  async getNewsById(id){
    if(useMock()){
      await delay(60);
      return mockNews.find(n=>n.id===id) || null;
    }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("news").select("*").eq("id", id).single();
    if(error) return null;
    // Si anon, RLS garantit que seul published visible est retourné
    return mapRow(data);
  },

  // Alias legacy
  async getById(id){ return this.getNewsById(id); },

  // Admin — toutes les news (nécessite has_role editor)
  async getAdminNews(){
    if(useMock()){
      await delay(80);
      return mockNews.map(mapRow);
    }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("news").select("*").order("created_at", { ascending: false });
    if(error) throw error;
    return (data||[]).map(mapRow);
  },

  async createNews(payload){
    const title = (payload.title||"").trim();
    const content = (payload.content||"").trim();
    if(!title || !content) throw new Error("Titre et contenu obligatoires");
    if(title.length > 200) throw new Error("Titre trop long (200 max)");
    const excerpt = (payload.excerpt||content.slice(0,120)).trim();
    const status = payload.status || "draft";
    const published_at = payload.published_at || (status==="published" ? new Date().toISOString() : null);
    const expires_at = payload.expires_at || null;

    if(useMock()){
      const row = { id:"n"+Date.now(), title, excerpt, content, status, published_at, expires_at, date: (published_at||new Date().toISOString()).slice(0,10), created_at: new Date().toISOString() };
      mockNews.unshift(row);
      return mapRow(row);
    }
    const supabase = await getSupabaseClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    const { data: inserted, error } = await supabase.from("news").insert({
      title, excerpt, content, status, published_at, expires_at,
      created_by: user?.id || null
    }).select().single();
    if(error) throw error;
    return mapRow(inserted);
  },

  // Alias legacy
  async create(entry){ return this.createNews(entry); },

  async updateNews(id, patch){
    if(useMock()){
      const idx = mockNews.findIndex(n=>n.id===id);
      if(idx>=0) Object.assign(mockNews[idx], patch);
      return mockNews[idx] ? mapRow(mockNews[idx]) : null;
    }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("news").update(patch).eq("id", id).select().single();
    if(error) throw error;
    return mapRow(data);
  },

  async deleteNews(id){
    if(useMock()){
      const idx = mockNews.findIndex(n=>n.id===id);
      if(idx>=0) mockNews.splice(idx,1);
      return;
    }
    const supabase = await getSupabaseClient();
    const { error } = await supabase.from("news").delete().eq("id", id);
    if(error) throw error;
  },

  async remove(id){ return this.deleteNews(id); },

  async publishNews(id){
    return this.updateNews(id, { status:"published", published_at: new Date().toISOString() });
  },

  async scheduleNews(id, publishDate){
    return this.updateNews(id, { status:"scheduled", published_at: new Date(publishDate).toISOString() });
  }
};

function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
