# Audit — Phase 6.5.5.4 — Cycle de vie des fichiers Résultats

**Date :** 2026-08-31
**Projet :** IPP WEB PLATFORM — `C:\Users\ken\Desktop\IPP\`
**Mode :** Audit uniquement — aucune modification de code, aucune migration, aucun `db push`, aucune donnée réelle touchée.
**Périmètre :** remplacement / suppression / intégrité des fichiers du module Résultats.

---

## 1. Résumé exécutif

```
Upload initial           : PRÊT (resultsService.importStudents + validateFile)
Remplacement fichier     : EXISTE mais fragilisé (erreurs masquées par .catch(()=>{}))
Suppression individuelle : MANQUANTE (aucune fonction deleteResultFile)
Suppression publication : EXISTE (deletePublication : Storage puis cascade DB)
Rollback                : PARTIEL (rollback silencieux, pas d'état cleanupWarning)
Nettoyage orphelins     : ABSENT (aucun outil de réconciliation)
Storage bucket results   : PRIVÉ ✅ (public=false, policies admin only)
result_files multi-fichiers : OUI (N lignes par publication, Excel+PDF possible)
Migrations              : 11/11 locales = distantes (aucune en attente)
Données réelles F3      : préservées (seule ligne restante, intacte)
```

**Verdict :** L'architecture supporte déjà l'upload, le remplacement, la suppression de publication et le rollback basique. **Les manques bloquants pour cette phase** sont : (1) la **suppression individuelle d'un fichier**, (2) la **non-masquage des erreurs de nettoyage** (rollback / suppression Storage), (3) un **service dédié** `resultFileService.js` et (4) un **outil de détection des orphelins** Storage/DB. Aucune incohérence structurelle au niveau DB/Storage (pas de pression à modifier le schéma).

---

## 2. Architecture actuelle

```
UI (admin/results.html)
   ↓  resultsService.js  (importStudents / replacePublicationFile / deletePublication)
   ↓  supabase (DB result_publications / result_files / result_search_index)
   ↓  supabase.storage.from('results')  (bucket PRIVATE)

Storage bucket "results" (PRIVATE, file_size_limit 8388608)
   ↓ policies storage.objects (SELECT/INSERT/UPDATE/DELETE) → authenticated + has_role('admin')
   ↓ has_role('admin') = true pour admin ET super_admin
```

### 2.1 Les 3 fichiers côté service
- `js/services/resultsService.js` (615 lignes) — contient TOUT : publications, cycle de vie, import, remplacement, suppression, validation, RPC public.
- `js/services/excelService.js` (67 lignes) — `parseFileName` + `validateFile` + `analyze()` (**mock** : pas de lecture réelle).
- (À créer) `js/services/resultFileService.js` — **obligatoire Phase 2** du cahier.

---

## 3. Flux d'upload actuel (`importStudents`)

1. `validateFile(file)` → `.xlsx/.xls/.pdf` + ≤8 Mo.
2. Upload Storage `results/{publicationId}/{uuid}-{sanitized}` (`upsert:false`).
3. Insert `result_files` (publication_id, file_path, file_name, file_type, file_size).
4. Insert `result_search_index` (eleves).
5. **catch** → rollback : delete `result_files` + delete Storage (les deux avec `.catch(()=>{})` → **silencieux**).

**Bon :** le fichier n'est jamais supprimé avant d'avoir servi (l'upload précède l'écriture DB). Le premier upload ne peut pas créer d'orphelin côté *ancien* fichier (il n'y en a pas).

---

## 4. Flux de remplacement actuel (`replacePublicationFile`)

1. `validateFile` nouveau fichier.
2. Récupère `oldFiles = getPublicationFiles(pub)` → `oldFile = oldFiles[0]` (**uniquement le plus récent**).
3. Upload NOUVEAU fichier (ancien intact).
4. Insert NOUVEL index (ancien conservé).
5. Insert NOUVELLE fiche `result_files`.
6. Delete ANCIEN index (`publication_id` → tout).
7. Delete ancienne fiche `result_files` + ancien objet Storage (`.catch(()=>{})`).
8. catch → rollback du nouveau (delete nouveaux index + nouvelle fiche + nouveau Storage).

### 🔴 Risque majeur (R3) : erreur de nettoyage masquée → orphelin Storage
À l'étape 7, si la suppression de l'**ancien** objet Storage échoue, `.catch(()=>{})` l'avale. Résultat : la ligne `result_files` de l'ancien fichier est supprimée, mais l'objet Storage reste → **fichier orphelin, sans ligne DB**. C'est exactement l'orphelin que la phase exige d'éliminer et de signaler (`cleanupWarning`).

### 🟠 Risque (R4) : multi-fichiers non géré pour le remplacement
`replacePublicationFile` ne remplace que `oldFiles[0]`. Si une publication a Excel **et** PDF, seuls le fichier le plus récent et son index disparaissent, mais l'autre fichier (ligne DB + objet) reste, et l'index est purgé entièrement. Pas de cohérence "un remplacement = un fichier ciblé".

---

## 5. Flux de suppression de publication actuel (`deletePublication`)

1. `files = getPublicationFiles(id)` → `paths`.
2. Pour chaque `path` : `storage.remove([p])` avec `.catch` collectant les échecs.
3. `result_publications.delete().eq('id',id)` → CASCADE supprime `result_files` + `result_search_index`.
4. Si des Storage ont échoué → throw générique.

### 🟠 Risque (R5) : ordre = perte DB si la suppression publication échoue
Les fichiers Storage sont supprimés **avant** la publication. Si `result_publications.delete()` échoue (contrainte/RLS/réseau), les objets Storage sont déjà partis, mais les lignes `result_files` + publication restent → **lignes DB orphelines pointant vers des fichiers inexistants**. Le cahier recommande : supprimer fichiers → **vérifier** → supprimer publication ; mais si la suppression de la publication échoue, il faut **soit** restaurer, **soit** signaler explicitement l'état. Actuellement : erreur générique, pas d'état explicite, pas de `cleanupWarning`.

---

## 6. Risques d'objets orphelins

| Scénario | Orphelin Storage | Orphelin DB | Détectable ? |
|---|---|---|---|
| Échec upload (validate) | non | non | oui (throw) |
| Échec DB après upload, rollback OK | non | non | oui |
| Échec DB après upload, rollback `.catch(()=>{})` échoue silencieusement | **oui** | non | **non** |
| Remplacement : échec suppression ancien Storage | **oui** | non | **non** (masqué) |
| Suppression publication : échec suppression Storage | **oui** | non | partiel (throw générique) |
| Suppression publication : échec delete publication après Storage OK | non | **oui** | partiel |

---

## 7. Opérations existantes vs manquantes

| Opération | État |
|---|---|
| `uploadResultFile()` | 🔸 partielle (`importStudents`, non exposée en service fichier) |
| `replaceResultFile()` | 🔸 partielle (`replacePublicationFile`, masque erreurs) |
| `deleteResultFile()` (individuel) | ❌ **manquante** |
| `deletePublicationFiles()` | 🔸 partielle (dans `deletePublication`) |
| Rollback structuré `{success, cleanupWarning}` | ❌ absent |
| Détection/réparation d'orphelins Storage/DB | ❌ absente |
| Validation extensions/taille | ✅ présente (`.xlsx/.xls/.pdf`, 8 Mo) |
| Signature simple (`%PDF-`, `PK`) | ❌ absente (optionnelle) |
| Nommage anticollision `{publication_id}/{uuid}` | ✅ présent (`results/{pub}/{uuid}-{name}`) |

---

## 8. Vérifications backups réelles (Supabase distant)

| Élément | Résultat |
|---|---|
| Bucket `results` public flag | `public=false` → **PRIVATE** ✅ |
| `file_size_limit` bucket | `8388608` (8 Mo) ✅ |
| Policies `storage.objects` (results) | SELECT/INSERT/UPDATE/DELETE → `has_role('admin')`, **aucune anon** ✅ |
| `has_role('admin')` couvre super_admin | ✅ (`required_role='admin' and role='super_admin'`) |
| Colonnes `result_files` | id, publication_id, file_path, file_name, file_type, file_size, created_at ✅ |
| Multi-fichiers par publication | ✅ (aucun unique sur publication_id) |
| Migrations locales = distantes | ✅ 11/11 (y compris 010 et 011) |
| Objets Storage bucket `results` | 0 (base propre) ✅ |
| Données réelles restantes | `F3 / Terminale / T2 / 2025-2026 / published` ✅ (intacte) |
| `result_files` / `result_search_index` | 0 ligne ✅ |

Pas d'incohérence structurelle bloquante au niveau schéma/RLS/Storage.

---

## 9. Plan de correction (Phase 6.5.5.4.2 → 6.5.5.4.8)

1. **Créer `js/services/resultFileService.js`** avec :
   - `validateFile(file)` (extension + taille + signature simple `%PDF-` / `PK`, optionnel)
   - `buildPath(schoolYear, publicationId, file)` → `results/{school_year}/{publication_id}/{uuid}.{ext}`
   - `uploadResultFile(publication, file)` → `{success, file}` / rollback auto en cas d'échec d'écriture DB
   - `replaceResultFile(publication, oldFile, file)` → `{success, file, cleanupWarning?}` — **upload d'abord, DB ensuite, suppression ancien dernier**, ne jamais masquer l'échec
   - `deleteResultFile(file)` → `{success, cleanupWarning?}` Storage puis DB
   - `deletePublicationFiles(publication)` + `deletePublication(publication)` (réordonner + `{success, cleanupWarning}`)
2. **Refactorer `resultsService.js`** : déléguer les opérations fichier à `resultFileService`, retourner les résultats structurés, arrêter `.catch(()=>{})` sur le nettoyage.
3. **`admin/results.html`** : liste des fichiers par publication, suppression individuelle avec confirmation, affichage des `cleanupWarning`. Rendus `textContent` (déjà le cas).
4. **Politique du schéma :** aucune migration nécessaire (la structure supporte déjà tout). Pas de `db push`.

---

## 10. Décision

Aucune modification structurelle requise : **je peux procéder au codage** (création de `resultFileService.js`, refactor `resultsService.js`, UI). Les incohérences détectées sont **logicielles** (masquage d'erreurs, absence de suppression individuelle, absence d'outil d'orphelins), non structurelles.

**FIN DE L'AUDIT — pause avant codage (rendu ci-dessus).**

---

## 11. Addendum implémentation — Correctif `reconcileResultFiles` (découvert en exécution)

> Découvert le 2026-08-31 pendant la Phase 6.5.5.4.2→8, via une validation **empirique du SDK
> Supabase en Node** (impossible de charger le CDN ES module hors navigateur ; on a donc exécuté
> `@supabase/supabase-js@2` embarqué localement contre le backend distant).

### Constat
`buildPath` renvoie `results/{publicationId}/{uuid}.{ext}` (préfixe `results/` déjà présent). Or
le SDK `storage.from('results').upload(path, …)` préfixe lui-même le bucket :
`_getFinalPath(path) = "results" + "/" + path`. En conséquence le **réel** chemin Storage
(= clé complète) est `results/results/{pubId}/{uuid}.{ext}`, soit un chemin **relatif au bucket**
égal à `results/{pubId}/{uuid}.{ext}`.

Vérifié expérimentalement avec le SDK réel :
- `upload("results/{pid}/uuid.xlsx")` → `fullPath = results/results/{pid}/uuid.xlsx`, objet bien
  listé sous `results/{pid}/uuid.xlsx` (relatif).
- `download(file_path)` et `createSignedUrl(file_path)` avec `file_path = results/{pid}/…`
  → **OK** (le suffixe `results/{pid}/…` correspond à l'emplacement réel).
- `remove([file_path])` avec ce même chemin → **OK** (préfixe relatif `results/{pid}/…`).

→ L'ensemble upload / téléchargement / URL signée / suppression est **auto-consistant** avec la
convention `file_path = results/{pid}/…`. **Seul** `reconcileResultFiles` était incohérent :
il retirait le préfixe `results/` du `file_path` (`dbRel`) puis le comparait au listing Storage
(relatif) **qui contient justement ce préfixe** → **chaque fichier apparaissait à la fois
`missingInStorage` et `orphanedInStorage`**.

### Correctif (`js/services/resultFileService.js`, `reconcileResultFiles`)
Comparaison **sans transformation** : `dbRel = p => p || ""`. Le `file_path` stocké
(`results/{pid}/…`) correspond exactement au nom relatif renvoyé par `list()`.

### Validation
Harness `tests/results-file-lifecycle.spec.mjs` (28 vérifications PASS) + contrôle manuel SDK
mettant en jeu upload multi-fichiers, liste, suppression individuelle, remplacement, réconciliation
(0 orphelin / 0 manquant), suppression de publication (CASCADE + Storage), et RLS
(editor bloqué en INSERT/DELETE Storage + `result_files`, anon : 0 ligne lisible). Données de test
entièrement nettoyées ; la seule publication restante est la vraie `F3` (intacte).

