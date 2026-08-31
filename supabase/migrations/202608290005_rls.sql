-- 202608290005_rls.sql — Row Level Security (P5.7)
-- Principe : Public = lecture publiés seulement, Editor = contenu limité, Admin = gestion, Super Admin = tout + profiles

-- Activer RLS
alter table public.profiles enable row level security;
alter table public.news enable row level security;
alter table public.events enable row level security;
alter table public.documents enable row level security;
alter table public.gallery_albums enable row level security;
alter table public.gallery_images enable row level security;
alter table public.result_publications enable row level security;
alter table public.result_files enable row level security;
alter table public.result_search_index enable row level security;

-- Helpers : has_role déjà créé en 0001

-- PROFILES
drop policy if exists "Profiles self read" on public.profiles;
create policy "Profiles self read" on public.profiles for select to authenticated using (id = auth.uid() or public.has_role('admin'));
drop policy if exists "Super admin manage profiles" on public.profiles;
create policy "Super admin manage profiles" on public.profiles for all to authenticated using (public.has_role('super_admin'));

-- NEWS — public lit seulement published + publish_at ok + expires_at ok
drop policy if exists "News public read published" on public.news;
create policy "News public read published" on public.news for select to anon, authenticated using (
  status = 'published' and (published_at is null or published_at <= now()) and (expires_at is null or expires_at > now())
);
drop policy if exists "News editor write" on public.news;
create policy "News editor write" on public.news for all to authenticated using (public.has_role('editor')) with check (public.has_role('editor'));

-- EVENTS — similaire news
drop policy if exists "Events public read" on public.events;
create policy "Events public read" on public.events for select to anon, authenticated using (status = 'published');
drop policy if exists "Events editor write" on public.events;
create policy "Events editor write" on public.events for all to authenticated using (public.has_role('editor'));

-- DOCUMENTS — public lit published
drop policy if exists "Documents public read" on public.documents;
create policy "Documents public read" on public.documents for select to anon, authenticated using (status='published' and (expires_at is null or expires_at > now()));
drop policy if exists "Documents editor write" on public.documents;
create policy "Documents editor write" on public.documents for all to authenticated using (public.has_role('editor'));

-- GALLERY — public read, editor write
drop policy if exists "Gallery public read albums" on public.gallery_albums;
create policy "Gallery public read albums" on public.gallery_albums for select to anon, authenticated using (true);
drop policy if exists "Gallery editor write albums" on public.gallery_albums;
create policy "Gallery editor write albums" on public.gallery_albums for all to authenticated using (public.has_role('editor'));
drop policy if exists "Gallery public read images" on public.gallery_images;
create policy "Gallery public read images" on public.gallery_images for select to anon, authenticated using (true);
drop policy if exists "Gallery editor write images" on public.gallery_images;
create policy "Gallery editor write images" on public.gallery_images for all to authenticated using (public.has_role('editor'));

-- RESULT_PUBLICATIONS — public peut lire seulement published + publish_at ok (pour compte à rebours, on expose scheduled en lecture limitée si besoin)
drop policy if exists "Results public read published" on public.result_publications;
create policy "Results public read published" on public.result_publications for select to anon, authenticated using (status='published' and (publish_at is null or publish_at <= now()));
drop policy if exists "Results admin write" on public.result_publications;
create policy "Results admin write" on public.result_publications for all to authenticated using (public.has_role('admin'));

-- RESULT_FILES — jamais en lecture anon
drop policy if exists "Result files admin only" on public.result_files;
create policy "Result files admin only" on public.result_files for all to authenticated using (public.has_role('admin'));

-- RESULT_SEARCH_INDEX — JAMAIS en select direct pour anon (P6). Seul via RPC SECURITY DEFINER.
-- On bloque tout select direct :
drop policy if exists "Search index no public read" on public.result_search_index;
create policy "Search index no public read" on public.result_search_index for select to anon using (false);
drop policy if exists "Search index admin read" on public.result_search_index;
create policy "Search index admin read" on public.result_search_index for select to authenticated using (public.has_role('admin'));
-- Fonction RPC search_student_result aura SECURITY DEFINER et contounera RLS

comment on table public.result_search_index is 'Accès public UNIQUEMENT via fonction search_student_result — RLS bloque SELECT direct (P6).';
