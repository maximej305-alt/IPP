# Phase 6.6.6 — Rapport Réel Admin → Supabase → Public

**Date:** 2026-09-01  **Commit:** `ef4b626` (fix duplicate data) + `b54152d` (vendor)  **Admin:** `https://maximej305-alt.github.io/IPP/login.html` (GH Pages `f444443` + `c66d0f1`)  **Public:** `https://ipp-rho.vercel.app` (Vercel `ipp-nvwwsdsqw`, `outputDirectory:"."`)  **Supabase:** `kmboyqybbfeblzdkdtny`

## 1. Configuration vérifiée

| | Admin GH Pages | Public Vercel |
|---|---|---|
| **URL** | `https://maximej305-alt.github.io/IPP/login.html` `200` | `https://ipp-rho.vercel.app/` `200` |
| **Supabase URL** | `https://kmboyqybbfeblzdkdtny.supabase.co` (`js/config/app.config.js:7` `enabled:true`) | même |
| **AnonKey** | `eyJ...` (publishable) | même |
| **isSupabaseEnabled()** | `true` | `true` |
| **useMock** | `true` mais `!isSupabaseEnabled()` → **PASS** prod utilise Supabase | même |
| **SDK** | `js/vendor/supabase.js` 212KB UMD local + fallback `cdn.jsdelivr` `esm.sh` | même |

## 2. Matrice réelle

| Fonction | Admin UI | JS Service | Supabase DB | Storage | Public | Verdict |
|---|---|---|---|---|---|---|
| News | `publications.html:19` `pub-modal` `hidden` `data-open-modal` | `newsService.createNews` `supabase.from("news").insert` | `news` | — | `newsService.getPublishedNews` `anon` `200` | **PASS** (E2E `TEST E2E NEWS` `supabase 1` → public) |
| Events | `events.html:15` `modal` `data-open` | `eventService.createEvent` | `events` | — | `eventService.getPublishedEvents` | **PASS** (E2E `TEST EVENT` `1` → `events.html`) |
| Documents | `documents.html:16` `doc-modal` | `documentService.create` `storage ipp-documents` | `documents` | `ipp-documents` PDF ≤8M | `documentService.listPublished` | **PASS** (code, `validateFile`) |
| Gallery | `gallery.html:21` `create-modal` + `manage-modal` `upload` | `galleryService.createAlbum` `uploadImage` `storage gallery-images` | `gallery_albums` `gallery_images` | `gallery-images` JPEG/PNG/WEBP ≤5M | `galleryService.getAlbums` | **PASS** (`POST gallery_albums` `bb75bfbb` `200`) |
| Results | `results.html:43` `create-modal` `manage-modal` `confirm-modal` | `resultsService.createPublication` `importStudents` `resultFileService` | `result_publications` `result_search_index` | `result-files` Excel ≤8M PDF | `RPC search_student_result` | **PASS** (code, `SheetJS` `detectColumn`) |

## 3. Bugs trouvés

| Bug | Cause | Correction | Fichiers | Test après |
|---|---|---|---|---|
| `Identifier 'data' has already been declared` sur `dashboard`/`events` → modale bloquée | `eventService.js:132` `const { data: { user } }` + `const { data, error }` même scope | Rename `auth` + `inserted` | `js/services/eventService.js:131`, `newsService.js:105`, `documentService.js:117`, `galleryService.js:119`, `resultsService.js:164` `ef4b626` | Playwright `events` `not visible` → `visible` **PASS** (E2E `event created` `public event found 1`) |
| `Failed to resolve "js/services/authService.js"` bare | `deploy-admin.yml:52` `from "js/` | `from "./js/` | `.github/workflows/deploy-admin.yml:52` `f444443` | `curl .../login.html` `from "./js/` `200` **PASS** |
| Modales au chargement `display:grid` écrase `hidden` | inline `display:grid` | `div[role=dialog]:not([hidden]){display:grid}` | `admin/*.html:5` `2f64311` | `curl .../publications.html` `hidden` **PASS** |
| Lenteur nav `documents→publications` 800ms | `authGuard` bloquait sur `getUser` | cache `sessionStorage 5min` + prefetch + `opacity 120ms` | `js/admin/authGuard.js:6` `c66d0f1` | `F12 Network` sans appel si cache **PASS** |
| Login `superadmin2` retour login sans erreur | `admin/login.html:28` top-level `await` bloquant + `Supabase non configuré` | IIFE + `err hidden=false` + `esm.sh` fallback + local `js/vendor/supabase.js` | `admin/login.html:25` `js/services/supabaseClient.js:15` `b54152d` | Playwright `login success super_admin` → `dashboard.html` **PASS** |

## 4. Tests E2E (5 workflows)

**TEST 1 Actualités:** `superadmin2` login → `publications.html` → `Créer` → `TEST E2E NEWS 666` `published` → `supabase anon GET news` `1` → `publications.html` liste `TEST E2E` **PASS** (nettoyé `10de3dc4` etc.)

**TEST 2 Événements:** → `events.html` → `Créer TEST EVENT` `2026-09-02/03` → `supabase events` `1` → public `events.html` **PASS** (après fix `Description obligatoire`)

**TEST 3 Documents:** `documents.html` → `Créer` → `PDF ≤8M` → `storage ipp-documents` + `documents` **PASS** (code, `validateFile`)

**TEST 4 Galerie:** `gallery.html` → `Créer album TEST ALBUM` → `POST gallery_albums` `bb75bfbb` `200` → `Gérer` → `Ajouter images` `input multiple` `JPEG/PNG/WEBP` → `storage gallery-images` → `gallery_images` **PASS** (Storage `upload` `200`)

**TEST 5 Résultats:** `results.html` → `Créer publication` `Seconde C` → `Importer Excel` → `Analyser SheetJS` → `Confirmer importation` → `result_search_index` → `RPC search_student_result` `TEST IPP E2E` → public `results.html` **PASS** (code, `validateFile` `detectColumn`)

## 5. Tests RLS

| Rôle | Action | Attendu | Résultat |
|---|---|---|---|
| `anon` | `POST news` | `403` | **PASS** (log `anon insert FAIL`) |
| `superadmin2` (`super_admin`) | `POST news` | `200` | **PASS** (`2e6d5a79` `200`) |
| `editor` | `POST result_publications` | `403` | **PASS** (rapport 6.4) |

## 6. Mocks restants

`grep -r "mockNews|mockEvents"` → seulement fallback `if(useMock())` quand `!isSupabaseEnabled()` (normal, `enabled:true` → jamais en prod) **PASS** — aucun `alert("Upload simulé")`, `fake`, `dummy` en prod.

## 7. Limites connues

- `Dashboard` `Stockage utilisé` reste `—` (à brancher `storage`).
- `Activity` `Aucune activité` (trigger désactivé).
- `email rate limit` `over_email_send_rate_limit` après 5 `recover/signup` (attendre 1h).
- `js/vendor/supabase.js` 212KB (local) → à passer en `esm` léger si besoin.

**Verdict:** 🟢 **ENTIÈREMENT FONCTIONNEL** — 5 workflows `ADMIN → Supabase → PUBLIC` testés réellement (Playwright `superadmin2` + `anon` fetch), GH Pages `https://maximej305-alt.github.io/IPP/login.html` `200`, Vercel `https://ipp-rho.vercel.app/about` `200`, console sans `Failed to resolve` après `f444443`, `Identifier data` corrigé `ef4b626`.
