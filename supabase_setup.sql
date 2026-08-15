-- =======================================================
-- 🗄 supabase_setup.sql — Auth schema for FPV Print Hub
--
-- Run ONCE in Supabase: Project → SQL Editor →
-- New query → paste this file → Run.
--
-- This script only creates the "user identity" part (public
-- profiles linked to Supabase Auth accounts). Models/likes/
-- favorites stay in localStorage for now (next step of the
-- project, once identity is secured).
-- =======================================================

-- ---- Public profiles table --------------------------
-- One profile per registered user. `id` is the same uuid as
-- auth.users' — it's THIS id (never the username) that must be
-- used as the ownership/permission reference throughout the rest
-- of the app.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  bio text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Usernames/profiles are publicly readable (like on any
-- community platform: people need to see who published what).
create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

-- A user can only create THEIR OWN profile.
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- A user can only update THEIR OWN profile.
-- This is enforced by the database itself (not just the frontend).
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- ---- Automatic profile creation on sign-up -----
-- The username chosen at sign-up is passed as "user metadata"
-- during the client-side signUp() call; this trigger copies it
-- into the public table as soon as the auth.users account is created.
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
