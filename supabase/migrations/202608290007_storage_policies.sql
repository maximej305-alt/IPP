-- 202608290007_storage_policies.sql — Storage policies (Phase 6.3)
-- Buckets déjà créés: documents (public), gallery (public), results (private)
-- Ne jamais autoriser anon INSERT/UPDATE/DELETE ; results jamais public

-- DOCUMENTS — public read, editor write
drop policy if exists "Documents public read" on storage.objects;
create policy "Documents public read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'documents');

drop policy if exists "Documents editor insert" on storage.objects;
create policy "Documents editor insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'documents' and public.has_role('editor'));

drop policy if exists "Documents editor update" on storage.objects;
create policy "Documents editor update" on storage.objects
  for update to authenticated using (bucket_id = 'documents' and public.has_role('editor')) with check (bucket_id = 'documents' and public.has_role('editor'));

drop policy if exists "Documents editor delete" on storage.objects;
create policy "Documents editor delete" on storage.objects
  for delete to authenticated using (bucket_id = 'documents' and public.has_role('editor'));

-- GALLERY — public read, editor write
drop policy if exists "Gallery public read" on storage.objects;
create policy "Gallery public read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'gallery');

drop policy if exists "Gallery editor insert" on storage.objects;
create policy "Gallery editor insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'gallery' and public.has_role('editor'));

drop policy if exists "Gallery editor update" on storage.objects;
create policy "Gallery editor update" on storage.objects
  for update to authenticated using (bucket_id = 'gallery' and public.has_role('editor')) with check (bucket_id = 'gallery' and public.has_role('editor'));

drop policy if exists "Gallery editor delete" on storage.objects;
create policy "Gallery editor delete" on storage.objects
  for delete to authenticated using (bucket_id = 'gallery' and public.has_role('editor'));

-- RESULTS — private, jamais public, admin seulement (editor ne peut pas)
drop policy if exists "Results admin select" on storage.objects;
create policy "Results admin select" on storage.objects
  for select to authenticated using (bucket_id = 'results' and public.has_role('admin'));

drop policy if exists "Results admin insert" on storage.objects;
create policy "Results admin insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'results' and public.has_role('admin'));

drop policy if exists "Results admin update" on storage.objects;
create policy "Results admin update" on storage.objects
  for update to authenticated using (bucket_id = 'results' and public.has_role('admin')) with check (bucket_id = 'results' and public.has_role('admin'));

drop policy if exists "Results admin delete" on storage.objects;
create policy "Results admin delete" on storage.objects
  for delete to authenticated using (bucket_id = 'results' and public.has_role('admin'));

-- Convention chemins (documentation)
-- documents/2026/reglement.pdf | gallery/2026/rentree/photo-001.jpg | results/2026/TERMINALE_F2_T2_2026.xlsx
