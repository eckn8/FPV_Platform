-- =======================================================
-- 💬 supabase_external_comments.sql — Comments on Cults3D pages
-- Run once (SQL Editor → New query → paste → Run), after
-- supabase_user_restrictions.sql (reuses is_user_restricted()).
--
-- A parallel, deliberately simpler table to public.comments: a
-- Cults3D detail page (model.js, "cults-" ids) has no row in
-- `models` to hang a comment off of, so this is its own table,
-- keyed by external_id instead of model_id. No comment_likes/
-- reports for these — both of those are foreign-keyed to
-- comments(id), which an external comment never has a row in — just
-- post, read, and delete your own, with the same ban/restriction
-- rule as native comments.
-- =======================================================

create table public.external_comments (
  id uuid primary key default gen_random_uuid(),
  external_id text not null,
  source text not null default 'cults3d',
  user_id uuid references public.profiles(id) on delete set null,
  -- Denormalized, same reason as username on public.comments.
  username text not null,
  text text not null,
  created_at timestamptz not null default now()
);

alter table public.external_comments enable row level security;

create policy "External comments are viewable by everyone"
  on public.external_comments for select
  using (true);

create policy "Authenticated users can comment on external models as themselves"
  on public.external_comments for insert
  to authenticated
  with check (auth.uid() = user_id and not public.is_user_restricted(auth.uid()));

create policy "Users can delete their own external comments"
  on public.external_comments for delete
  to authenticated
  using (auth.uid() = user_id);
