# Rapport Phase 6.5.3 — Intégration Documents Supabase

**Date :** 2026-08-30
**Module :** `documents` — troisième module métier connecté

## 1. Fichiers modifiés

| Fichier | Modification |
|---|---|
| `js/services/documentService.js` | Réécrit complet : `getPublishedDocuments(limit)` (public `status=published` + `expires_at` ), `getAdminDocuments()`, `uploadDocument(file)` (PDF ≤8M, path `YYYY/uuid.pdf`), `createDocument({title,description,file,status,expires_at})` (upload → insert avec `created_by`), `updateDocument()`, `deleteDocument()` (DB + Storage), `getPublicDocumentUrl()` (public bucket), `getPublicUrlAsync()` |
| `admin/documents.html` | `await initAdmin({requiredRole:"editor"})`, `getAdminDocuments` + DOM `textContent`, `createDocument` avec `title/description/file/status/expires_at`, `deleteDocument` avec confirm, upload état `Téléversement...`, validation `title/file` requis |
| `public/documents.html` | `getPublishedDocuments(20)` + `getPublicDocumentUrl` pour `Télécharger` (target `_blank`), loading `Chargement…`, empty `Aucun document…`, error `Impossible…`, `textContent` |

Aucune migration existante modifiée (0001-0009 intactes). `AppConfig.useMock` conservé pour autres modules.

## 2. Fonctions créées (documentService.js)

- `getPublishedDocuments(limit=20)` — `select * where status='published' and (expires_at is null or > now()) order by created_at desc`
- `getAdminDocuments()` — `select * order by created_at desc` (RLS `has_role(editor)`)
- `uploadDocument(file)` — vérifie `application/pdf` + `≤8Mo`, `supabase.storage.from('documents').upload(path)` avec `path=YYYY/uuid-saname.pdf`
- `createDocument({title,description,file,status,expires_at})` — `uploadDocument` → `insert` avec `created_by` + rollback storage si DB échoue
- `updateDocument(id,patch)`, `deleteDocument(id)` — `delete` DB + `storage.remove([file_path])`
- `getPublicDocumentUrl(file_path)` — `https://.../storage/v1/object/public/documents/<clean>` (bucket PUBLIC)

## 3. Supabase

- **Table :** `documents` (`id,title,description,file_path,file_name,file_type,file_size,status,expires_at,created_by,created_at`) — déjà créée `0002`
- **Bucket :** `documents` **PUBLIC**, `file_size_limit 8388608`, `allowed_mime_types ['application/pdf']` — vérifié `SELECT public FROM storage.buckets` → `true`
- **Policies Storage `storage.objects` :** `Documents public read` (SELECT anon,authenticated), `Documents editor insert/update/delete` (`has_role('editor')`) — vérifié `pg_policies` 12 rows
- **RLS `documents` :** `Documents public read` (`published` + `expires_at`), `Documents editor write` (`has_role('editor')`)

## 4. Tests

| Test | Rôle | Résultat |
|---|---|---|
| `editor` upload `test.pdf` + `create published` | editor | **201** id `3326c5df` |
| `editor` create `draft` | editor | **201** |
| `editor` create `expired` (hier) | editor | **201** |
| `XSS` `title="<script>alert('xss')</script>"` | editor | **201** stocké tel quel |
| `anon` read `published` | anon | **200** 2 rows (published + XSS, expired exclu) **PASS** |
| `anon` read `draft` | anon | **200 0 rows** **PASS** |
| `anon` INSERT | anon | **401** bloqué **PASS** |
| `editor` XSS rendu | anon GET → `title` = `<script>...` | Frontend `textContent` → **pas d'exécution** **PASS** |
| `anon` URL publique | `GET /object/public/documents/2026/...pdf` anon | **200** (public bucket) **PASS** |
| `delete` | editor | **204** DB + Storage **PASS** |

## 5. Sécurité

- **RLS active** sur `documents` (vérifié)
- **service_role jamais frontend** — uniquement `anonKey` dans `app.config.js`
- **XSS protégé** — `createElement`+`textContent` dans `admin` et `public`
- **Validation fichier** — `application/pdf` + `8 Mo` côté service + `file_size_limit` côté bucket
- **Storage** — `documents` PUBLIC mais `INSERT/UPDATE/DELETE` seulement `has_role('editor')` (anon bloqué)

## 6. Nettoyage

- **Créés :** 4 documents de test (`published`, `draft`, `expired`, `XSS`) + 2 objets Storage `2026/test-doc-*.pdf`
- **Supprimés :** 4 `DELETE /rest/v1/documents?id=eq.*` **204** + 2 `DELETE /storage/v1/object/documents/2026/test-doc-*.pdf` **200** → `count 0` et `list 2026/` **[]**
- **Conservés :** **Aucun** — base et Storage propres

## 7. Limites

- **Galerie/Results** toujours **MOCK**
- **Expiration** masque côté lecture, pas de cron auto `expired`→`archived` (prévu Phase 5.13)
- **Remplacement fichier** (`update` avec nouveau PDF) non testé avec ancien orphan check complet (rollback prévu si DB échoue, mais pas si Storage échoue après DB)
- **Images** `image_path` non utilisé pour documents (PDF seul)

**Verdict :** Module Documents **fonctionnel en réel** — `ADMIN → Storage documents → table documents → RLS → PUBLIC` flux complet, design intact.
