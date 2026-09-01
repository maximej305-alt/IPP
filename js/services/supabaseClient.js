// supabaseClient.js — Préparation Phase 5.8-5.10 (P12)
// Centralise la création du client. En mode MOCK, retourne null.
// Quand AppConfig.supabase.enabled=true, ce fichier initialise le vrai client.
// NE JAMAIS y mettre service_role key — uniquement anonKey publique.

import { AppConfig } from "../config/app.config.js";

let client = null;

export async function getSupabaseClient(){
  if(!AppConfig.supabase.enabled || !AppConfig.supabase.url || !AppConfig.supabase.anonKey){
    return null; // Mode MOCK — aucun appel réseau
  }
  if(client) return client;
  // Import dynamique avec fallback (cdn.jsdelivr → esm.sh) + timeout
  let createClient;
  try{
    const mod = await Promise.race([
      import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"),
      new Promise((_,rej)=> setTimeout(()=>rej(new Error("timeout cdn.jsdelivr")), 5000))
    ]);
    createClient = mod.createClient;
  }catch(e1){
    console.warn("supabase cdn.jsdelivr failed, fallback esm.sh", e1.message);
    const mod2 = await import("https://esm.sh/@supabase/supabase-js@2");
    createClient = mod2.createClient;
  }
  client = createClient(AppConfig.supabase.url, AppConfig.supabase.anonKey);
  return client;
}

// Helper pour vérifier si on est en mode réel
export function isSupabaseEnabled(){
  return AppConfig.supabase.enabled && !!AppConfig.supabase.url;
}
