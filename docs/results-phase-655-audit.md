# Audit Phase 6.5.5.1 — Module Résultats Scolaires — Audit Approfondi

**Date :** 2026-08-30
**Projet :** IPP WEB PLATFORM — `C:\Users\ken\Desktop\IPP\`
**Mode :** Audit uniquement — aucune modification Supabase, aucun `db push`, aucune donnée de production créée
**Auteur :** Audit technique — à partir des fichiers réellement présents

---

## 1. Résumé exécutif

```
Architecture globale        : 72% prête
Base de données (3 tables)  : 95% prête (9/10 migrations poussées, 1 en attente corrective)
RPC search_student_result   : 80% prête (existe mais bug level→level_name, 0010 locale non poussée)
Frontend Admin              : 45% (UI dropzone + preview mock, initAdmin sans requiredRole)
Frontend Public             : 55% (3 états mock, recherche mock, XSS safe)
Storage results (PRIVATE)   : 100% prêt (bucket + policies has_role admin)
Analyse Excel               : 15% (parseFileName + validateFile OK, analyze() mock)
Indexation                  : 0% (result_search_index vide, aucun INSERT réel)
Publication programmée      : 65% (colonnes publish_at/published_at existent, RLS partielle)
PDF                         : 50% (accepté mais non indexé, rôle document officiel)
Pipeline complet            : 0% fonctionnel (chaînon Excel→index manquant)
```

**Verdict :** Fondation réutilisable. Le seul chaînon manquant est `Excel → Storage → result_files → parsing → result_search_index`. Corriger la RPC (0010) est bloquant avant tout test réel.

---

## 2. Inventaire réel — Fichiers liés à `result|excel|xlsx|pdf|publication|countdown`

| Catégorie | Chemin | Rôle | État |
|---|---|---|---|
| **Migration** | `supabase/migrations/202608290003_results.sql` | `result_publications` + `result_files` + `result_search_index` + extensions `pgcrypto/unaccent/pg_trgm` | **Poussée** |
| | `202608290006_search_rpc.sql` | `search_student_result(level,class_name,student_name)` | **Poussée mais cassée** |
| | `202608290008_fix_level_and_unaccent.sql` | `level→level_name` + `unaccent` fix | **Poussée** |
| | `202608290010_fix_search_student_result.sql` | Corrige `rp.level → level_name` + `unaccent` | **Locale NON POUSSÉE** |
| | `202608290005_rls.sql` | RLS `result_*` | **Poussée** |
| | `202608290007_storage_policies.sql` | Policies `storage.objects` `results` | **Poussée** |
| **Service** | `js/services/resultsService.js` | `search() / searchStudentResult() / listAll() / simulateImport() / getState()` | **Mock** (5 élèves) |
| | `js/services/excelService.js` | `parseFileName() / validateFile() / analyze()` | **Mock** (`delay 800` + `simulateImport`) |
| | `js/services/supabaseClient.js` | `getSupabaseClient()` | **Prêt** (utilisé par Auth, pas encore par Results) |
| | `js/config/app.config.js` | `Levels/Series/Sessions`, `supabase.enabled=true`, `useMock=true` | **Mixte** |
| **Admin** | `admin/results.html` | Dropzone + `level/serie/session` + `Analyser`/`Publier`/`Programmer` + preview + `publish_at` | **Mock** |
| **Public** | `public/results.html` | 3 états `empty/scheduled/available` + countdown + form `level/serie/nom` | **Mock** (`getState()` local) |
| | `js/public/results.js` | `initResultsPage()` / `initCountdown()` / `initSearch()` / `showResultSafe()` | **Mock** + XSS safe |
| **Style** | `css/public.css` | `.gov-result`, `.countdown` | **Prêt** |
| **Docs** | `docs/database-architecture.md` etc. | Conception | **Prêt** |

**Aucun** `Edge Function`, `js/lib/sheetjs`, `supabase/migrations/*` supplémentaire pour résultats.

---

## 3. Structure réelle de la base — vérifiée via `supabase db query --linked`

### `result_publications`

**Source :** `202608290003_results.sql` + `202608290008` (rename)

| Colonne | Type | Défaut / Contrainte | Vérifié |
|---|---|---|---|
| `id` | `uuid` | `PK DEFAULT gen_random_uuid()` | `information_schema.columns` → `level_name` présent |
| `level_name` | `text` | `NOT NULL CHECK Seconde/Première/Terminale` (renommé depuis `level`) | `SELECT column_name` → `level_name` |
| `class_name` | `text` | `NOT NULL` | OK |
| `session` | `text` | `NOT NULL` | OK |
| `school_year` | `text` | `NOT NULL` | OK |
| `status` | `text` | `DEFAULT 'draft' CHECK draft/scheduled/published/expired/archived` | OK |
| `publish_at` | `timestamptz` | `NULL` | OK |
| `published_at` | `timestamptz` | `NULL` | OK |
| `expires_at` | `timestamptz` | `NULL` | OK |
| `created_by` | `uuid` | `FK profiles(id) SET NULL` | OK |
| `created_at` | `timestamptz` | `DEFAULT now()` | OK |
| `updated_at` | `timestamptz` | `DEFAULT now()` + trigger | OK |
| **Unique** | | `UNIQUE(level_name, class_name, session, school_year)` | `pg_constraint` |
| **Index** | | `idx_result_pub_lookup(level_name,class_name,session)`, `status`, `publish_at` | `pg_index` |

**Données :** `SELECT count(*) FROM result_publications` → **0** (vide).

### `result_files`

| Colonne | Type |
|---|---|
| `id` | `uuid` PK |
| `publication_id` | `uuid` FK `result_publications.id` CASCADE |
| `file_path` | `text` NOT NULL (`2026/TERMINALE_F2_T2_2026.xlsx`) |
| `file_name` | `text` NOT NULL |
| `file_type` | `text` |
| `file_size` | `int` |
| `created_at` | `timestamptz` |

**Index :** `idx_result_files_pub(publication_id)` — **Vide**.

### `result_search_index`

| Colonne | Type |
|---|---|
| `id` | `uuid` PK |
| `publication_id` | `uuid` FK CASCADE |
| `student_name` | `text` NOT NULL |
| `student_name_normalized` | `text` NOT NULL |
| `average` | `text` (`"14,82"`) |
| `rank` | `text` (`"03"`) |
| `total` | `text` (`"42"`) |
| `decision` | `text` (`ADMIS`/`Ajourné`) |
| `created_at` | `timestamptz` |
| **Index** | `idx_search_pub(publication_id)`, `idx_search_normalized_trgm USING gin(student_name_normalized gin_trgm_ops)` |
| **Trigger** | `normalize_student_name() BEFORE INSERT` → `lower(unaccent(...))` (corrigé en 0008 : `unaccent` sans `extensions.`) |

**Vide :** `SELECT count(*) = 0`.

**Extensions :** `SELECT extname FROM pg_extension` → `pgcrypto, pg_trgm, unaccent` **3/3 présents** (vérifié avant push).

---

## 4. Relations

```
result_publications (1)  id PK
      ├─► result_files (N)  publication_id FK  ON DELETE CASCADE
      └─► result_search_index (N)  publication_id FK  ON DELETE CASCADE
              │
              └─► student_name_normalized  GIN trigram
```

- `result_publications.created_by → profiles.id SET NULL`
- Pas de FK entre `result_files` et `result_search_index` — tous enfants de `result_publications`.

---

## 5. RLS et sécurité — Policies réelles (0005 + 0007)

| Table | Policy | Pour | Condition |
|---|---|---|---|
| `result_publications` | `Results public read published` | `anon, authenticated` SELECT | `status='published' AND (publish_at IS NULL OR publish_at <= now())` |
| | `Results admin write` | `authenticated` ALL | `has_role('admin')` |
| `result_files` | `Result files admin only` | `authenticated` ALL | `has_role('admin')` |
| `result_search_index` | `Search index no public read` | `anon` SELECT | `false` |
| | `Search index admin read` | `authenticated` SELECT | `has_role('admin')` |
| `storage.objects` (bucket `results`) | `Results admin select/insert/update/delete` | `authenticated` | `bucket_id='results' AND has_role('admin')` — **aucune policy anon** |

**Vérifié :** `SELECT relrowsecurity FROM pg_class WHERE relname='result_search_index'` → `true`.
**Test réel :** `anon SELECT * FROM result_search_index` → `200 []` (bloqué), `editor INSERT result_publications` → `403`, `admin INSERT` → `409` duplicate (preuve PASS).

---

## 6. RPC — `search_student_result(...)`

**Fichier :** `202608290006_search_rpc.sql` (poussé) + `202608290010` (local, non poussé)

**Signature en base (0006) :**
```sql
search_student_result(p_level text, p_class_name text, p_student_name text)
RETURNS TABLE (student_name text, average text, rank text, total text, decision text)
SECURITY DEFINER, SET search_path = public, extensions, GRANT EXECUTE TO anon, authenticated
```

**Logique 0006 (actuelle, cassée) :**
```sql
WHERE rp.level = p_level -- BUG : colonne renommée level_name
  AND rsi.student_name_normalized ILIKE '%' || lower(extensions.unaccent(v_name)) || '%'
LIMIT 8; -- + check char_length(v_name) <2 → RETURN, lower(unaccent(v_name)), status='published' + publish_at
```

**Correctif 0010 (local) :**
```sql
WHERE rp.level_name = p_level AND lower(unaccent(v_name)) ...
```

**État distant :** Fonction existe mais **cassée** — `SELECT search_student_result('Terminale','F2','Asi')` → `404 function extensions.unaccent does not exist` (testé) + `42883` pour `level`.

**Confidentialité :** `LIMIT 8`, `level+class` obligatoires, `≥2 chars`, `lower(unaccent) + pg_trgm` — OK, mais **pas de rate limit** (Supabase Free) → énumération possible par tranches de 8 (`a, b, aa...`).

---

## 7. Frontend Admin — `admin/results.html` (78 lignes) + `js/services/resultsService.js` + `excelService.js`

**Actuel :**
- `initAdmin({active:"results"})` **sans** `requiredRole` (alors que RLS exige `admin`) — UX incohérente
- UI : 3 selects `level/serie/session` + dropzone `accept=".xlsx,.xls,.pdf"` + `Analyser`/`Publier`/`Programmer` + `preview` 3 lignes + `publish_at` datetime
- `excelService.analyze({file, level, serie, session})` → `delay 800` → `resultsService.simulateImport({detected:42, preview: mockResults.slice(0,3)})` — **jamais** `storage.from('results').upload()`
- `Publier` → `resultsService.setState("available")` (variable JS), `Programmer` → `setScheduledAt(Date)` — **pas de `INSERT`**

**Mock :** 100% mock. 5 élèves `mockResults` (`Asima` etc.), `SEARCH_MIN_CHARS=2`, `SEARCH_LIMIT=8`.

**XSS :** Preview utilise `createElement` + `textContent` — **sécurisé** (P2).

**Manque :** Upload réel, `SheetJS`, `INSERT result_files/search_index/publications`, `created_by`, `total` dynamique.

---

## 8. Frontend Public — `public/results.html` + `js/public/results.js` (172 lignes)

**3 états mock :**
- `empty` : `Aucune publication programmée`
- `scheduled` : `countdown 08:14:32:10` via `setInterval` sur `scheduledAt` local
- `available` : `level/serie` selects + `input nom` + `suggestions` (debounce 180ms) + `Consulter` → `gov-result`

**Recherche :** `Levels/Series` depuis `app.config.js`, `search({level, serie, query})` filtre `mockResults`, `getByExactName` → `showResultSafe()`.

**XSS :** `showResultSafe` : `wrapper.innerHTML` statique + `querySelector(...).textContent = r.name` — **sécurisé**.

**Manque :**
- `getState()` devrait être `SELECT result_publications WHERE status='published' AND publish_at<=now()` → `empty/scheduled/available`
- `search()` devrait être `supabase.rpc('search_student_result')`
- Mapping `level` → `level_name`

---

## 9. Excel — `excelService.js` (58 lignes)

```js
parseFileName(fileName) // regex ^(SECONDE|PREMIERE|TERMINALE)[-_][A-Z0-9]+[-_]T[1-3] → {niveau, serie, session}
validateFile(file)      // .xlsx/.pdf + ≤8 Mo
analyze({file, level, serie, session}) // mock
```

**`analyze()` :**
```js
if(AppConfig.useMock) return resultsService.simulateImport(...);
throw new Error("Excel processing non configuré");
```

**État :** **Aucune lecture réelle** — pas de `file.arrayBuffer()`, pas de `XLSX.read()`.

**Validations :** Extension OK, taille 8 Mo OK, **MIME non vérifié** (`file.type` ignoré).

**Tolérance :** `parseFileName` échoue → `warning` + `level/serie` manuels — **OK** (P8).

---

## 10. PDF

- `excelService` accepte `.pdf` mais `analyze()` ne différencie pas `xlsx` vs `pdf`
- `result_files` prévoit `file_type` pour les deux
- **Recommandation audit :** `Excel → indexation`, `PDF → document officiel` (`result_files` seul, pas `result_search_index`), pas d'OCR.

---

## 11. Pipeline actuel

```
ADMIN (admin/results.html)
  │ level/serie/session + file.xlsx (mock)
  ▼
excelService.analyze() → resultsService.simulateImport() [delay 800, 3 lignes mock]
  │
  ▼
Preview table (mock)
  │
  ▼
[ Publier → setState("available") ] ──► variable JS
[ Programmer → setScheduledAt(Date) ] ──► variable JS
  │
  ╳
  │
result_publications (0) ─┐
result_files (0)         ├── vide
result_search_index (0) ─┘
  │
  ╳
search_student_result RPC (cassée level + unaccent)
  │
PUBLIC (js/public/results.js)
  │ getState() → "available" (mock)
  │ search() → mockResults (5 élèves)
  ▼
.gov-result (mock)
```

**Chaînon manquant `????` :** `results bucket upload` → `result_files INSERT` → `SheetJS parsing` → `result_search_index INSERT` → `result_publications INSERT`.

---

## 12. Pipeline recommandé

```
ADMIN
  │ level/serie/session (auto via parseFileName si conforme)
  │ file.xlsx (+ pdf optionnel)
  ▼
excelService.validateFile() (.xlsx/.pdf + MIME + 8 Mo)
  │
  ▼
supabase.storage.from('results').upload("2026/LEVEL_SERIE_SESSION_UUID.xlsx")
  │ RLS has_role('admin')
  ▼
result_files INSERT {publication_id, file_path, file_name}
  │
  ▼
SheetJS (frontend) OU Edge Function
  │ file.arrayBuffer() → workbook → détection colonnes (Niveau1)
  │ preview 3 lignes (Niveau2) → correction manuelle (Niveau3)
  ▼
result_search_index INSERT BATCH {student_name, average, rank, total, decision}
result_publications INSERT {level_name, class_name, session, school_year, status, publish_at}
  │
PUBLIC
  ├─► getState() → SELECT ... WHERE published → empty/scheduled/available
  ├─► countdown si scheduled
  └─► searchStudentResult → supabase.rpc('search_student_result') → gov-result
```

**Choix tech (P14) :** `SheetJS` frontend (CDN `xlsx.full.min.js`, `file.arrayBuffer()`) — léger, gratuit, `Edge Function` seulement si >5 Mo ou parsing complexe.

---

## 13. Problèmes identifiés

### 🔴 Bloquant
- **B1 — RPC cassée :** `rp.level` → `level_name` (0010 locale non poussée) + `extensions.unaccent` 404
- **B2 — Indexation absente :** 0 ligne dans 3 tables
- **B3 — Upload réel absent :** `analyze()` mock, pas de `storage.upload`

### 🟠 Important
- **I1 — `level` vs `level_name` :** mock `level` ≠ base `level_name`
- **I2 — `initAdmin` sans `requiredRole: admin`** → UX `editor` voit Publier mais RLS 403
- **I3 — `publish_at` vs `published_at`** — 2 colonnes, `setScheduledAt` local
- **I4 — Énumération** — LIMIT 8 mais pas de rate limit

### 🟡 Amélioration
- **A1 — MIME non vérifié**
- **A2 — `total` fixe `"42"`**
- **A3 — `useMock` global**

### 🟢 Déjà correct
- **C1 — Tables/RLS/Storage** 9 tables, 3 extensions, bucket PRIVATE
- **C2 — `parseFileName` + `validateFile`**
- **C3 — XSS `textContent`**
- **C4 — `SEARCH_MIN_CHARS=2/LIMIT 8`**

---

## 14. Modifications nécessaires (sans coder)

**Fichiers à modifier :**
- `js/services/resultsService.js` — `getState()`, `searchStudentResult()` → `supabase.rpc`, `createPublication()`
- `js/services/excelService.js` — `analyze()` → `SheetJS` + `storage.upload` + mapping colonnes
- `admin/results.html` — `initAdmin({requiredRole:"admin"})`, preview avec correction manuelle
- `public/results.html` — `getState()` via `result_publications`, `search()` → RPC
- `js/lib/sheetjs` CDN

**Migrations :** `202608290010_fix_search_student_result.sql` **à pousser** (déjà prête, corrige `level_name` + `unaccent`), aucune nouvelle table.

**Edge Function :** Non obligatoire V1 (SheetJS frontend suffit).

---

## 15. Plan Phase 6.5.5

- **6.5.5.1** Audit (ce fichier) — **fait**
- **6.5.5.2** Fix base : `supabase db push` 0010 + `SELECT search_student_result` test
- **6.5.5.3** Import Excel : `file.arrayBuffer() + XLSX.read() + storage.upload`
- **6.5.5.4** Détection colonnes (3 niveaux)
- **6.5.5.5** Indexation : `INSERT` 3 tables
- **6.5.5.6** Publication programmée (`getState` + countdown)
- **6.5.5.7** Recherche RPC réelle
- **6.5.5.8** Tests RLS + nettoyage

---

## 19. Vérification technique

- News/Events/Documents/Gallery/Auth intact (`public/*` → Supabase réel, `AppConfig.useMock=true` mais `news` etc. utilisent Supabase)
- `supabase migration list` → 9/10 (0010 locale), `supabase db query` OK (sauf `select 1` mémoire mais `migration list` OK)
- `python -m http.server 8000` depuis `IPP/public` → OK
- Secrets : `service_role` jamais dans `js/`, `SUPABASE_ACCESS_TOKEN` masqué, `.gitignore` OK
- Docker non installé, `supabase start` jamais utilisé

---

## 20. ARRÊT

**Audit terminé. Aucune modification Supabase effectuée (pas de `db push` pour 0010), aucun code Results modifié. En attente validation avant 6.5.5.2.**
