-- 202608290003_results.sql — publications / fichiers / index léger
-- Enable pg extensions utiles
create extension if not exists "pgcrypto";
create extension if not exists "unaccent";
create extension if not exists "pg_trgm";

-- PUBLICATIONS
create table if not exists public.result_publications (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('Seconde','Première','Terminale')),
  class_name text not null,
  session text not null,
  school_year text not null,
  status text not null default 'draft' check (status in ('draft','scheduled','published','expired','archived')),
  publish_at timestamptz,
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(level, class_name, session, school_year)
);
create index if not exists idx_result_pub_lookup on public.result_publications(level, class_name, session);
create index if not exists idx_result_pub_status on public.result_publications(status);
create index if not exists idx_result_pub_publish_at on public.result_publications(publish_at);
drop trigger if exists trg_result_pub_updated_at on public.result_publications;
create trigger trg_result_pub_updated_at before update on public.result_publications for each row execute function public.handle_updated_at();

-- FICHIERS
create table if not exists public.result_files (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.result_publications(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_type text,
  file_size int,
  created_at timestamptz default now()
);
create index if not exists idx_result_files_pub on public.result_files(publication_id);

-- INDEX LÉGER RECHERCHE PUBLIQUE
create table if not exists public.result_search_index (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.result_publications(id) on delete cascade,
  student_name text not null,
  student_name_normalized text not null,
  average text,
  rank text,
  total text,
  decision text,
  created_at timestamptz default now()
);
create index if not exists idx_search_pub on public.result_search_index(publication_id);
create index if not exists idx_search_normalized_trgm on public.result_search_index using gin (student_name_normalized gin_trgm_ops);
-- Trigger de normalisation (lower + unaccent)
create or replace function public.normalize_student_name()
returns trigger language plpgsql as $$
begin
  new.student_name_normalized := lower(extensions.unaccent(new.student_name));
  return new;
end; $$;
drop trigger if exists trg_search_normalize on public.result_search_index;
create trigger trg_search_normalize before insert or update on public.result_search_index
for each row execute function public.normalize_student_name();
