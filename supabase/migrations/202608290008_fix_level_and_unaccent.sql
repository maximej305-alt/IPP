-- 202608290008_fix_level_and_unaccent.sql - Correctifs post-push Phase 6.4
-- 1. Renomme colonne level reservee -> level_name pour PostgREST
-- 2. Corrige search_student_result pour utiliser unaccent sans schema

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='result_publications' AND column_name='level') THEN
    ALTER TABLE public.result_publications RENAME COLUMN level TO level_name;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_result_pub_lookup;
CREATE INDEX IF NOT EXISTS idx_result_pub_lookup ON public.result_publications(level_name, class_name, session);

CREATE OR REPLACE FUNCTION public.normalize_student_name()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.student_name_normalized := lower(unaccent(NEW.student_name));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_student_result(
  p_level text,
  p_class_name text,
  p_student_name text
)
RETURNS TABLE (student_name text, average text, rank text, total text, decision text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_name text;
BEGIN
  v_name := trim(coalesce(p_student_name,''));
  IF p_level IS NULL OR p_class_name IS NULL OR char_length(v_name) < 2 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT rsi.student_name, rsi.average, rsi.rank, rsi.total, rsi.decision
  FROM public.result_search_index rsi
  JOIN public.result_publications rp ON rsi.publication_id = rp.id
  WHERE rp.level_name = p_level
    AND rp.class_name = p_class_name
    AND rp.status = 'published'
    AND (rp.publish_at IS NULL OR rp.publish_at <= now())
    AND rsi.student_name_normalized ILIKE '%' || lower(unaccent(v_name)) || '%'
  LIMIT 8;
END;
$$;

REVOKE ALL ON FUNCTION public.search_student_result(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_student_result(text,text,text) TO anon, authenticated;
