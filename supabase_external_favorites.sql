-- =======================================================
-- 🔗 supabase_external_favorites.sql — Saving Cults3D discovery cards
-- Run once (SQL Editor → New query → paste → Run), after
-- supabase_content_schema.sql.
--
-- A Cults3D pick (see worker.js /api/external-models) has no row in
-- `models`, so it can't use the model_id foreign key `favorites`
-- relies on. This is its own small table, keyed by (user_id,
-- external_id), storing just enough (title/image/url/creator/
-- downloads) to render the card again later without re-fetching
-- Cults3D — see getSavedExternalModels() in data.js.
--
-- Private, unlike `favorites`: no public "N saves" counter here —
-- Cults3D's own like/download counts already do that job on the
-- card, no need to duplicate it.
-- =======================================================

create table public.external_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  external_id text not null,
  source text not null default 'cults3d',
  title text not null,
  image text,
  url text not null,
  creator text,
  downloads integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, external_id)
);

alter table public.external_favorites enable row level security;

create policy "Users can view their own external favorites"
  on public.external_favorites for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can save external favorites as themselves"
  on public.external_favorites for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can remove their own external favorite"
  on public.external_favorites for delete
  to authenticated
  using (auth.uid() = user_id);
