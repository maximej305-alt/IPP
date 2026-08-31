-- 202608290001_profiles.sql — Phase 5.4 / 5.8
-- Table profiles liée à auth.users + trigger
-- Ne stocke jamais de mot de passe

-- 1. Table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('super_admin','admin','editor')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_profiles_role on public.profiles(role);

-- 2. updated_at trigger
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
for each row execute function public.handle_updated_at();

-- 3. Fonction helper has_role (évite duplication RLS)
create or replace function public.has_role(required_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and (
      role = required_role
      or (required_role = 'admin' and role = 'super_admin')
      or (required_role = 'editor' and role in ('admin','super_admin'))
    )
  );
$$;

-- 4. Trigger création profil — OPTION B CHOISIE (Phase 10) : profil créé MANUELLEMENT par super_admin
-- Le trigger reste DÉSACTIVÉ pour éviter inscription publique. Fonction conservée pour référence.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'Nouvel utilisateur'), 'editor');
  return new;
end; $$;
-- Ne pas activer automatiquement pour éviter inscription publique — à activer manuellement si besoin
-- drop trigger if exists on_auth_user_created on auth.users;
-- create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

comment on table public.profiles is 'Profils applicatifs — RLS réelle, has_role() centralisé. Premier super_admin à créer manuellement via dashboard.';
