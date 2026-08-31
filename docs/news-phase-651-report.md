# Rapport Phase 6.5.1 — Intégration Actualités Supabase

**Date :** 2026-08-29
**Module :** `news` — premier module métier connecté

## 1. Fichiers modifiés

| Fichier | Raison |
|---|---|
| `js/services/newsService.js` | Réécrit complet : `getPublishedNews(limit)` (public, filtré `published`+`published_at`+`expires_at`), `getAdminNews()`, `getNewsById()`, `createNews()`, `updateNews()`, `deleteNews()`, `publishNews()`, `scheduleNews()` — tous via `supabaseClient`, `mapRow` (published_at→date), `useMock()` fallback |
| `supabase/migrations/202608290009_news_scheduled.sql` | Nouvelle migration : RLS `News public read` inclut `scheduled` où `published_at <= now()` + `expires_at` check |
| `admin/publications.html` | Connecté à `newsService.getAdminNews/createNews/deleteNews`, `await initAdmin({requiredRole:"editor"})`, DOM via `createElement`+`textContent`, `published_at`/`expires_at` ISO, `draft` vs `published` |
| `public/news.html` / `public/index.html` | Déjà corrigés P2 pour `textContent` — utilisent désormais `newsService.list({status:"active"})` → `getPublishedNews` (anon) |
| `js/config/app.config.js` | `supabase.enabled=true` déjà en Phase 6.4 — `useMock` reste `true` pour autres services, `newsService` ignore le mock quand Supabase enabled |
| `js/services/supabaseClient.js` | Inchangé — `getSupabaseClient()` utilisé |

Aucune migration existante modifiée (0001-0008 intactes).

## 2. Fonctions créées/modifiées

- `getPublishedNews(limit=10)` — `select * where status='published' and published_at <= now() and (expires_at is null or > now()) order by published_at desc limit`
- `getAdminNews()` — `select * order by created_at desc` (RLS `has_role(editor)` )
- `getNewsById(id)` / `getById`
- `createNews({title,excerpt,content,status,published_at,expires_at})` — validation `title/content` requis, `created_by` auto via `auth.getUser()`
- `updateNews(id,patch)`, `deleteNews(id)`, `publishNews(id)`, `scheduleNews(id,date)`

Toutes retournent `mapRow` et lancent `throw error` avec `console.error` côté service, UI affiche message générique.

## 3. Tests réalisés (contre Supabase réel `kmboyqybbfeblzdkdtny`)

| Test | Méthode | Résultat |
|---|---|---|
| **Création editor** | `editor@ipp.tg` POST `/rest/v1/news` `status=published` | **201 PASS** |
| **Brouillon** | `status=draft` | **201** — `anon GET /news?status=published` → 0 rows for that id (**PASS**, invisible) |
| **Publié** | `status=published` | **201** — `anon` voit 3/4 publiés (expired exclu) **PASS** |
| **Expiration** | `expires_at` hier | **201** — `anon` ne voit pas l'expirée (3/4) **PASS** |
| **Anon lecture** | `GET /news?status=published` anon | **200** 3 rows (seule publiée non expirée) **PASS** |
| **Editor lecture all** | `GET /news` avec `editor` token | **200** 4+ rows (draft inclus) **PASS** |
| **Anon INSERT** | `POST /news` anon | **401** bloqué **PASS** |
| **Editor INSERT** | POST avec editor | **201** **PASS** |
| **Admin/ Editor DELETE** | `DELETE /news?id=eq.x` avec editor | **204** **PASS** (RLS `has_role(editor)`) |
| **XSS** | `title="<script>alert('test')</script>"` | Stocké tel quel, rendu via `textContent` → affiché comme texte, **pas d'exécution** **PASS** |
| **Home limit** | `getPublishedNews(3)` | Retourne 3 max, `public/index.html` slice 2→3 **PASS** |

**Détails XSS :** `public/news.html:38` et `admin` utilisent `createElement` + `textContent` (P2) — `<script>` visible comme texte dans `anon` SELECT.

## 4. Vérification Supabase

- **INSERT** editor **201**, anon **401** bloqué
- **SELECT** anon `published` **200** filtré, `draft` **0 rows**
- **UPDATE** editor **204**, anon **401**
- **DELETE** editor **204**
- **RLS** `has_role(editor)` pour `news` — `editor/admin/super_admin` passent, `anon` ne voit que `published` non expiré

## 5. Sécurité

- **service_role** jamais dans frontend — uniquement `anonKey` dans `app.config.js`
- **localStorage `ipp_auth`** supprimé (Phase 6.4), `authService` Supabase réel
- **RLS active** sur `news` (vérifié `pg_policies`)
- **XSS** corrigé (textContent)
- **Aucune migration modifiée**, nouvelle `0009` ajoutée et pushée `supabase db push` → 9/9

## 6. Limites restantes

- **Images** `image_path` non gérées (Storage `documents` pas utilisé pour news)
- **Cron expiration** non automatisé — `expires_at` masque côté lecture, mais `status` reste `published` jusqu'à nettoyage manuel (Phase 5.13)
- **Autres modules** (`events/documents/gallery/results`) toujours **MOCK** (`useMock=true`)

**Verdict :** Premier module métier **fonctionnel en réel** — `ADMIN → Supabase → public` flux complet, design intact, `AppConfig.useMock` conservé pour autres modules.
