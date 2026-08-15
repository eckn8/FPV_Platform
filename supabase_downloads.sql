-- =======================================================
-- 📥 supabase_downloads.sql — Unique download tracking
-- Run once (SQL Editor → New query → paste → Run).
--
-- Downloading a model file never required an account (see the
-- access rules: browsing/downloading are open to everyone), so
-- downloads can't always be deduped by a real user id the way
-- likes/favorites are. `downloader_key` is either "user:<uuid>" for
-- a logged-in visitor, or "anon:<uuid>" for an id generated
-- client-side and persisted in localStorage (see recordDownload()
-- in data.js) for an anonymous one. The primary key on
-- (model_id, downloader_key) is what actually guarantees "the same
-- person downloading the same model twice doesn't count twice" —
-- not application logic, which could be bypassed.
-- =======================================================

create table public.model_downloads (
  model_id uuid not null references public.models(id) on delete cascade,
  downloader_key text not null,
  created_at timestamptz not null default now(),
  primary key (model_id, downloader_key)
);

alter table public.model_downloads enable row level security;

-- Anyone can log a download, logged in or not — same rule as
-- actually downloading a file.
create policy "Anyone can log a download"
  on public.model_downloads for insert
  with check (true);

-- Needed to compute the homepage stats (total download count).
create policy "Download counts are viewable by everyone"
  on public.model_downloads for select
  using (true);
