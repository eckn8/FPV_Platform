-- =======================================================
-- ❤️ supabase_merge_like_into_save.sql — Like merges into Save
-- Run once (SQL Editor → New query → paste → Run), after
-- supabase_content_schema.sql / _fix.sql.
--
-- The separate "like" button is gone: saving a model (favorites)
-- is now the only signal, and it's public — it powers "Most
-- popular" and the search ranking bonus, the same job likes used
-- to do. Checked against production first: only 1 row existed in
-- model_likes across 3 published models, nothing meaningful to
-- carry over.
-- =======================================================

-- ---- 1. Make favorites publicly readable ---------------------
-- Was "only the owner can see their own favorites" — now anyone
-- can read the table, so a save COUNT per model is public, same as
-- model_likes was. Writing (insert/delete) still only as yourself,
-- unchanged.
drop policy "Users can view their own favorites" on public.favorites;

create policy "Favorites are viewable by everyone"
  on public.favorites for select
  using (true);

-- ---- 2. Drop the now-unused model_likes table -----------------
drop table public.model_likes;
