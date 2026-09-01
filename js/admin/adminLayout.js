import { authService } from "../services/authService.js";
import { requireAdminSession } from "./authGuard.js";

export async function initAdmin({ active, requiredRole }){
  // P1 — Protection centralisée via authGuard (P6.6.4)
  let profile;
  try{
    profile = await requireAdminSession({ requiredRole });
  }catch(e){
    return;
  }
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

  const toggle = document.querySelector("[data-admin-toggle]");
  const sidebar = document.querySelector("[data-admin-sidebar]");
  toggle?.addEventListener("click", ()=> sidebar.classList.toggle("is-open"));
  document.querySelector("[data-logout]")?.addEventListener("click", async (e)=>{
    e.preventDefault();
    await authService.logout();
  });

  // P4 — Fermeture modales via Escape (standard unique)
  document.addEventListener("keydown", (e)=>{
    if(e.key==="Escape"){
      document.querySelectorAll('[id$="-modal"]:not([hidden]), #modal:not([hidden]), #create-modal:not([hidden]), #manage-modal:not([hidden]), #confirm-modal:not([hidden]), #doc-modal:not([hidden]), #pub-modal:not([hidden])').forEach(m=> m.hidden=true);
    }
  });
}
