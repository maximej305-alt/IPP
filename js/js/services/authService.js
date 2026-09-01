// =============================================================================
// authService.js — SUPABASE AUTH RÉEL (Phase 6.4)
// Remplace le MOCK localStorage. Sécurité réelle = Supabase Auth + RLS
// Ne jamais exposer service_role ici — uniquement anonKey via supabaseClient
// =============================================================================
import { getSupabaseClient } from "./supabaseClient.js";

const ROLE_HIERARCHY = { editor: 1, admin: 2, super_admin: 3 };

async function getClient(){
  const c = await getSupabaseClient();
  if(!c) throw new Error("Supabase non configuré");
  return c;
}

export const authService = {
  isMock: false,
  mode: "SUPABASE AUTH",

  // Connexion — vérifie profile + rôle
  async login(email, password){
    const supabase = await getClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if(error) throw new Error(mapAuthError(error));
    const user = data.user;
    if(!user) throw new Error("Connexion échouée");
    const profile = await this.getCurrentProfile();
    if(!profile){
      await supabase.auth.signOut();
      throw new Error("Votre compte existe mais n'est pas encore autorisé à accéder à l'administration IPP.");
    }
    return { user, profile };
  },

  async logout(){
    const supabase = await getClient();
    await supabase.auth.signOut();
    // Supabase nettoie localStorage automatiquement
    location.href = "login.html";
  },

  // Supabase user
  async getCurrentUser(){
    const supabase = await getClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user || null;
  },

  // Profile depuis public.profiles
  async getCurrentProfile(){
    const supabase = await getClient();
    const { data: { user } } = await supabase.auth.getUser();
    if(!user) return null;
    const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    if(error) {
      console.warn("getCurrentProfile:", error.message);
      return null;
    }
    return data;
  },

  async getCurrentRole(){
    const p = await this.getCurrentProfile();
    return p?.role || null;
  },

  // Alias legacy
  async current(){ return this.getCurrentUser(); },

  async requireAuth(){
    const user = await this.getCurrentUser();
    if(!user){
      location.href = "login.html";
      throw new Error("Non authentifié");
    }
    const profile = await this.getCurrentProfile();
    if(!profile){
      await (await getClient()).auth.signOut();
      location.href = "login.html";
      throw new Error("Profil manquant");
    }
    return { user, profile };
  },

  async hasRole(requiredRole){
    const role = await this.getCurrentRole();
    if(!role) return false;
    if(role === requiredRole) return true;
    const need = ROLE_HIERARCHY[requiredRole] || 0;
    const have = ROLE_HIERARCHY[role] || 0;
    return have >= need;
  },

  async hasAnyRole(roles){
    for(const r of roles){ if(await this.hasRole(r)) return true; }
    return false;
  },

  async refreshSession(){
    const supabase = await getClient();
    const { data, error } = await supabase.auth.refreshSession();
    if(error) throw error;
    return data;
  }
};

function mapAuthError(err){
  const msg = (err.message || "").toLowerCase();
  if(msg.includes("invalid login")) return "Email ou mot de passe incorrect.";
  if(msg.includes("email not confirmed")) return "Email non confirmé.";
  if(msg.includes("too many requests")) return "Trop de tentatives, réessayez.";
  return err.message;
}
