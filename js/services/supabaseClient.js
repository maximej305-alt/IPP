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
  // Import dynamique pour ne pas charger le SDK en mode mock (économise plan gratuit)
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  client = createClient(AppConfig.supabase.url, AppConfig.supabase.anonKey);
  return client;
}

// Helper pour vérifier si on est en mode réel
export function isSupabaseEnabled(){
  return AppConfig.supabase.enabled && !!AppConfig.supabase.url;
}
