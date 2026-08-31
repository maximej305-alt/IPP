-- 202608290004_storage.sql — Buckets — DOCUMENTATION SEULE (Phase 5.5 §6)
-- ATTENTION: AUCUN bucket n'est créé par cette migration — création MANUELLE requise après `supabase link`
-- Buckets réellement créés par migration: AUCUN
-- Policies réellement créées: AUCUNE (exemples commentés ci-dessous)
-- Éléments restants manuels: créer buckets documents/gallery/results via Dashboard > Storage, puis appliquer policies

-- Buckets à créer (via Dashboard > Storage ou supabase storage create) :
-- documents (public read si published), gallery (public), results (private), news-images (public)

-- Exemple de création via SQL (si extension storage disponible) — à adapter selon projet lié :
-- insert into storage.buckets (id, name, public) values ('documents','documents', true) on conflict do nothing;
-- insert into storage.buckets (id, name, public) values ('gallery','gallery', true) on conflict do nothing;
-- insert into storage.buckets (id, name, public) values ('results','results', false) on conflict do nothing;

-- Politiques Storage (exemples — à activer après buckets) :

-- documents: anon peut lire si document publié (via table documents status), mais storage policy simple = public read
-- create policy "Public read documents" on storage.objects for select to anon, authenticated using (bucket_id = 'documents');
-- create policy "Editor write documents" on storage.objects for insert to authenticated with check (bucket_id = 'documents' and public.has_role('editor'));

-- gallery: public read, editor write
-- create policy "Public read gallery" on storage.objects for select to anon, authenticated using (bucket_id = 'gallery');

-- results: private — seul authenticated avec rôle peut lire/écrire ; public n'accède que via RPC, jamais direct Storage
-- create policy "Admin results write" on storage.objects for all to authenticated using (bucket_id = 'results' and public.has_role('admin'));

-- Buckets: documents (PDF), gallery (photos longue conservation), results (Excel/PDF source privé). Voir docs/database-architecture.md
