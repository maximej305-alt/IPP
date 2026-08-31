-- =============================================================================
-- 202608310011_results_publication_management.sql
-- Phase 6.5.5.3 — Gestion réelle des publications de résultats
-- Comble les manques RLS/RPC pour permettre le pipeline admin complet
-- (créer / laisser brouillon / publier / programmer / archiver / expirer /
--  remplacer fichier / supprimer) avec visibilité publique cohérente via RPC.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) result_search_index — accès admin en INSERT / UPDATE / DELETE
--    (le SELECT admin existe déjà : "Search index admin read")
--    Nécessaire pour : indexation des élèves à l'import, remplacement de fichier,
--    suppression cohérente via le frontend (JWT admin + anon key).
--    has_role('admin') couvre admin ET super_admin (voir has_role).
-- -----------------------------------------------------------------------------
drop policy if exists "Search index admin insert" on public.result_search_index;
create policy "Search index admin insert" on public.result_search_index
  for insert to authenticated
  with check (public.has_role('admin'));

drop policy if exists "Search index admin update" on public.result_search_index;
create policy "Search index admin update" on public.result_search_index
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

drop policy if exists "Search index admin delete" on public.result_search_index;
create policy "Search index admin delete" on public.result_search_index
  for delete to authenticated
  using (public.has_role('admin'));

-- -----------------------------------------------------------------------------
-- 2) search_student_result — visible si :
--      status IN ('published','scheduled')
--      AND publish_at <= now()
--      AND (expires_at IS NULL OR expires_at > now())
--    Respecte la Phase K (programmation auto-visible via publish_at)
--    et la Phase L (expiration : expired/expirée -> plus visible).
-- -----------------------------------------------------------------------------
create or replace function public.search_student_result(
  p_level text,
  p_class_name text,
  p_student_name text
)
returns table (student_name text, average text, rank text, total text, decision text)
language plpgsql
security definer
set search_path = public, extensions
as $func$
declare
  v_name text;
begin
  v_name := trim(coalesce(p_student_name,''));
  if p_level is null or p_class_name is null or char_length(v_name) < 2 then
    return;
  end if;
  return query
  select rsi.student_name, rsi.average, rsi.rank, rsi.total, rsi.decision
  from public.result_search_index rsi
  join public.result_publications rp on rsi.publication_id = rp.id
  where rp.level_name = p_level
    and rp.class_name = p_class_name
    and rp.status in ('published','scheduled')
    and (rp.publish_at is null or rp.publish_at <= now())
    and (rp.expires_at is null or rp.expires_at > now())
    and rsi.student_name_normalized ilike '%' || lower(unaccent(v_name)) || '%'
  limit 8;
end;
$func$;

revoke all on function public.search_student_result(text,text,text) from public;
grant execute on function public.search_student_result(text,text,text) to anon, authenticated;

comment on function public.search_student_result is
  'Recherche publique ciblée — status published|scheduled, publish_at<=now, expires_at>now, limite 8, ≥2 chars.';

-- -----------------------------------------------------------------------------
-- 3) result_publications — lecture publique cohérente
--    Une publication est "visible publiquement" si la date de publication est
--    atteinte et si elle n'est pas expirée. La programmation (scheduled) devient
--    lisible quand publish_at<=now (permet le compte à rebours / la bascule auto).
--    draft / expired / archived : jamais visibles publiquement.
-- -----------------------------------------------------------------------------
drop policy if exists "Results public read published" on public.result_publications;
create policy "Results public read published" on public.result_publications
  for select to anon, authenticated
  using (
    status in ('published','scheduled')
    and (publish_at is null or publish_at <= now())
    and (expires_at is null or expires_at > now())
  );

-- -----------------------------------------------------------------------------
-- 4) Documenter la convention publish_at / published_at
--    publish_at   = date à laquelle la publication devient publique.
--    published_at = date réelle à laquelle elle a été mise en ligne (réelle).
-- -----------------------------------------------------------------------------
comment on column public.result_publications.publish_at is
  'Date à laquelle la publication doit devenir publique (programmation).';
comment on column public.result_publications.published_at is
  'Date réelle de mise en ligne effective (publiée manuellement).';
