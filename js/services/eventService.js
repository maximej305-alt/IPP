// eventService.js — Module Événements connecté à Supabase (Phase 6.5.2)
// Architecture: UI → eventService → supabaseClient → Supabase
// RLS: anon lit published uniquement, editor/admin/super_admin gèrent tout
// XSS: données via textContent côté UI

import { getSupabaseClient, isSupabaseEnabled } from "./supabaseClient.js";

const mockEvents = [
  { id:"e1", title:"Composition du premier trimestre", description:"Épreuves écrites pour tous les niveaux.", start:"2026-08-28", end:"2026-08-30", status:"published", event_date:"2026-08-28", end_date:"2026-08-30" },
  { id:"e2", title:"Semaine technique IPP", description:"Expositions et soutenances.", start:"2026-09-10", end:"2026-09-14", status:"published", event_date:"2026-09-10", end_date:"2026-09-14" },
  { id:"e3", title:"Journée culturelle", description:"Activités culturelles et sportives.", start:"2026-10-05", end:"2026-10-05", status:"published", event_date:"2026-10-05", end_date:"2026-10-05" },
];

function useMock(){ return !isSupabaseEnabled(); }

function mapRow(row){
  if(!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    start: row.event_date,
    end: row.end_date || row.event_date,
    event_date: row.event_date,
    end_date: row.end_date,
    created_at: row.created_at,
    created_by: row.created_by
  };
}

function toDbPayload(data){
  // Normalise frontend {title, description, start/end, status} → DB {event_date, end_date, status}
  const payload = {};
  if(data.title !== undefined) payload.title = String(data.title).trim();
  if(data.description !== undefined) payload.description = String(data.description).trim();
  if(data.start !== undefined) payload.event_date = data.start;
  if(data.event_date !== undefined) payload.event_date = data.event_date;
  if(data.end !== undefined) payload.end_date = data.end || null;
  if(data.end_date !== undefined) payload.end_date = data.end_date || null;
  if(data.status !== undefined) {
    // Map legacy active/programmed → published
    const s = String(data.status).toLowerCase();
    if(s==="active"||s==="programmed") payload.status = "published";
    else payload.status = s;
  }
  // Validation end_date >= event_date gérée côté appelant, mais on normalise
  if(payload.end_date && payload.event_date && payload.end_date < payload.event_date){
    throw new Error("La date de fin doit être postérieure à la date de début");
  }
  return payload;
}

export const eventService = {
  // Public — uniquement publiés, triés par date ASC, limités
  async getPublishedEvents(limit = 20){
    if(useMock()){
      await delay(80);
      return mockEvents.filter(e=>e.status==="published").slice(0, limit).map(e=>({...e}));
    }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("status", "published")
      .order("event_date", { ascending: true })
      .limit(limit);
    if(error) throw error;
    return (data||[]).map(mapRow);
  },

  // Legacy alias
  async list(){
    // Pour compatibilité, si mock on retourne tout, sinon on retourne publiés (public) — admin utilisera getAdminEvents
    if(useMock()) return mockEvents.map(e=>({...e}));
    return this.getPublishedEvents(50);
  },

  async getAdminEvents(){
    if(useMock()){
      await delay(80);
      return mockEvents.map(e=>({...e}));
    }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("events").select("*").order("event_date", { ascending: true });
    if(error) throw error;
    return (data||[]).map(mapRow);
  },

  async getEventById(id){
    if(useMock()){
      await delay(60);
      return mockEvents.find(e=>e.id===id) || null;
    }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("events").select("*").eq("id", id).single();
    if(error) return null;
    return mapRow(data);
  },

  async groupedByMonth(){
    const list = await this.getPublishedEvents(50);
    const groups = {};
    list.forEach(ev=>{
      const d = new Date(ev.event_date || ev.start);
      const key = d.toLocaleDateString("fr-FR",{ month:"long", year:"numeric"});
      const k = key.charAt(0).toUpperCase()+key.slice(1);
      if(!groups[k]) groups[k]=[];
      groups[k].push(ev);
    });
    return groups;
  },

  // Admin — create
  async createEvent(data){
    const title = (data.title||"").trim();
    const description = (data.description||"").trim();
    if(!title) throw new Error("Titre obligatoire");
    if(title.length > 150) throw new Error("Titre trop long (150 max)");
    if(!description) throw new Error("Description obligatoire");
    const payload = toDbPayload(data);
    if(!payload.event_date) throw new Error("Date de début obligatoire");
    payload.status = payload.status || "published";

    if(useMock()){
      const ev = { id:"e"+Date.now(), title, description, start: payload.event_date, end: payload.end_date||payload.event_date, event_date: payload.event_date, end_date: payload.end_date||payload.event_date, status: payload.status };
      mockEvents.push(ev);
      return ev;
    }
    const supabase = await getSupabaseClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    const { data: inserted, error } = await supabase.from("events").insert({
      ...payload,
      created_by: user?.id || null
    }).select().single();
    if(error) throw error;
    return mapRow(inserted);
  },

  // Alias legacy
  async create(ev){ return this.createEvent(ev); },

  async updateEvent(id, patch){
    const payload = toDbPayload(patch);
    if(useMock()){
      const idx = mockEvents.findIndex(e=>e.id===id);
      if(idx>=0) Object.assign(mockEvents[idx], patch, payload);
      return mockEvents[idx] ? {...mockEvents[idx]} : null;
    }
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("events").update(payload).eq("id", id).select().single();
    if(error) throw error;
    return mapRow(data);
  },

  async deleteEvent(id){
    if(useMock()){
      const i=mockEvents.findIndex(e=>e.id===id);
      if(i>=0) mockEvents.splice(i,1);
      return;
    }
    const supabase = await getSupabaseClient();
    const { error } = await supabase.from("events").delete().eq("id", id);
    if(error) throw error;
  },

  async remove(id){ return this.deleteEvent(id); },

  // Helpers statut
  async publishEvent(id){ return this.updateEvent(id, { status:"published" }); },
  async scheduleEvent(id, date){ return this.updateEvent(id, { status:"scheduled", event_date: date }); },

  // Logique À venir / En cours / Terminé (calcul JS)
  getEventState(ev){
    const today = new Date(); today.setHours(0,0,0,0);
    const start = new Date(ev.event_date || ev.start); start.setHours(0,0,0,0);
    const end = new Date(ev.end_date || ev.end || ev.event_date || ev.start); end.setHours(0,0,0,0);
    if(today < start) return "upcoming"; // À venir
    if(today >= start && today <= end) return "ongoing"; // En cours
    return "past"; // Terminé
  }
};

function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
