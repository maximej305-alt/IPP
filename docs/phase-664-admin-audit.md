# Phase 6.6.4 — Audit Admin avant Production

**Date:** 2026-09-01
**Environnements:** Public `https://ipp-rho.vercel.app` (Vercel, `outputDirectory:"."`, `ssoProtection:null`), Admin `https://maximej305-alt.github.io/IPP/login.html` (GitHub Pages `actions/deploy-pages@v4`), Backend `https://kmboyqybbfeblzdkdtny.supabase.co`

## 1. Architecture actuelle

```
admin/
  login.html, dashboard.html, publications.html, events.html, results.html,
  documents.html, gallery.html, users.html, activity.html
js/
  config/app.config.js (supabase.enabled:true, useMock:true fallback)
  services/supabaseClient.js (getSupabaseClient, isSupabaseEnabled)
  services/authService.js (isMock:false, Supabase Auth: signInWithPassword, signOut, getUser, getProfile, hasRole, requireAuth)
  admin/adminLayout.js (initAdmin({active, requiredRole}) → requireAuth, role hierarchy, logout, mobile toggle)
  services/newsService, eventService, documentService, galleryService, resultsService, resultFileService (tous useMock→!isSupabaseEnabled)
supabase/migrations 0001-0011 (profiles, content, results, storage, RLS, RPC search_student_result)
.github/workflows/deploy-admin.yml (prepare deploy/ + sed <base href="/IPP/"> + upload-pages-artifact → deploy-pages)
vercel.json (cleanUrls:false, rewrites /→/public/index.html, /about→/public/about.html etc, /css→/css)
```

**Flux auth:** `admin/*.html` → `<script type="module"> await initAdmin()` → `authService.requireAuth()` → `supabase.auth.getUser()` + `from("profiles").select` → si null → `location.href="login.html"` ; sinon affiche `layout`, `hasRole` hiérarchique `editor1<admin2<super_admin3`.

## 2. Pages auditées

| Page | JS chargés | initAdmin | requiredRole | Voir le site |
|---|---|---|---|---|
| login.html | authService | — (guard inverse) | — | `https://ipp-rho.vercel.app/` (fix a78cfee) |
| dashboard.html | adminLayout | `await` | — (tout auth) | Vercel OK |
| publications.html | adminLayout, newsService | `await` | `editor` | Vercel OK |
| events.html | adminLayout, eventService | `await` | `editor` | Vercel OK |
| results.html | adminLayout, resultsService, excelService, resultFileService | `await` | `admin` | Vercel OK |
| documents.html | adminLayout, documentService | `await` | `editor` | Vercel OK |
| gallery.html | adminLayout, galleryService | `await` | `editor` | Vercel OK |
| users.html | adminLayout | `await` | `super_admin` (fix a78cfee, avant aucun) | Vercel OK |
| activity.html | adminLayout | `await` | `admin` (fix a78cfee, avant aucun) | Vercel OK |

**Supabase prod:** `AppConfig.supabase.url` + `anonKey` publics (normal), `service_role` jamais front, RLS active (`profiles`, `news`, `events`, `documents`, `gallery`, `result_publications`), Storage `ipp-documents`, `gallery-images`, RPC `search_student_result` sécurisée.

**Déployé vérifié:** `curl -I https://ipp-rho.vercel.app/css/variables.css` 200, `.../about` 200, `.../public/about.html` 200 (via rewrite), `curl -I https://maximej305-alt.github.io/IPP/login.html` 200, `.../dashboard.html` 200, `.../css/variables.css` 200.

## 3. Bugs reproduits (avant P1 correctifs a78cfee)

| # | Bug | Reproduction | Cause |
|---|---|---|---|
| B1 | Bypass login → accès direct `dashboard.html` sans session | Ouvrir `https://maximej305-alt.github.io/IPP/dashboard.html` en nav privée sans login → contenu visible avant JS, flash | `adminLayout.js` ne masquait pas `.admin-layout` avant `requireAuth`, `initAdmin` non `await` sur 4 pages, `users/activity` sans `requiredRole` |
| B2 | `users.html` accessible par `editor` | Login `editor@ipp.tg` → `/users.html` → `200` sans refus | `requiredRole` absent |
| B3 | `activity.html` accessible par `editor` | idem | absent |
| B4 | `gallery.html` accessible sans rôle | idem | absent, `initAdmin` non `await` |
| B5 | Login mock hint trompeur | `login.html:16` affiche “Mode mock : tout mot de passe accepté”, `value="demo"` | restant Phase mock |
| B6 | Login ne redirige pas si déjà connecté | Connecté → retour `login.html` → formulaire affiché | pas de guard inverse |
| B7 | Lien “Voir le site” pointe `../index.html` (404 local / GitHub Pages) | Cliquer `Voir le site` depuis admin GitHub Pages → `../index.html` 404 | href relatif, pas Vercel |
| B8 | Modales : risque ouverture flash | Vérifié `hidden` présent sur `pub-modal`, `doc-modal`, `modal`, `create-modal`, `manage-modal` → OK, mais JS sans garde `layout hidden` pouvait laisser deviner état | non bloquant mais amélioration |
| B9 | Dashboard stats fausses (04,02,01) | `dashboard.html:33` valeurs hardcodées | données Supabase non branchées |
| B10 | Vercel `/about` 404 avant fix `vercel.json` | `https://ipp-rho.vercel.app/about` → `404` (cleanUrls true + rewrite manquante) | `cleanUrls:true` + rewrite seulement `*.html` |

## 4. Causes identifiées

- Protection frontend seulement client-side, pas de hide initial → flash.
- Oubli `requiredRole` sur 3 pages + `await` manquant sur 4 pages (race).
- `login.html` resté en mode mock.
- `Voir le site` relatif, non absolu Vercel.
- `vercel.json` `cleanUrls:true` incompatible avec rewrites `/public/*`.
- Dashboard stats mock.

## 5. Corrections prévues (P1-P13)

- **P1:** `adminLayout.js` → `layout.style.visibility="hidden"` avant `requireAuth`, `""` après ; `login.html` guard inverse + `Retour site public → https://ipp-rho.vercel.app/` ; tous `initAdmin` en `await` + `requiredRole` correct ; déploiement GitHub Pages vérifié `.../dashboard.html` sans session → `login.html`.
- **P2-P4:** Vérifier `hidden` sur toutes modales (`publications:pub-modal`, `documents:doc-modal`, `events:modal`, `results:create-modal/manage-modal/confirm-modal`, `gallery:create-modal/manage-modal/confirm-modal`) — déjà `hidden`, standardiser `open→hidden=false` / `close→hidden=true` + `Escape` + click overlay, garder état fermé au load.
- **P5:** Dashboard → branched Supabase counts ou état vide “Aucune donnée” (pas fausse stat) ; autres modules déjà liés via `isSupabaseEnabled()` → Supabase, tester CRUD avec RLS.
- **P6-P7:** Vérifier nav sidebar `data-admin-nav` + `Voir le site`, console `Vercel 200`, `GitHub Pages 200`, pas d'erreur `MIME`.
- **P8:** Tests prod réels (bypass, login, refresh, logout, modales fermées au load) sur `https://maximej305-alt.github.io/IPP/` et `https://ipp-rho.vercel.app/`.
- **P10:** Vérifier `service_role` jamais front, `anonKey` seul, RLS `has_role`, Storage policies.
- **P11:** Non-régression public `Vercel` (`/results` RPC, `/gallery`, `/documents`).
- **P12-P13:** Commit `fix(admin-auth):...`, `fix(admin-ui):...`, push, `vercel --prod --scope`, `actions/deploy-pages` → rapport final `docs/phase-664-admin-production-fix-report.md`.

*Audit réalisé sans supposition, par lecture code + curl prod + reproduction manuelle nav privée.*
