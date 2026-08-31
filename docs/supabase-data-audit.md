# Audit Données Frontend → Supabase — Phase 5.1

> **Objectif**: cartographier exactement ce que chaque service attend aujourd’hui en mock pour préparer les tables/buckets sans reconstruire le frontend.

**Source unique d’analyse :** `js/services/*.js` + `js/config/app.config.js` (useMock central)

---

## 1. `authService.js` — MOCK ONLY

**Fonctions actuelles :**
- `login(email,password)` — trouve dans USERS mock, `localStorage.setItem("ipp_auth")`
- `getCurrentUser() / current()` — parse `ipp_auth`
- `logout()`, `requireAuth()`, `hasRole(role)`, `hasAnyRole(roles)` — hiérarchie `editor(1) < admin(2) < super_admin(3)`

**Données attendues :**
```js
{ id, name, email, role: "super_admin" | "admin" | "editor" }
```

**Table future :** `profiles` (FK `auth.users.id`)
```
profiles { id uuid PK FK auth.users, full_name text, role text check(super_admin/admin/editor), created_at, updated_at }
```
**Storage :** non
**Note sécurité :** `isMock:true` — remplacer par `supabase.auth.signInWithPassword()` + trigger `handle_new_user` qui crée `profiles`.

---

## 2. `newsService.js`

**Fonctions :**
- `list({status})` — filtre `active/all`, `getById(id)`, `create(entry)`, `remove(id)`

**Objet mock :**
```js
{ id:"n1", title, excerpt, content, date:"2026-08-10", status:"active"|"expired", expiresAt?, image:null }
```

**Table future :** `news`
```
news { id uuid PK, title text, excerpt text, content text, status text check(draft/scheduled/published/expired/archived),
       published_at timestamptz, expires_at timestamptz, image_path text, created_by uuid FK, created_at, updated_at }
```
**Storage :** `news-images` (optionnel, si image non nulle) — bucket `documents` ou `gallery` selon usage
**Index :** `status`, `published_at`

---

## 3. `eventService.js`

**Fonctions :** `list()`, `groupedByMonth()` (dérivé), `create(ev)`, `remove(id)`

**Objet mock :**
```js
{ id, title, description, start:"2026-08-28", end:"2026-08-30", status:"active"|"programmed" }
```

**Table future :** `events`
```
events { id uuid PK, title text, description text, event_date date, end_date date, status text, created_by uuid, created_at, updated_at }
```
**Storage :** non (image facultative → `gallery` si besoin)
**Note :** `groupedByMonth` reste côté JS (tri), pas de vue nécessaire.

---

## 4. `documentService.js`

**Fonctions :** `list()`, `remove(id)` (+ création implicite via admin)

**Objet mock :**
```js
{ id, title, description, file_path?, file_name?, file_type, file_size, date, size:"1.2 Mo", status:"active", expires_at }
```

**Table future :** `documents`
```
documents { id uuid PK, title text, description text, file_path text (Storage), file_name text, file_type text, file_size int,
            status text, expires_at timestamptz, created_by uuid, created_at }
```
**Storage :** bucket `documents` (PDF). Base ne stocke que métadonnées + `file_path`.

---

## 5. `galleryService.js`

**Fonctions :** `list()`, `grouped()` (par `year`)

**Objet mock :**
```js
{ id, year:"2026", album:"Semaine technique", count:12, cover:"placeholder" }
```

**Tables futures :**
```
gallery_albums { id uuid PK, title text, description text, event_date date, cover_image_path text, created_by uuid, created_at }
gallery_images { id uuid PK, album_id uuid FK, image_path text, caption text, sort_order int, created_at }
```
**Storage :** bucket `gallery` — images conservées longtemps (contrairement à news).

---

## 6. `resultsService.js` + `excelService.js` — CŒUR

**Fonctions publiques actuelles (P6-7) :**
- `search({level, serie, query})` — exige `level && serie && query≥2`, limite 8
- `searchStudentResult({level, className, studentName})` — alias futur RPC
- `getByExactName(name, level, serie)`, `getById`
- `listAll()` — **ADMIN ONLY**, à ne jamais exposer public
- `simulateImport({level, serie, session, fileName})` — mock

**`excelService.js` (P8-9) :**
- `parseFileName(fileName)` — regex `^(SECONDE|PREMIERE|TERMINALE)[-_]([A-Z0-9]+)[-_](T[1-3]|...)` → `{niveau, serie, session}` ou `warning`
- `analyze({file, level, serie, session})` — `validateFile()` (≤8 Mo, `.xlsx/.pdf`) → `resultsService.simulateImport()` (mock)
- `validateFile()`

**Objet mock résultat :**
```js
{ id, name, level:"Terminale", serie:"F2", average:"14,82", rank:"03", total:"42", decision:"ADMIS"|"Ajourné", session:"Deuxième trimestre" }
```

**Tables futures :**
```
result_publications { id uuid PK, level text, class_name text, session text, school_year text,
                      status text check(draft/scheduled/published/expired/archived),
                      publish_at timestamptz, published_at timestamptz, expires_at timestamptz,
                      created_by uuid, created_at, updated_at }

result_files { id uuid PK, publication_id uuid FK, file_path text, file_name text, file_type text, file_size int, created_at }

result_search_index { id uuid PK, publication_id uuid FK, student_name text, student_name_normalized text,
                      average text, rank text, total text, decision text, created_at }
  -- index : (level, class_name) via publication, GIN sur normalized
```

**Storage :** bucket `results` (Excel/PDF source). Index léger seul interrogé par le public.

**Recherche publique future :** fonction `search_student_result(level, class_name, studentName)` vérifie `publish_at <= now()`, `status=published`, limite 8, retourne uniquement `student_name, average, rank, decision` — jamais `SELECT *`.

---

## 7. `notificationService.js`

**Fonctions :** `isSupported()`, `request()`, `getPref()`, `disable()`, `simulate()`

**Stockage actuel :** `localStorage("ipp_notify")` + `Notification.permission`

**Table future :** optionnel `push_subscriptions` si Web Push serveur, sinon reste client. Préparer `notifications` table si besoin.

---

## 8. Synthèse tables & buckets

| Service | Table | Bucket |
|---|---|---|
| auth | `profiles` | — |
| news | `news` | `documents` (images) |
| events | `events` | — |
| documents | `documents` | `documents` |
| gallery | `gallery_albums` + `gallery_images` | `gallery` |
| results | `result_publications` + `result_files` + `result_search_index` | `results` |
| notifications | — (ou `push_subscriptions`) | — |

**Ordre migratoire recommandé :** `profiles` → `news/events/documents/gallery` → `results` (3 tables) → `Storage` → `RLS`.

**Contrainte :** Budget 0, pas de Docker, pas de `supabase start` — migrations via CLI vers projet hébergé.
