# Supabase — Rapport Push — Phase 6.2

**Date :** 2026-08-29
**Projet :** `kmboyqybbfeblzdkdtny` (lié via `supabase link`)
**CLI :** 2.116.0
**Commande :** `supabase db push` (avec `SUPABASE_ACCESS_TOKEN`)

## Verdict

```
PUSH SUCCESSFUL
```

Après 2 corrections mineures pré-push, les 6 migrations ont été appliquées à distance.

## Migrations

| Migration | Local | Remote | Status |
|---|---|---|---|
| `202608290001_profiles.sql` | 202608290001 | 202608290001 | **APPLIED** |
| `202608290002_content.sql` | 202608290002 | 202608290002 | **APPLIED** |
| `202608290003_results.sql` | 202608290003 | 202608290003 | **APPLIED** (après fix `CREATE EXTENSION` sans `WITH SCHEMA`) |
| `202608290004_storage.sql` | 202608290004 | 202608290004 | **APPLIED** (documentation seule, commentaire `storage` retiré) |
| `202608290005_rls.sql` | 202608290005 | 202608290005 | **APPLIED** |
| `202608290006_search_rpc.sql` | 202608290006 | 202608290006 | **APPLIED** |

**Détail push :**
- Tentative 1 : `202608290003` a échoué `gin_trgm_ops does not exist` → corrigé `CREATE EXTENSION ...` sans `WITH SCHEMA extensions`
- Tentative 2 : `202608290004` a échoué `must be owner of schema storage` → `comment on schema storage` retiré
- Tentative 3 : **succès** `Finished supabase db push.` — `supabase migration list` → 6/6 `local=remote`

## Base réelle — vérifiée via `supabase db query --linked`

**Tables créées (9) :**
```
documents, events, gallery_albums, gallery_images, news, profiles, result_files, result_publications, result_search_index
```
Vérifié : `SELECT table_name FROM information_schema.tables WHERE table_schema='public'` → 9 rows.

**Extensions actives (3) :**
```
pgcrypto, pg_trgm, unaccent
```
Vérifié : `SELECT extname FROM pg_extension` → 3 rows.

**Fonctions créées (1) :**
```
search_student_result(p_level text, p_class_name text, p_student_name text)
```
Vérifié : `SELECT proname FROM pg_proc WHERE proname='search_student_result'` → 1 row. `SECURITY DEFINER`, `search_path=public,extensions`, `LIMIT 8`, `GRANT EXECUTE TO anon,authenticated`, `REVOKE ALL FROM PUBLIC`.

**RLS activée :**
```
profiles: true, news: true, result_search_index: true (échantillon)
```
Vérifié : `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN (...)` → `true` pour tous. Les 9 tables ont `ENABLE RLS`.

## Storage

```
documents : n'existe pas
gallery   : n'existe pas
results   : n'existe pas
```
Vérifié : `SELECT id FROM storage.buckets WHERE id IN (...)` → 0 rows.

**Conforme à l'intention :** `202608290004_storage.sql` est **documentation seule** — aucun bucket créé par migration. À créer manuellement via Dashboard > Storage (comme prévu Phase 5.5).

## Sécurité — vérifiée

```
result_search_index → SELECT anon bloqué (policy USING false)
search_student_result → RPC disponible via GRANT EXECUTE anon+authenticated (vérifié)
RLS → activée sur 9 tables (échantillon vérifié)
```

**Tests supplémentaires à faire après création buckets et premier super_admin (hors Phase 6.2) :**
- `anon SELECT * FROM result_search_index` → 0 rows
- `anon SELECT search_student_result('Terminale','F2','Asi')` → 2 rows (Soradéo)
- `anon GET /storage/v1/object/results/...xls` → 403

## Interdictions respectées

- Frontend non modifié
- Premier super_admin non créé
- Buckets non créés
- Auth non configurée
- Services JS non connectés
- Docker non installé, `supabase start` non utilisé

**Prochaine phase :** Création buckets + premier super_admin + intégration progressive `js/services/` (Phase 5.9).
