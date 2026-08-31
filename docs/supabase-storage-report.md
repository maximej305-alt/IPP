# Supabase — Rapport Storage — Phase 6.3

**Date :** 2026-08-29
**Projet :** `kmboyqybbfeblzdkdtny` (lié)
**CLI :** 2.116.0 — `supabase db query --linked` + REST `storage/v1/object`

## A. Verdict

```
STORAGE SUCCESSFUL
```

Les 3 buckets sont créés, visibilité correcte, policies appliquées, tests anonymes vérifiés.

## B. Buckets

| Bucket | Existe | Visibilité | Contenu | File_size_limit | MIME |
|---|---|---|---|---|---|
| `documents` | **Oui** | **PUBLIC** (`public=true`) | PDF publiés | 8388608 (8 Mo) | `application/pdf` |
| `gallery` | **Oui** | **PUBLIC** | Images | 5242880 (5 Mo) | `image/jpeg, image/png, image/webp, image/jpg` |
| `results` | **Oui** | **PRIVATE** (`public=false`) | Excel/PDF sources | 8388608 | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/pdf` |

Vérifié : `SELECT id, public FROM storage.buckets` → 3 rows.

## C. Policies — `storage.objects`

| Bucket | SELECT anon | SELECT authenticated | INSERT | UPDATE | DELETE |
|---|---|---|---|---|---|
| `documents` | **Oui** (`anon,authenticated` `bucket_id='documents'`) | Oui | **has_role('editor')** | **has_role('editor')** | **has_role('editor')** |
| `gallery` | **Oui** | Oui | **has_role('editor')** | **has_role('editor')** | **has_role('editor')** |
| `results` | **Non** (aucune policy anon) | **has_role('admin')** | **has_role('admin')** | **has_role('admin')** | **has_role('admin')** |

Détail (12 policies) :
- `Documents public read` SELECT anon,authenticated
- `Documents editor insert/update/delete` → `has_role('editor')`
- `Gallery public read` SELECT anon,authenticated
- `Gallery editor insert/update/delete` → `has_role('editor')`
- `Results admin select/insert/update/delete` → `has_role('admin')` (aucune policy anon)

**Hiérarchie respectée :** `editor < admin < super_admin` via `has_role()` — `super_admin` hérite.

## D. Tests

| Test | Résultat |
|---|---|
| `anon read documents` (`GET /object/public/documents/test-public.pdf`) | **✓ 200** (public) |
| `anon read gallery` (`GET /object/public/gallery/test-public.jpg`) | **✓ 200** (public) |
| `anon read results` (`GET /object/results/TEST_RESULTS.xlsx` avec anon) | **✓ 400 bloqué** (privé) |
| `anon upload documents` (`POST /object/documents/anon-test.pdf` anon) | **✓ 400 bloqué** |
| `anon upload results` (anon) | **✓ 400 bloqué** |
| `anon update/delete` | **✓ 400 bloqué** (même RLS) |
| `service_role upload documents/gallery/results` | **✓ 200** (contourne RLS) |

**Tests rôles (editor/admin/super_admin) :** `À TESTER APRÈS CONFIGURATION AUTH` — aucun utilisateur réel avec rôle n'existe encore (Phase 6.4). Ne pas prétendre.

**Test spécifique résultats :** `TEST_RESULTS.xlsx` uploadé via `service_role`, `GET` anon → **400 bloqué** — connaître le chemin ne suffit pas.

## E. Migrations

- **Migration Storage supplémentaire créée :** **Oui**
- **Nom :** `202608290007_storage_policies.sql`
- **Contenu :** 12 policies `storage.objects` (4 documents + 4 gallery + 4 results) + convention chemins
- **Push :** **Oui** — `supabase db push` → `Finished` — `migration list` 7/7 `local=remote`
- **Buckets créés par migration :** **Aucun** — buckets créés **manuellement via SQL** `INSERT INTO storage.buckets` avant migration policies (conforme doc)

## F. Fichiers de test

- **Créés :** `test-public.pdf` (15 bytes), `test-public.jpg` (293 bytes), `TEST_RESULTS.xlsx` (12 bytes) via `service_role` — avec bon MIME
- **Supprimés :** 3 fichiers via `DELETE /storage/v1/object/...` avec `service_role` — vérifié `ls` ne liste plus que `documents/`
- **Conservés :** **Aucun** — nettoyage complet, aucun fichier sensible restant

## G. État final

```
DATABASE
    ✓ Tables 9/9
    ✓ RLS activée (has_role hiérarchique)
    ✓ RPC search_student_result (LIMIT 8, unaccent, published)

STORAGE
    ✓ Buckets 3/3 (documents public, gallery public, results privé)
    ✓ Policies 12/12 (anon INSERT/UPDATE/DELETE bloqués, results jamais public)
    ✓ Tests anonymes 6/6

AUTH
    ⏳ Non configuré (Phase 6.4)

SUPER ADMIN
    ⏳ Non créé

FRONTEND
    ✓ Toujours Mock (AppConfig.useMock=true, aucun service connecté)
```

**Interdictions respectées :** Frontend non modifié, `useMock` non changé, clés non exposées, Docker non installé, `supabase start` non utilisé.
