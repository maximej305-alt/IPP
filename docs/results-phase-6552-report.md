# RAPPORT — PHASE 6.5.5.2 — Correction et déploiement de la RPC `search_student_result`

## 1. Objectif

Réparer et vérifier définitivement la fonction `search_student_result()` : colonne `level_name`, recherche `unaccent`, insensible à la casse, longueur minimale, limite de résultats, données autorisées uniquement.

## 2. État des migrations

Commande : `supabase migration list`

```
migrations: 10 locales, 10 distantes
202608290001 → 202608290010  (local = remote)
```

**Résultat : local = remote = 10/10.**

La migration `202608290010_fix_search_student_result` est **déjà appliquée à distance**. L’état attendu (10 local / 9 remote) était inexact au moment de l’audit : le remote était déjà à 10. **Aucun push nécessaire.**

## 3. Vérification de la migration 0010

Fonction déployée à distance (`pg_get_functiondef`) :

```sql
CREATE OR REPLACE FUNCTION public.search_student_result(p_level text, p_class_name text, p_student_name text)
 RETURNS TABLE(student_name text, average text, rank text, total text, decision text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
...
  where rp.level_name = p_level
    and rp.class_name = p_class_name
    and rp.status = 'published'
    and (rp.publish_at is null or rp.publish_at <= now())
    and rsi.student_name_normalized ilike '%' || lower(unaccent(v_name)) || '%'
  limit 8;
```

Conforme à la migration 0010 :
- `level_name` ✓
- `security definer` ✓
- `search_path = public, extensions` (résolution correcte de `unaccent`) ✓
- Validation : level/class non vides + nom ≥ 2 caractères ✓
- `limit 8` ✓
- Retourne uniquement `student_name, average, rank, total, decision` ✓

## 4. Permissions (grants)

`search_student_result` — EXECUTE accordé à : `anon`, `authenticated` (+ service_role/postgres).

## 5. RLS (politiques distantes)

| Table | Politique | Cmd | Rôles | Qual |
|---|---|---|---|---|
| `result_publications` | Results public read published | SELECT | anon, authenticated | status='published' AND publish_at ok |
| `result_publications` | Results admin write | ALL | authenticated | has_role('admin') |
| `result_files` | Result files admin only | ALL | authenticated | has_role('admin') |
| `result_search_index` | Search index admin read | SELECT | authenticated | has_role('admin') |
| `result_search_index` | Search index no public read | SELECT | anon | `false` (bloqué) |

**Le public ne peut pas lire `result_search_index` ni `result_files` directement.** Une requête anon sur `result_search_index` retourne 200 avec 0 ligne (aucune fuite). Accès public aux résultats **uniquement** via `search_student_result`.

## 6. Tests RPC réels (contre le vrai projet distant)

Données : publication publiée existante `Terminale / F3 / T2 / 2025-2026`. Rows de test insérées puis supprimées après test.

| # | Cas | Command/action | Attendu | Réel | Résultat |
|---|---|---|---|---|---|
| T1 | Valide `Terminale/F3/Asima` | POST rpc/search_student_result (anon) | retourne l'élève | `Asima Test, 16.25, 1, 16.25, Admis` | ✅ PASS |
| T2 | Insensible casse `ASIMA` | POST rpc (anon) | retourne l'élève | retourné | ✅ PASS |
| T3 | Unaccent `elodie` (stocké `Élodie Tést`) | POST rpc (anon) | retourne l'élève | retourné | ✅ PASS |
| T4 | Nom trop court `A` | POST rpc (anon) | aucun résultat | aucun | ✅ PASS |
| T5 | Niveau erroné `Premiere/F3` | POST rpc (anon) | aucun résultat | aucun | ✅ PASS |
| T6 | Classe erronée `F2` | POST rpc (anon) | aucun résultat | aucun | ✅ PASS |
| T7 | SELECT direct anon `result_search_index` | GET /rest/v1/result_search_index | accès refusé / aucune donnée | 200, 0 ligne | ✅ PASS* |
| T8 | SELECT direct anon `result_files` | GET /rest/v1/result_files | aucune donnée | 200, 0 ligne | ✅ PASS* |

\* T7/T8 : l’API renvoie un 200 vide (RLS filtre), c’est le comportement Supabase pour « aucune ligne visible ». **Aucune donnée n’est retournée au public.** Un `403` strict exigerait de retirer les grants de table, non nécessaire puisque RLS bloque la lecture des lignes.

## 7. Nettoyage

- Rows de test `Asima Test` et `Élodie Tést` supprimées.
- Vérifié : `cnt = 0` dans `result_search_index` pour la publication de test.
- Aucune donnée de test restante.

## 8. Conclusion

La RPC `search_student_result` est **déployée, sécurisée et fonctionnelle** :
- Local = remote = 10/10 migrations.
- Recherche valide, insensible à la casse et aux accents.
- Validation des entrées (≥2 chars, level/class requis).
- Limite 8 résultats.
- Sortie restreinte aux données autorisées.
- RLS : accès public uniquement via la RPC, `result_search_index`/`result_files` inaccessibles en direct.

**PHASE 6.5.5.2 : PASS — arrêt conforme au cahier de route.**
Les phases suivantes (6.5.5.3 SheetJS, import, publication, etc.) ne sont **pas** démarrées.
