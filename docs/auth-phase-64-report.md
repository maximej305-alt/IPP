# Rapport Phase 6.4 — Supabase Auth, Rôles et Intégration

**Date :** 2026-08-29
**Projet :** `kmboyqybbfeblzdkdtny` — `supabase 2.116.0` — `supabase link` OK

## 1. État final

- **AUTH MOCK :** **SUPPRIMÉ** — `js/services/authService.js` remplacé (plus de `localStorage ipp_auth`, plus de `USERS` mock, plus de `isMock:true`)
- **SUPABASE AUTH :** **ACTIF** — `AppConfig.supabase.enabled=true`, `url=https://kmboyqybbfeblzdkdtny.supabase.co`, `anonKey` publique, `supabaseClient.js` avec `getSupabaseClient()`
- **Session :** persistante via `supabase-js` (localStorage `sb-...`), `refreshSession()` disponible, `requireAuth()` vérifie `auth.getUser()` + `profiles` + redirect `login.html`

## 2. Fichiers modifiés

| Fichier | Modification | Raison |
|---|---|---|
| `js/config/app.config.js:7` | `enabled:true`, `url`/`anonKey` renseignés, `version 0.2.0-supabase-auth`, `useMock` reste `true` pour autres services | P5 — bascule centralisée, Auth réel seul |
| `js/services/supabaseClient.js:1` | **Nouveau** — `getSupabaseClient()` import dynamique `@supabase/supabase-js`, `isSupabaseEnabled()` | P4 — point unique Supabase |
| `js/services/authService.js:1` | Réécrit complet : `login()` → `signInWithPassword`, `logout()` → `signOut`, `getCurrentUser/Profile/Role`, `hasRole/hasAnyRole` hiérarchique, `requireAuth()` + `refreshSession()`, `mapAuthError` | P6 — remplace mock |
| `js/admin/adminLayout.js:1` | `initAdmin({active,requiredRole})` async, `await requireAuth()`, `hasRole` hiérarchique, `data-role` hiding, `logout` async | P8 — protection réelle |
| `supabase/migrations/202608290008_fix_level_and_unaccent.sql` | Renomme `level→level_name` (idempotent), corrige `unaccent` sans schema, RPC utilise `level_name` | Correctif PostgREST `level` réservé + `extensions.unaccent` 404 |

*Aucune page HTML design refait, `public/` intact, `admin/login.html` conserve son JS (compatible nouveau `login()` qui throw si profile manquant).*

## 3. Migrations

- **Existantes :** 7 déjà poussées (`0001→0007`)
- **Nouvelle :** `202608290008_fix_level_and_unaccent.sql` — **poussée** via `supabase db push` (après fix `WITH SCHEMA` + `comment on schema` retiré). `migration list` → 8/8 `local=remote`.
- **Contenu 0008 :** `ALTER TABLE RENAME level→level_name` (DO IF EXISTS), `normalize_student_name()` → `unaccent()`, `search_student_result` → `level_name` + `unaccent`.

## 4. Comptes de test (mots de passe non exposés ici — communiqués séparément)

| Email | Rôle | Via | Testé |
|---|---|---|---|
| `superadmin@ipp.tg` | `super_admin` | `auth.admin.createUser` + `profiles` insert service_role | **Oui** — login 200, `profile super_admin` OK |
| `admin@ipp.tg` | `admin` | idem | **Oui** — login 200 |
| `editor@ipp.tg` | `editor` | idem | **Oui** — login 200 |

*Création via `POST /auth/v1/admin/users` avec `email_confirm:true` + `INSERT profiles` via `service_role` (jamais côté frontend).*

## 5. Tests RLS — réels via REST `anon`/`service_role`

| Test | Attendu | Résultat |
|---|---|---|
| `editor INSERT news` | PASS | **201** |
| `editor INSERT result_publications` | **FAIL** (403) | **400→403** `violates row-level security` ✅ |
| `admin INSERT result_publications` (level_name) | PASS | **409** duplicate (preuve PASS, RLS OK, unique bloque doublon) ✅ |
| `anon SELECT result_search_index` | 0 rows | **200 []** ✅ |
| `anon SELECT news published` | 1 row (editor news) | **200 count 1** ✅ |
| `anon RPC search_student_result('Terminale','F2','Asi')` | 200 (vide, pas de données) | **404→200 []** après fix unaccent ✅ |
| `service_role INSERT result_publications` | PASS | **201** (via Management API) |

**Ancien bug RPC `extensions.unaccent does not exist` → corrigé en `unaccent` (extension en `public`).**

## 6. Secrets

- **service_role** `eyJ...HYcF...` **jamais** dans `HTML/JS/README/Git` — uniquement `Authorization: Bearer` côté serveur (curl) et non commité
- **SUPABASE_ACCESS_TOKEN** `sbp_***` masqué dans rapports, `.gitignore` contient `.env`
- **anonKey** publique exposée dans `app.config.js` — **normal** (Supabase docs)
- **DB password** non exposé

## 7. Limites restantes (honnête)

- **Autres services (`news/events/documents/gallery/results`)** restent **MOCK** (`AppConfig.useMock=true`) — intégration progressive prévue Phase 5.9
- **Edge Function création utilisateurs** non créée — `admin/users.html` reste UI seule, création via `service_role` manuel pour l'instant (P10)
- **Inscription publique** : **aucune** — `signUp` non exposé
- **Storage** déjà configuré (Phase 6.3) mais tests upload `results` via `anon` déjà bloqués (400)
- **CLI `supabase db query --linked`** en échec `memory allocation` pour certaines requêtes — contourné via Management API `database/query` (REST)

**Critères Phase 6.4 :** Auth réel ✔, login/logout/session ✔, protection admin via `requireAuth` ✔, rôles hiérarchiques ✔, RLS testée réellement ✔, secrets non exposés ✔, inscription publique inexistante ✔, frontend intact ✔, Docker non utilisé ✔.
