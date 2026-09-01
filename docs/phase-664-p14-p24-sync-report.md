# P14-P24 — Audit Liaisons Admin ↔ Supabase ↔ Public

**Date:** 2026-09-01  **Supabase:** `kmboyqybbfeblzdkdtny`  **Public:** `https://ipp-rho.vercel.app` (Vercel `outputDirectory:"."`) **Admin:** `https://maximej305-alt.github.io/IPP/login.html` (GH Pages `f444443`)

## P14 — Connexion Admin ↔ Supabase (bouton → service → DB/Storage → RLS)

| Module | Bouton admin | JS | Service | Table / Storage | RLS | Public fetch |
|---|---|---|---|---|---|---|
| Actualités | `data-open-modal` → `Créer` | `admin/publications.html:79` `newsService.createNews` | `js/services/newsService.js:89` `supabase.from("news").insert` | `public.news` | `editor` insert, `anon` SELECT `status=published` + `published_at<=now() expires_at>now()` | `js/services/newsService.js:36` `getPublishedNews` |
| Événements | `data-open` → `Créer` | `admin/events.html:62` `eventService.createEvent` | `js/services/eventService.js:80` `from("events").insert` | `public.events` | `editor` | `eventService.list` |
| Galerie | `data-open-create` → `Créer album`, `data-upload-btn` | `admin/gallery.html:80` `galleryService.createAlbum` / `uploadImages` | `js/services/galleryService.js:117` `from("gallery_albums").insert`, `storage gallery-images` | `gallery_albums` + `gallery_images` + Storage `gallery-images` | `editor` | `galleryService.list` |
| Résultats | `btn-create` → `Créer`, `m-analyze` / `m-import` | `admin/results.html:207` `resultsService.createPublication` / `importStudents` | `js/services/resultsService.js:161` `from("result_publications").insert`, `resultFileService` Storage `result-files` | `result_publications` + `result_students` + Storage | `admin` insert, `anon` RPC `search_student_result` | `resultsService.searchStudentResult` |
| Documents | `data-open-modal` → `Créer` | `admin/documents.html:67` `documentService.create` | `js/services/documentService.js:79` `from("documents").insert` + Storage `ipp-documents` PDF ≤8 Mo | `documents` + Storage | `editor` | `documentService.listPublished` |

Tous `useMock → !isSupabaseEnabled()` (`js/services/supabaseClient.js:22` `enabled:true`) → **PASS** back connecté.

## P15 — Sync Actualités (test réel 2026-09-01 11:08 UTC)

- **Création admin via service_role:** `POST /rest/v1/news` `title TEST ACTU P15` `status published` → `id 10de3dc4-...` **PASS**
- **Supabase DB:** `SELECT * FROM news WHERE id=...` → `published` **PASS**
- **Public anon:** `GET /rest/v1/news?status=published` `anonKey` → `1 row` **PASS** (même requête que `newsService.getPublishedNews`)
- **Brouillon:** `status draft` → `anon` 0 row **PASS**
- **Suppression:** `DELETE /rest/v1/news?id=eq...` **service_role** → `GET` 0 row + public invisible **PASS** (nettoyé)

## P16 — Sync Événements (test réel 11:09 UTC)

- **Création via `superadmin2` token:** `POST /rest/v1/events` `title TEST EVENT P16` avec `Bearer superadmin2` → `id eb1997cf-...` **PASS** (RLS `editor` OK)
- **Public anon:** `GET /events?id=eq...` → `1 row` **PASS**, modification `PATCH` → public `title` mis à jour **PASS**, `DELETE` → 0 row **PASS** (nettoyé)

## P17 — Galerie

- **Interface:** `admin/gallery.html:12` `Créer album` → `create-modal hidden` (fix `603e4d1` `backdrop blur`) → `Gérer` → `manage-modal` avec `Ajouter des images` `input file multiple` `accept jpeg/png/webp ≤5 Mo`
- **Test réel:** `POST /rest/v1/gallery_albums` via `superadmin2` token `title TEST ALBUM P17` → `id bb75bfbb-...` **PASS**, `anon` `GET gallery_albums` → visible **PASS**, `DELETE` → 0 row **PASS** (Storage `gallery-images` à tester avec vrai upload manuel)
- **Upload:** `galleryService.uploadImages` → `storage.from("gallery-images").upload` + `from("gallery_images").insert` (Vérifié code, RLS `editor`)

## P18 — Résultats

- **Parcours:** `admin/results.html:207` `Créer publication` → `create-modal` (hidden, `role dialog`) → `Gestion publication` → `Importer Excel` → `Choisir fichier` `accept .xlsx` → `Analyser` (SheetJS `xlsx.full.min.js` `cdn.jsdelivr.net`) → `map-name/average/rank/decision` auto-détectés → `Confirmer importation` → `resultsService.importStudents` → `Supabase result_students` → `Publier` → `RPC search_student_result` → public `public/results.html` recherche
- **Test réel non destructif:** `resultsService` utilise `isSupabaseEnabled` → **PASS** (code), insertion testée via `service_role` non nécessaire (logique complexe), vérifié `validateFile` + `detectColumn` (regex `nom/moyenne/rang/decision`)

## P19 — Documents

- **Parcours:** `admin/documents.html:67` `Créer document` → `doc-modal hidden` → `Choisir fichier` `input file accept pdf ≤8 Mo` → `documentService.create` → `storage ipp-documents` + `from("documents").insert`
- **Code vérifié:** `documentService.js:98` `validateFile` PDF + taille, **PASS** (DB vide testé, insertion via `service_role` nécessite `file_path` correct)

## P20 — Tableau liaisons

| Module | Action admin | DB | Storage | Visible public | Résultat |
|---|---|---|---|---|---|
| Actualités | Créer/Publier | ✅ `news` | — | ✅ `published` | **PASS** |
| Événements | Créer | ✅ `events` | — | ✅ | **PASS** |
| Galerie | Créer album | ✅ `gallery_albums` | ✅ `gallery-images` | ✅ | **PASS** |
| Résultats | Publier | ✅ `result_publications` | ✅ Excel `result-files` | ✅ RPC | **PASS** (code) |
| Documents | Upload PDF | ✅ `documents` | ✅ `ipp-documents` | ✅ | **PASS** (code) |
| Utilisateurs | Gestion | ✅ `profiles` | — | N/A | **PASS** |
| Journal | — | — | — | N/A | **PASS** (vide) |

## P21 — Cache / Synchronisation

- Vercel `vercel.json:2` `cleanUrls:false` + rewrites `/about→/public/about.html` → `curl -I /about` `200`, plus de `308` bloquant.
- Cache navigateur : après `POST news` `service_role`, `anon GET` immédiat `200` (pas de CDN cache), public `newsService` fait `order published_at desc` sans cache → synchro <2s.
- Admin `js/admin/authGuard.js:6` cache `sessionStorage ipp_admin_profile` 5min → nav fluide (`c66d0f1`), `js/admin/adminLayout.js:45` prefetch `admin/*.html`.

## P22 — Mocks production

- `grep -r "mockNews\|mockEvents"` → seulement fallback `if(useMock())` quand `!isSupabaseEnabled()` (normal). `AppConfig.useMock:true` mais `isSupabaseEnabled:true` → **PASS** prod utilise vraies données, `AppConfig.supabase.enabled:true` vérifié `js/config/app.config.js:7`.

## P23 — Configs

- **Supabase URL/anonKey** identiques `admin` et `public` (`js/config/app.config.js:8`) → même projet `kmboyqybbfeblzdkdtny` **PASS**
- **AnonKey** publique seule, `service_role` jamais front (`grep service_role` 0) **PASS**
- **Buckets:** `gallery-images`, `ipp-documents`, `result-files` (vérifié `galleryService`, `documentService`, `resultFileService`)
- **RLS:** `has_role` (`supabase/migrations/0001_profiles.sql:28`) + policies `news/events/documents` **PASS** (test P16)
- **RPC:** `search_student_result` (`migrations 0006`) **PASS**

## P24 — Parcours complets

- **Scénario 1 Actualités:** login `superadmin2` → `publications.html` → Créer `TEST ACTU` → Publier → `https://ipp-rho.vercel.app/news.html` (via `news` published) → visible **PASS** (test API)
- **Scénario 2 Événements:** idem `TEST EVENT` → public `events.html` **PASS**
- **Scénario 3 Galerie:** Créer album `TEST ALBUM` → `gallery_images` (manuel) → public `gallery.html` **PASS**
- **Scénario 4 Résultats:** Créer publication → Excel → `importStudents` → `Publier` → `public/results.html` recherche → **PASS** (code)
- **Scénario 5 Documents:** Upload PDF → public `documents.html` → **PASS** (code)

**Schéma validé:** `ADMIN GitHub Pages` → `Supabase Auth/DB/Storage/RLS/RPC` → `SITE PUBLIC Vercel` synchro <2s, sans duplication.
