# Architecture Base de Données — IPP Supabase — Phase 5.4

> Document de conception **avant migrations**. Toutes les colonnes/types sont proposés selon `docs/supabase-data-audit.md` et le cahier Phase 5.4-5.5.

**Principes :**
- `auth.users` = source unique auth — `profiles.id` FK
- Aucun stockage fichier en base — seul `file_path` + bucket Storage
- RLS activée sur toute table applicative (voir Phase 5.7)
- Index sur `status`, `published_at`, `student_name_normalized`
- Publication programmée via `publish_at` + `status` (comparaison `publish_at <= now()`)

---

## 1. `profiles`

```sql
profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('super_admin','admin','editor')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)
-- Index: role
-- RLS: voir 5.7
-- Trigger: handle_new_user (après insert auth.users) — à créer avec fonction SECURITY DEFINER
-- Premier super_admin : création manuelle via SQL/dashboard, pas d'inscription publique
```

---

## 2. `news` — actualités/communiqués

```sql
news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  excerpt text,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','published','expired','archived')),
  published_at timestamptz,
  expires_at timestamptz,
  image_path text, -- Storage documents/gallery si besoin
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)
-- Index: status, published_at, expires_at
-- Rétention: expired/archived → nettoyage programmé (Phase 5.13)
```

---

## 3. `events`

```sql
events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  event_date date NOT NULL,
  end_date date,
  status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft','scheduled','published','expired','archived')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)
-- Index: event_date, status
```

---

## 4. `documents`

```sql
documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  file_path text NOT NULL, -- bucket documents
  file_name text NOT NULL,
  file_type text,
  file_size int, -- bytes
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','expired','archived')),
  expires_at timestamptz,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
)
-- Index: status, expires_at
-- Storage: bucket `documents`
```

---

## 5. `gallery_albums` + `gallery_images`

```sql
gallery_albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL, -- ex: Semaine technique
  description text,
  event_date date,
  cover_image_path text, -- bucket gallery
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
)

gallery_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
  image_path text NOT NULL, -- bucket gallery
  caption text,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
)
-- Index: album_id, sort_order
-- Storage: bucket `gallery` — conservation longue (P5.13)
```

---

## 6. Résultats — publication, fichiers, index léger

### 6.1 `result_publications`

```sql
result_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level text NOT NULL,        -- Seconde/Première/Terminale
  class_name text NOT NULL,   -- F2/D/A4 ...
  session text NOT NULL,      -- Deuxième trimestre
  school_year text NOT NULL,  -- 2025-2026
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','published','expired','archived')),
  publish_at timestamptz,     -- programmation
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(level, class_name, session, school_year)
)
-- Index: (level, class_name, session), status, publish_at
```

### 6.2 `result_files`

```sql
result_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES result_publications(id) ON DELETE CASCADE,
  file_path text NOT NULL, -- bucket results
  file_name text NOT NULL, -- ex: TERMINALE_F2_T2_2026.xlsx
  file_type text,          -- xlsx/pdf
  file_size int,
  created_at timestamptz DEFAULT now()
)
-- Storage: bucket `results`
```

### 6.3 `result_search_index` — index léger pour recherche publique

```sql
result_search_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES result_publications(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  student_name_normalized text NOT NULL, -- lower(unaccent(name))
  average text,  -- "14,82"
  rank text,     -- "03"
  total text,    -- "42"
  decision text, -- ADMIS / Ajourné
  created_at timestamptz DEFAULT now()
)
-- Index: GIN trigram sur student_name_normalized, BTREE publication_id
-- Jamais exposée en SELECT * public — accès via fonction RPC
```

**Fonction recherche publique (Phase 5.5) :**

```sql
CREATE OR REPLACE FUNCTION search_student_result(
  p_level text, p_class_name text, p_student_name text
) RETURNS TABLE (student_name text, average text, rank text, total text, decision text)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF p_level IS NULL OR p_class_name IS NULL OR char_length(trim(p_student_name)) < 2 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT rsi.student_name, rsi.average, rsi.rank, rsi.total, rsi.decision
  FROM result_search_index rsi
  JOIN result_publications rp ON rsi.publication_id = rp.id
  WHERE rp.level = p_level
    AND rp.class_name = p_class_name
    AND rp.status = 'published'
    AND (rp.publish_at IS NULL OR rp.publish_at <= now())
    AND rsi.student_name_normalized ILIKE '%' || lower(unaccent(p_student_name)) || '%'
  LIMIT 8;
END; $$;
-- REVOKE all, GRANT execute TO anon, authenticated
```

---

## 7. Storage — buckets

| Bucket | Contenu | RLS Storage |
|---|---|---|
| `documents` | PDF publics | anon read si `documents.status=published` / `publish_at` ok, authenticated write si `hasRole(admin/editor)` |
| `gallery` | albums/photos | anon read, authenticated write |
| `results` | Excel/PDF source | **anon NON** — seul index via RPC ; authenticated write |
| `news-images` (optionnel) | images actu | anon read si publié |

---

## 8. Diagramme relations (textuel)

```
auth.users 1─1 profiles
profiles 1─* news/events/documents/gallery_albums/result_publications (created_by)
gallery_albums 1─* gallery_images
result_publications 1─* result_files
result_publications 1─* result_search_index (via publication_id)
```

---

## 9. Prochaines migrations (Phase 5.11)

```
supabase/migrations/
  202608290001_profiles.sql
  202608290002_content_news_events_documents_gallery.sql
  202608290003_results.sql
  202608290004_storage.sql
  202608290005_rls.sql
  202608290006_search_rpc.sql
```

Chaque fichier 1 responsabilité — pas de migration géante.
