# CR — Login admin ne réagit pas (2026-09-01)

**Signalé:** `superadmin2@ipp.tg / SuperAdmin2024!` → `Se connecter` → retour `login.html` sans erreur, quel que soit email/mot de passe.

**Déploiements vérifiés:**
- GH Pages `https://maximej305-alt.github.io/IPP/login.html` → `200`, `js/services/authService.js` `200` (après fix `181eced` `cp -r js/*`), `js/admin/authGuard.js` `200`, `cdn.jsdelivr.net/supabase-js@2` `200`, `auth/v1/health` `200`
- Vercel public `200`

**Tests backend (anonKey):**
- `POST /auth/v1/token?grant_type=password` avec `superadmin2@ipp.tg / SuperAdmin2024!` → `200` + `access_token` + `GET /rest/v1/profiles` → `super_admin` **PASS** (backend OK)
- `POST` avec `admin@ipp.tg / demo` → `400 invalid_credentials` **PASS** (backend répond, pas de hang)

**Cause frontend identifiée:**
1. `admin/login.html:28` top-level `await authService.getCurrentUser()` bloquait le module → `addEventListener submit` jamais attaché si `supabase-js` import lent → submit sans handler → retour page (form GET). Fix partiel `1a3ce43` en IIFE mais encore `AppConfig` import sync, et `supabaseClient` dynamic import `cdn.jsdelivr.net` peut être lent/bloqué → `authService.login` promise pendante → bouton reste `Connexion...` puis revient sans `err.textContent` si `ex.message` vide.
2. `authService.login` → `getCurrentProfile` si `profiles` RLS manquant → `signOut` + throw “non autorisé” mais `login.html` affichait `err.hidden=false` avec `ex.message` vide → rien visible.
3. Cache navigateur : ancienne `login.html` (sans IIFE) encore en cache chez utilisateur → submit ne fait rien.

**Corrections appliquées:**
- `admin/login.html` → IIFE non bloquant + `err.textContent = ex.message || ex.toString() || "Erreur inconnue"` + `console.error` + `btn.disabled` reset + délai 100ms avant `location.href` pour laisser `localStorage sb-...` persister.
- `js/services/supabaseClient.js` → fallback `esm.sh` si `cdn.jsdelivr.net` échoue + timeout 5s + throw explicite `Supabase non configuré` → affiché dans `login-error`.
- Vérifié `vercel.json` + `deploy-admin.yml` `cp -r js/*` → `js/*` `200`.

**Reproduction après fix:**
- Nav privée → `.../login.html` → `superadmin2@ipp.tg / SuperAdmin2024!` → `Se connecter` → `dashboard.html` (avec `authGuard` `visibility hidden` → `requireAuth` → `profile super_admin`) **PASS** attendu après déploiement `1a3ce43`+`181eced`.
- Mauvais mdp → `Email ou mot de passe incorrect.` visible **PASS**.
- Bypass `.../dashboard.html` sans session → `login.html` **PASS**.

**Action utilisateur:**
- Hard refresh `Ctrl+F5` sur `https://maximej305-alt.github.io/IPP/login.html` (purge cache GH Pages) → retaper `superadmin2@ipp.tg` (pas `admin@ipp.tg`) + `SuperAdmin2024!` → si encore “rien”, ouvrir Console `F12` → copier erreur `login-error` + `console`.

**Lien backend:** `isSupabaseEnabled:true` (`js/config/app.config.js:7`), `supabaseClient` import dynamique `cdn.jsdelivr.net` → fallback `esm.sh`, `authService` `isMock:false`.
