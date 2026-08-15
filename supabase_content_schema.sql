-- =======================================================
-- 🗄 supabase_content_schema.sql — Content schema for FPVBase
--
-- Run ONCE in Supabase: Project → SQL Editor →
-- New query → paste this file → Run.
--
-- Completes supabase_setup.sql (which only handled identity — the
-- `profiles` table). This script adds everything else: models,
-- likes, favorites, comments, requests, reports, folders.
-- After this, none of this content needs localStorage anymore.
--
-- Deliberate choice: `versions`, `images` and `files` stay as
-- JSONB columns on `models` rather than separate normalized
-- tables. The JS code already treats these fields as arrays (see
-- getModelVersions()/addModelVersion() in data.js) — storing them
-- as-is avoids a massive rewrite for zero benefit at this scale
-- (no need to filter/query a specific version on the database side
-- for now).
-- =======================================================

-- =======================
-- 📁 CUSTOM FOLDERS
-- =======================

create table public.custom_folders (
  id uuid primary key default gen_random_uuid(),
  path text[] not null unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.custom_folders enable row level security;

create policy "Custom folders are viewable by everyone"
  on public.custom_folders for select
  using (true);

create policy "Authenticated users can create folders"
  on public.custom_folders for insert
  to authenticated
  with check (true);

-- =======================
-- 💡 COMMUNITY REQUESTS
-- =======================

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  path text[] not null,
  creator_id uuid not null references public.profiles(id),
  status text not null default 'open',
  -- No foreign key to models (created afterward) — consistency
  -- handled on the application side, same as resolvedByModelId
  -- already was locally.
  resolved_by_model_id uuid,
  created_at timestamptz not null default now()
);

alter table public.requests enable row level security;

create policy "Requests are viewable by everyone"
  on public.requests for select
  using (true);

create policy "Authenticated users can create requests"
  on public.requests for insert
  to authenticated
  with check (auth.uid() = creator_id);

-- Allowed for any logged-in user (not just the creator): publishing
-- a model that answers someone else's request must be able to
-- close it — same rule as locally until now.
create policy "Authenticated users can update request status"
  on public.requests for update
  to authenticated
  using (true);

create table public.request_votes (
  request_id uuid not null references public.requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

alter table public.request_votes enable row level security;

create policy "Request votes are viewable by everyone"
  on public.request_votes for select
  using (true);

create policy "Users can vote as themselves"
  on public.request_votes for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can remove their own vote"
  on public.request_votes for delete
  to authenticated
  using (auth.uid() = user_id);

-- =======================
-- 📦 MODELS
-- =======================

create table public.models (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  description text not null,
  path text[] not null,
  tags text[] not null default '{}',

  tested text,
  print_notes text,

  creator_id uuid not null references public.profiles(id),
  -- Deliberately denormalized: avoids a join just to display
  -- "published by X" everywhere a model is listed.
  creator_username text not null,

  request_id uuid references public.requests(id),

  archived boolean not null default false,
  -- Soft delete (see project doc §35): never a physical deletion
  -- triggerable from the API.
  deleted_at timestamptz,

  images jsonb not null default '[]',
  image text,

  files jsonb not null default '[]',
  file_name text,

  versions jsonb not null default '[]',
  current_version text not null default '1.0',

  created_at timestamptz not null default now()
);

alter table public.models enable row level security;

create policy "Models are viewable by everyone"
  on public.models for select
  using (deleted_at is null);

create policy "Authenticated users can create their own models"
  on public.models for insert
  to authenticated
  with check (auth.uid() = creator_id);

create policy "Creators can update their own models"
  on public.models for update
  to authenticated
  using (auth.uid() = creator_id);

-- =======================
-- 👍 MODEL LIKES
-- =======================

create table public.model_likes (
  model_id uuid not null references public.models(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (model_id, user_id)
);

alter table public.model_likes enable row level security;

create policy "Model likes are viewable by everyone"
  on public.model_likes for select
  using (true);

create policy "Users can like as themselves"
  on public.model_likes for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can remove their own like"
  on public.model_likes for delete
  to authenticated
  using (auth.uid() = user_id);

-- =======================
-- ❤️ FAVORITES
-- Unlike likes, no benefit to being public — only the person
-- concerned should see their own favorites.
-- =======================

create table public.favorites (
  model_id uuid not null references public.models(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (model_id, user_id)
);

alter table public.favorites enable row level security;

create policy "Users can view their own favorites"
  on public.favorites for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can save favorites as themselves"
  on public.favorites for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can remove their own favorite"
  on public.favorites for delete
  to authenticated
  using (auth.uid() = user_id);

-- =======================
-- 💬 COMMENTS
-- =======================

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.models(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  -- Denormalized, same reason as creator_username on models.
  username text not null,
  text text not null,
  created_at timestamptz not null default now()
);

alter table public.comments enable row level security;

create policy "Comments are viewable by everyone"
  on public.comments for select
  using (true);

create policy "Authenticated users can comment as themselves"
  on public.comments for insert
  to authenticated
  with check (auth.uid() = user_id);

create table public.comment_likes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comment_likes enable row level security;

create policy "Comment likes are viewable by everyone"
  on public.comment_likes for select
  using (true);

create policy "Users can like comments as themselves"
  on public.comment_likes for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can remove their own comment like"
  on public.comment_likes for delete
  to authenticated
  using (auth.uid() = user_id);

-- =======================
-- 🚩 REPORTS
-- Unlike likes/comments, NOT public: only the person who reported
-- sees their own report for now (no moderator role yet — see
-- project doc, moderation section).
-- =======================

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('model', 'comment')),
  target_id uuid not null,
  model_id uuid references public.models(id),
  reporter_id uuid not null references public.profiles(id),
  reasons text[] not null,
  details text,
  created_at timestamptz not null default now(),
  unique (target_type, target_id, reporter_id)
);

alter table public.reports enable row level security;

create policy "Users can view their own reports"
  on public.reports for select
  to authenticated
  using (auth.uid() = reporter_id);

create policy "Users can report as themselves"
  on public.reports for insert
  to authenticated
  with check (auth.uid() = reporter_id);

create policy "Users can withdraw their own report"
  on public.reports for delete
  to authenticated
  using (auth.uid() = reporter_id);
