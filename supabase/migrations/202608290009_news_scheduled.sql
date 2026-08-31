-- 202608290009_news_scheduled.sql - Permet scheduled visible quand date passee (Phase 6.5.1)
-- RLS news public doit autoriser scheduled dont published_at <= now()

DROP POLICY IF EXISTS "News public read published" ON public.news;

CREATE POLICY "News public read published" ON public.news
FOR SELECT TO anon, authenticated
USING (
  (status = 'published' OR (status = 'scheduled' AND published_at IS NOT NULL AND published_at <= now()))
  AND (expires_at IS NULL OR expires_at > now())
);
