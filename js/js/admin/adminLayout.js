import { authService } from "../services/authService.js";

export async function initAdmin({ active, requiredRole }){
  // P8 — Protection réelle : requireAuth vérifie session Supabase + profile
  let auth;
  try{
    auth = await authService.requireAuth();
  }catch(e){
    // requireAuth redirige déjà vers login.html si non connecté
    return;
  }
  const profile = auth.profile;
  const nameEl = document.querySelector("[data-admin-name]");
  if(nameEl) nameEl.textContent = profile?.full_name || profile?.role || "Administrateur";

  // Navigation active
  document.querySelectorAll("[data-admin-nav]").forEach(a=>{
    if(a.dataset.adminNav===active) a.classList.add("is-active");
  });

  // P8 — Masquage UI selon rôle (UX seulement, RLS reste la vraie barrière)
  const role = profile?.role;
  document.querySelectorAll("[data-role]").forEach(el=>{
    const need = el.dataset.role; // ex: data-role="admin"
    // hasRole synchrone rapide via hierarchy locale (évite await dans boucle)
    const hierarchy = { editor:1, admin:2, super_admin:3 };
    const have = hierarchy[role]||0, needVal = hierarchy[need]||0;
    if(have < needVal) el.style.display = "none";
  });

  // Vérif rôle requis pour la page (ex: users.html nécessite super_admin)
  if(requiredRole){
    const ok = await authService.hasRole(requiredRole);
    if(!ok){
      alert("Accès refusé : rôle insuffisant ("+role+" < "+requiredRole+")");
      location.href = "dashboard.html";
      return;
    }
  }

  const toggle = document.querySelector("[data-admin-toggle]");
  const sidebar = document.querySelector("[data-admin-sidebar]");
  toggle?.addEventListener("click", ()=> sidebar.classList.toggle("is-open"));
  document.querySelector("[data-logout]")?.addEventListener("click", async (e)=>{
    e.preventDefault();
    await authService.logout();
  });
}
