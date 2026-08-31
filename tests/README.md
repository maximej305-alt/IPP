# Tests — Cycle de vie des fichiers de résultats (Phase 6.5.5.4)

## `results-file-lifecycle.spec.mjs`
Harness de validation qui exécute le **vrai** `js/services/resultFileService.js` contre le
Supabase distant. Couvre : upload multi-fichiers, liste, suppression individuelle,
remplacement ciblé, réconciliation (orphelins/manquants), suppression de publication
(cascade + Storage) et RLS (admin / editor / anon).

### Prérequis
- Node 18+ (fetch natif) et `@supabase/supabase-js` (déjà déclaré dans `package.json`).
  ```powershell
  cd tests
  npm install
  ```
- Deux comptes de test (admin + editor) avec les rôles corrects en DB, dont les JWT de
  sign-in sont fournis via variables d'env ou fichiers :
  - `IPP_ADMIN_TOKEN` → sinon `C:/Users/ken/AppData/Local/Temp/opencode/ip7_admin.txt`
  - `IPP_EDITOR_TOKEN` → sinon `C:/Users/ken/AppData/Local/Temp/opencode/ip7_editor.txt`

### Lancer
```powershell
cd tests
npm run test:lifecycle
```

### Garder `lib/resultFileService.local.mjs` à jour
Ce fichier est une copie du service réel avec l'import `supabaseClient.js` (CDN, non
exécutable en Node) remplacé par `supabaseClient.local.mjs` (SDK local + JWT). Après
toute modification de `js/services/resultFileService.js`, régénérer :

```powershell
$c = Get-Content "../js/services/resultFileService.js" -Raw
$c = $c.Replace('import { getSupabaseClient, isSupabaseEnabled } from "./supabaseClient.js";',
                'import { getSupabaseClient, isSupabaseEnabled } from "./supabaseClient.local.mjs";')
Set-Content "lib/resultFileService.local.mjs" -Value $c -Encoding UTF8
```

## Correctif documenté (Phase 6.5.5.4)
`resultFileService.reconcileResultFiles()` comparait le `file_path` stocké
(`results/{pubId}/{uuid}.{ext}`) après avoir retiré le préfixe `results/` (→
`{pubId}/...`), alors que le listing Storage (relatif au bucket) renvoie justement
`results/{pubId}/...`. Conséquence : **tout** fichier apparaissait à la fois comme
`missingInStorage` et `orphanedInStorage`. Le correctif compare désormais **sans
transformation**. Vérifié de bout en bout via le SDK (chargement, liste, reconcile,
téléchargement, URL signée) puis par ce harness (28 vérifications PASS).
