// authGuard.js — P1 Protection centralisée admin (Phase 6.6.4)
// Vérifie session Supabase + profile avant affichage page admin.
// Utilisé par adminLayout.initAdmin, exposé séparément pour audit P1.
import { authService } from "../services/authService.js";

export async function requireAdminSession({ requiredRole } = {}){
  // Masque layout immédiatement (évite flash)
  const layout = document.querySelector(".admin-layout");
  if(layout) layout.style.visibility = "hidden";
  try{
    const { profile } = await authService.requireAuth(); // redirect login si null
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
    // requireAuth a déjà redirigé vers login.html
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
