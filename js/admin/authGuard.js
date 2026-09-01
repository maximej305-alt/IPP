// authGuard.js — P1 Protection centralisée admin (Phase 6.6.4)
// Vérifie session Supabase + profile avant affichage page admin.
// Utilisé par adminLayout.initAdmin, exposé séparément pour audit P1.
import { authService } from "../services/authService.js";

const CACHE_KEY="ipp_admin_profile"; const CACHE_TTL=5*60*1000;
function getCachedProfile(){
  try{
    const raw=sessionStorage.getItem(CACHE_KEY);
    if(!raw) return null;
    const {profile, ts}=JSON.parse(raw);
    if(Date.now()-ts > CACHE_TTL) return null;
    return profile;
  }catch{ return null; }
}
function setCachedProfile(p){ try{ sessionStorage.setItem(CACHE_KEY, JSON.stringify({profile:p, ts:Date.now()})); }catch{} }

export async function requireAdminSession({ requiredRole } = {}){
  const layout = document.querySelector(".admin-layout");
  const cached = getCachedProfile();
  // Affichage immédiat avec cache (fluide) — validation en arrière-plan
  if(cached){
    if(layout) layout.style.visibility = "";
    // Vérif rôle cache rapide
    if(requiredRole){
      const hierarchy={editor:1,admin:2,super_admin:3};
      if((hierarchy[cached.role]||0) < (hierarchy[requiredRole]||0)){
        alert(`Accès refusé : rôle insuffisant (${cached.role} < ${requiredRole})`);
        location.href="dashboard.html"; throw new Error("role insuffisant");
      }
    }
    // Revalidation async sans bloquer
    authService.requireAuth().then(({profile})=>{
      setCachedProfile(profile);
      if(requiredRole) authService.hasRole(requiredRole).then(ok=>{
        if(!ok){ alert(`Accès refusé : rôle insuffisant (${profile?.role} < ${requiredRole})`); location.href="dashboard.html"; }
      });
    }).catch(()=>{ sessionStorage.removeItem(CACHE_KEY); });
    return cached;
  }
  // Pas de cache → masque et attend réseau (1 seule tentative rapide)
  if(layout) layout.style.visibility = "hidden";
  try{
    const { profile } = await authService.requireAuth();
    setCachedProfile(profile);
    if(requiredRole){
      const ok = await authService.hasRole(requiredRole);
      if(!ok){
        alert(`Accès refusé : rôle insuffisant (${profile?.role} < ${requiredRole})`);
        location.href = "dashboard.html"; throw new Error("role insuffisant");
      }
    }
    if(layout) layout.style.visibility = "";
    return profile;
  }catch(e){
    if(layout) layout.style.visibility = "";
    throw e;
  }
}

// Guard pour login.html : si déjà connecté → dashboard
export async function redirectIfAuthenticated(){
  try{
    const user = await authService.getCurrentUser();
    if(user){
      const profile = await authService.getCurrentProfile();
      if(profile) location.href = "dashboard.html";
    }
  }catch(e){}
}
