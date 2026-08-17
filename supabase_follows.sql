-- =======================================================
-- 🧑‍🤝‍🧑 supabase_follows.sql — Follow other creators
-- Run once (SQL Editor → New query → paste → Run).
--
-- profiles.bio and profiles.avatar_url already exist (see
-- supabase_setup.sql) — this migration only adds the follow graph.
-- Publicly readable (follower counts show on every profile), but
-- only the follower themselves can create/remove their own row.
-- =======================================================

create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint follows_no_self check (follower_id <> followed_id)
);

alter table public.follows enable row level security;

create policy "Follows are viewable by everyone"
  on public.follows for select
  using (true);

create policy "Users can follow as themselves"
  on public.follows for insert
  with check (auth.uid() = follower_id);

create policy "Users can unfollow as themselves"
  on public.follows for delete
  using (auth.uid() = follower_id);
