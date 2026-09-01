// authGuard.js — P1 Protection centralisée admin (Phase 6.6.4)
// Vérifie session Supabase + profile avant affichage page admin.
// Utilisé par adminLayout.initAdmin, exposé séparément pour audit P1.
import { authService } from "../services/authService.js";

export async function requireAdminSession({ requiredRole } = {}){
  // Masque layout immédiatement (évite flash)
  const layout = document.querySelector(".admin-layout");
  if(layout) layout.style.visibility = "hidden";
  // Retry 3x pour laisser Supabase restaurer session depuis localStorage (GH Pages)
  let lastErr;
  for(let i=0;i<3;i++){
    try{
      const { profile } = await authService.requireAuth();
      if(requiredRole){
        const ok = await authService.hasRole(requiredRole);
        if(!ok){
          alert(`Accès refusé : rôle insuffisant (${profile?.role} < ${requiredRole})`);
          location.href = "dashboard.html";
          throw new Error("role insuffisant");
        }
      }
      if(layout) layout.style.visibility = "";
      return profile;
    }catch(e){
      lastErr = e;
      // Si c'est une redirection déjà, ne pas retry
      if(e && e.message && e.message.includes("Non authentifié")) {
        if(i<2) await new Promise(r=>setTimeout(r, 400));
        else throw e;
      } else if(e && e.message && e.message.includes("Profil manquant")){
        throw e;
      } else {
        // Autre erreur (réseau), retry
        if(i<2) await new Promise(r=>setTimeout(r, 400));
      }
    }
  }
  throw lastErr;
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
