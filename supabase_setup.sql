-- =======================================================
-- 🗄 supabase_setup.sql — Schéma auth pour FPV Print Hub
--
-- À exécuter UNE FOIS dans Supabase : Project → SQL Editor →
-- New query → coller ce fichier → Run.
--
-- Ce script ne crée QUE la partie "identité utilisateur"
-- (profils publics liés aux comptes Supabase Auth). Les
-- modèles/likes/favoris restent en localStorage pour l'instant
-- (prochaine étape du projet, une fois l'identité sécurisée).
-- =======================================================

-- ---- Table des profils publics --------------------------
-- Un profil par utilisateur inscrit. `id` est le même uuid que
-- celui de auth.users : c'est CET id (jamais le pseudo) qui doit
-- servir de référence de propriété/permission dans tout le reste
-- de l'app.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  bio text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Les pseudos/profils sont publics en lecture (comme sur toute
-- plateforme communautaire : on doit pouvoir voir qui a publié quoi).
create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

-- Un utilisateur ne peut créer que SON PROPRE profil.
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Un utilisateur ne peut modifier que SON PROPRE profil.
-- C'est la BDD elle-même qui l'impose (pas juste le frontend).
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- ---- Création automatique du profil à l'inscription -----
-- Le pseudo choisi à l'inscription est passé en "user metadata"
-- lors du signUp() côté client ; ce trigger le recopie dans la
-- table publique dès que le compte auth.users est créé.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
