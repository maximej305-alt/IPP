-- 202608290006_search_rpc.sql — Fonction recherche ciblée (P5.5)
-- Vérifie niveau+classe obligatoires, limite 8, ne retourne que champs nécessaires

create or replace function public.search_student_result(
  p_level text,
  p_class_name text,
  p_student_name text
)
returns table (student_name text, average text, rank text, total text, decision text)
language plpgsql
security definer
set search_path = public, extensions
as $$
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
  where rp.level = p_level
    and rp.class_name = p_class_name
    and rp.status = 'published'
    and (rp.publish_at is null or rp.publish_at <= now())
    and rsi.student_name_normalized ilike '%' || lower(extensions.unaccent(v_name)) || '%'
  limit 8;
end;
$$;

-- Permissions : anon et authenticated peuvent exécuter, mais la fonction contrôle tout
revoke all on function public.search_student_result(text,text,text) from public;
grant execute on function public.search_student_result(text,text,text) to anon, authenticated;

comment on function public.search_student_result is 'Recherche publique ciblée — limite 8, exige niveau+classe+≥2 chars, publication publiée. Utilisée par resultsService.searchStudentResult() (P6).';
