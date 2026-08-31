-- 202608290010_fix_search_student_result.sql - Fix search_student_result column reference
-- Le colonne 'level' a ete renommee en 'level_name' dans la migration 0008.

drop function if exists public.search_student_result(text, text, text);
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
    and rp.status = 'published'
    and (rp.publish_at is null or rp.publish_at <= now())
    and rsi.student_name_normalized ilike '%' || lower(unaccent(v_name)) || '%'
  limit 8;
end;
$func$;

revoke all on function public.search_student_result(text,text,text) from public;
grant execute on function public.search_student_result(text,text,text) to anon, authenticated;
