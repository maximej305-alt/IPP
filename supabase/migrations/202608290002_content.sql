-- 202608290002_content.sql — news / events / documents / gallery

-- NEWS
create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  excerpt text,
  content text not null,
  status text not null default 'draft' check (status in ('draft','scheduled','published','expired','archived')),
  published_at timestamptz,
  expires_at timestamptz,
  image_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_news_status on public.news(status);
create index if not exists idx_news_published_at on public.news(published_at);
create index if not exists idx_news_expires_at on public.news(expires_at);
drop trigger if exists trg_news_updated_at on public.news;
create trigger trg_news_updated_at before update on public.news for each row execute function public.handle_updated_at();

-- EVENTS
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_date date not null,
  end_date date,
  status text not null default 'published' check (status in ('draft','scheduled','published','expired','archived')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_events_date on public.events(event_date);
create index if not exists idx_events_status on public.events(status);
drop trigger if exists trg_events_updated_at on public.events;
create trigger trg_events_updated_at before update on public.events for each row execute function public.handle_updated_at();

-- DOCUMENTS
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  file_path text not null,
  file_name text not null,
  file_type text,
  file_size int,
  status text not null default 'published' check (status in ('draft','published','expired','archived')),
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists idx_documents_status on public.documents(status);
create index if not exists idx_documents_expires on public.documents(expires_at);

-- GALLERY
create table if not exists public.gallery_albums (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_date date,
  cover_image_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);
create table if not exists public.gallery_images (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.gallery_albums(id) on delete cascade,
  image_path text not null,
  caption text,
  sort_order int default 0,
  created_at timestamptz default now()
);
create index if not exists idx_gallery_images_album on public.gallery_images(album_id);
create index if not exists idx_gallery_images_sort on public.gallery_images(sort_order);
