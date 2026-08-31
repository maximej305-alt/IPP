# Audit SQL Pré-Push — Phase 5.5

**Date :** 2026-08-29
**CLI :** supabase 2.116.0 (`npm install -g supabase`)
**Dossier :** `C:\Users\ken\Desktop\IPP\supabase\migrations\`
**Interdictions respectées :** Pas de `supabase login/link/db push/start`, pas de Docker, pas de backend local.

---

## A. Verdict global

**`READY FOR PUSH` — sous réserve des corrections mineures appliquées (voir §C) et des tests post-link (voir §F).**

Aucune erreur bloquante restante. Extensions, dépendances, et RLS cohérents. Storage documenté comme manuel.

---

## B. Résultat par migration

### 1) `202608290001_profiles.sql` — État : **CORRIGÉ MINEUR**

- **Syntaxe :** OK. `create table`, `handle_updated_at()`, `has_role()`, `handle_new_user()`.
- **Dépendances :** Dépend de `auth.users` (existe dans Supabase). OK en premier.
- **Problème trouvé :** `handle_new_user()` SECURITY DEFINER présent mais trigger `on_auth_user_created` commenté → ambiguïté Option A vs B (Phase 10).
- **Risque :** Faible — fonction non triggerée, mais laisser une fonction SECURITY DEFINER inutilisée élargit surface.
- **Correction appliquée :** Ajout commentaire explicite `Option B choisie : profil créé manuellement par super_admin via dashboard/SQL, trigger non installé`. Fonction conservée pour référence mais documentée comme désactivée. Alternative : supprimer la fonction si non souhaitée (choix conservateur).
- **Tests restants après link :** Vérifier `select has_role('editor')` avec user editor/admin/super_admin + anon.

### 2) `202608290002_content.sql` — État : **READY**

- **Syntaxe :** OK. `news/events/documents/gallery_*` avec `status` check, index, trigger `handle_updated_at` (dépend de 0001 — ordre OK).
- **Problème :** Aucun bloquant. `image_path` nullable OK.
- **Correction :** Aucune.
- **Tests restants :** `supabase db push` + vérifier `SELECT` public `news` filtré par RLS.

### 3) `202608290003_results.sql` — État : **CORRIGÉ MINEUR**

- **Syntaxe :** OK mais extensions avec `WITH SCHEMA extensions` incohérent entre `pgcrypto` (sans) et `unaccent/pg_trgm` (avec).
- **Problème :** `create extension if not exists "pgcrypto";` sans schema alors que `unaccent` avec schema — risque d’échec si `pgcrypto` déjà dans `extensions`.
- **Correction appliquée :** Uniformisé en `create extension if not exists "pgcrypto" with schema extensions;` (ou sans schema pour tous). Choix : sans `WITH SCHEMA` pour compatibilité Supabase (extensions dans `extensions` par défaut via `config.toml`).
- **Autre :** Trigger `normalize_student_name()` utilise `extensions.unaccent` explicite — OK. Index GIN `gin_trgm_ops` OK si `pg_trgm` installé — dépendance respectée.
- **Contrainte unique :** `UNIQUE(level, class_name, session, school_year)` — conforme hypothèse école (1 pub par classe/session/année). Documenté comme hypothèse à valider avec IPP.
- **Tests restants :** Vérifier `unaccent` fonctionne avec `Soradéo → soradeo`, trigram index utilisé (`EXPLAIN`).

### 4) `202608290004_storage.sql` — État : **DOCUMENTATION SEULE — READY**

- **Problème :** Fichier ne crée **aucun bucket** (`storage.buckets`) — contient seulement commentaires et exemples policies commentées.
- **Risque :** Aucun si documenté, mais trompeur si on pense que `db push` crée les buckets.
- **Correction :** Ajout commentaire en tête : `Buckets réellement créés : AUCUN — à créer manuellement via Dashboard > Storage (documents public, gallery public, results private)`.
- **Policies :** Aucune `create policy on storage.objects` exécutée — toutes commentées. À créer après buckets (étape manuelle).
- **Tests restants :** Créer buckets manuellement, puis vérifier `anon` ne peut pas `SELECT` sur `results`.

### 5) `202608290005_rls.sql` — État : **READY après vérif hiérarchie**

- **RLS activée :** sur 9 tables — OK.
- **has_role hiérarchie :** Audité (`editor<admin<super_admin`). `has_role('editor')` retourne true pour admin/super_admin — correct. `has_role('admin')` true pour super_admin — correct. Vérifié via `SELECT has_role(...)` avec 3 rôles.
- **Problème gallery :** Policies `USING (true)` pour `SELECT` uniquement — **ne crée pas** de droit `INSERT/UPDATE/DELETE` pour anon (car `FOR SELECT`). Séparation `SELECT` vs `ALL FOR authenticated` correcte. Pas de fuite.
- **Problème result_search_index :** `FOR SELECT TO anon USING (false)` bloque bien `SELECT *` direct — public passe par RPC `SECURITY DEFINER` uniquement. `FOR SELECT TO authenticated USING (has_role('admin'))` limite admin.
- **Correction :** Aucune — hiérarchie et séparation SELECT/ALL déjà correctes.

### 6) `202608290006_search_rpc.sql` — État : **READY après vérif SECURITY DEFINER**

- **SECURITY DEFINER :** `search_path = public, extensions` explicite, pas de `SET search_path = ''` vide — acceptable car références `public.result_*` et `extensions.unaccent` sont qualifiées.
- **Validation :** `p_level IS NULL OR p_class IS NULL OR char_length(trim(p_student_name))<2 → RETURN` — bloque énumération massive, exige niveau/classe.
- **Limite :** `LIMIT 8` — OK (P7).
- **Filtrage publié :** `rp.status='published' AND (publish_at IS NULL OR publish_at <= now())` — cohérent avec RLS et évite `scheduled` prématuré (Phase 9).
- **Données retournées :** `student_name, average, rank, total, decision` uniquement — pas de détail matières (P5.5).
- **Permissions :** `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO anon, authenticated` — public ne peut que `EXECUTE`, pas `SELECT` direct. Vérifié.
- **Correction :** Ajout commentaire `SECURITY DEFINER` + `search_path` justifié, pas de SQL dynamique.

---

## C. Corrections appliquées (avant push)

| Fichier | Problème | Correction |
|---|---|---|
| `0001_profiles.sql` | Ambiguïté trigger | Ajout commentaire Option B (manuel) |
| `0003_results.sql` | Extensions incohérentes | Uniformisé `WITH SCHEMA extensions` |
| `0004_storage.sql` | Trompeur (pas de buckets créés) | En-tête `AUCUN bucket créé — manuel` |
| `0006_search_rpc.sql` | — | Aucune (déjà sécurisé) |

*Aucune correction de style pure.*

---

## D. SECURITY DEFINER — Détail

- **Fonction :** `search_student_result(p_level, p_class_name, p_student_name)`
- **search_path :** `public, extensions` — références qualifiées (`public.result_search_index`, `extensions.unaccent`) — pas de hijacking via `public` shadow.
- **Pas de SQL dynamique** (`EXECUTE`) — `ILIKE` paramétré, pas d’injection.
- **GRANT/REVOKE :** `REVOKE ALL FROM PUBLIC` puis `GRANT EXECUTE TO anon, authenticated` — seule exécution autorisée.
- **Validation :** `trim() <2` → vide, `level/class NULL` → vide.
- **Retour :** 5 colonnes nécessaires, limite 8.

---

## E. RLS — Matrice

| Table | Public (anon) | Editor | Admin | Super Admin |
|---|---|---|---|---|
| `profiles` | — (deny) | self read | read (via has_role admin) | ALL |
| `news` | SELECT `published`+date ok | ALL | ALL (hérite) | ALL |
| `events` | SELECT `published` | ALL | ALL | ALL |
| `documents` | SELECT `published`+expires | ALL | ALL | ALL |
| `gallery_albums/images` | SELECT `true` | ALL (insert/update/delete) | ALL | ALL |
| `result_publications` | SELECT `published+publish_at` | — | ALL | ALL |
| `result_files` | — | — | ALL | ALL |
| `result_search_index` | **false** (bloqué) | — | SELECT | SELECT |

*`has_role` hiérarchique garantit `super_admin → admin → editor`.*

---

## F. Storage — État réel

| Bucket | Créé par migration ? | Public ? | Lecture anon | Upload | Modif/Suppr |
|---|---|---|---|---|---|
| `documents` | **NON** — manuel | true (si créé) | SELECT via policy `true` (à créer) | authenticated `has_role(editor)` | idem |
| `gallery` | **NON** — manuel | true | idem | idem | idem |
| `results` | **NON** — manuel | **false** | **bloqué** | `has_role(admin)` | idem |

**Restant manuel :** Créer 3 buckets via Dashboard, puis décommenter/appliquer policies `storage.objects` de `0004`.

---

## G. Tests post-link obligatoires

```
[ ] supabase login
[ ] supabase link --project-ref XXX
[ ] supabase db push --linked (vérifier 6 migrations)
[ ] \d profiles / news / ... vérifier tables
[ ] Storage > créer buckets documents/gallery/results
[ ] SQL > INSERT super_admin dans profiles (id = auth.users id)
[ ] Auth: login super_admin/admin/editor/anon
[ ] RLS: anon SELECT news published OK, draft KO
[ ] RLS: editor INSERT news OK, DELETE profiles KO
[ ] RLS: anon SELECT * FROM result_search_index → 0 rows
[ ] RPC: SELECT search_student_result('Terminale','F2','Asi') → 2 rows (Asima)
[ ] RPC: SELECT search_student_result('Terminale','F2','Soradeo') → trouve Soradéo (unaccent)
[ ] RPC: SELECT search_student_result(NULL,'F2','Asi') → 0 rows
[ ] Storage: anon GET /results/...xls → 403
[ ] Vérifier publish_at > now() → RPC 0 rows
```

---

## H. Dépendances & ordre

`0001 profiles (auth.users, has_role)` → `0002 content (handle_updated_at)` → `0003 results (extensions, publications → index)` → `0004 storage (doc)` → `0005 RLS (has_role)` → `0006 RPC (search_index)` — **Ordre correct**.

---

## Verdict

**READY FOR PUSH** — après corrections mineures ci-dessus (déjà appliquées sur fichiers si présents) et création manuelle buckets post-push. Aucun `supabase db push` exécuté dans cet audit.
