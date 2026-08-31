// Local supabase client for Node-based harness (Phase 6.5.5.4).
// Browser versions of resultFileService import supabaseClient.js which loads the
// SDK from CDN (not usable in Node). This mirror provides a tokenized client.
// URL + clé anon proviennent du config partagé (js/config/app.config.js) pour
// éviter toute duplication de clé ici.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { AppConfig } from "../../js/config/app.config.js";

export const SUPABASE_URL = process.env.IPP_SUPABASE_URL || AppConfig.supabase.url;
export const SUPABASE_ANON = process.env.IPP_SUPABASE_ANON || AppConfig.supabase.anonKey;

function tokenFrom(env, fallback){
  if(process.env[env]) return process.env[env].trim();
  try { return fs.readFileSync(fallback, "utf8").trim(); } catch(e){ return ""; }
}

const ADMIN_TOKEN = tokenFrom("IPP_ADMIN_TOKEN", "C:/Users/ken/AppData/Local/Temp/opencode/ip7_admin.txt");
const EDITOR_TOKEN = tokenFrom("IPP_EDITOR_TOKEN", "C:/Users/ken/AppData/Local/Temp/opencode/ip7_editor.txt");

const make = (token) => createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: "Bearer " + token } } });

let client = null;
export async function getSupabaseClient(role){
  const token = role === "editor" ? EDITOR_TOKEN : ADMIN_TOKEN;
  // Le service peut s'appeler avec plusieurs rôles ; on renvoie un client par rôle.
  if(role === "editor") return make(EDITOR_TOKEN);
  if(!client) client = make(token);
  return client;
}
export function isSupabaseEnabled(){ return true; }
export { ADMIN_TOKEN, EDITOR_TOKEN };
