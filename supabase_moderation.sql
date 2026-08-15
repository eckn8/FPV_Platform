-- =======================================================
-- 🛡 supabase_moderation.sql — Report moderation
-- Run once (SQL Editor → New query → paste → Run).
--
-- Introduces a minimal moderator role: a boolean flag on
-- `profiles` (no separate roles table needed at this scale — a
-- single flag is enough until the team of moderators grows).
--
-- Reports already exist (see supabase_content_schema.sql) but
-- until now only the reporter themselves could see their own
-- report — no one could see the full list or act on it. This adds:
--   - moderators can view every report, not just their own
--   - moderators can dismiss any report (no violation found)
--   - moderators can remove a reported model (soft delete, same
--     mechanism as the `deleted_at` column already used elsewhere
--     — never a hard delete)
--   - moderators can delete a reported comment (hard delete, same
--     as a user deleting their own comment already works)
-- =======================================================

alter table public.profiles
  add column is_moderator boolean not null default false;

-- ---- Reports: moderators can see and dismiss everything --------
create policy "Moderators can view all reports"
  on public.reports for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_moderator
    )
  );

create policy "Moderators can dismiss any report"
  on public.reports for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_moderator
    )
  );

-- ---- Models: moderators can remove any model (soft delete) -----
-- Additive to "Creators can update their own models" — RLS
-- policies are OR'd together, so this doesn't loosen anything for
-- non-moderators.
create policy "Moderators can update any model"
  on public.models for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_moderator
    )
  );

-- ---- Comments: moderators can delete any comment ----------------
create policy "Moderators can delete any comment"
  on public.comments for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_moderator
    )
  );

-- ---- Make the project owner the first moderator -----------------
update public.profiles
set is_moderator = true
where id = '126ca2b4-63b8-4716-a063-7f3dfa3a806c'; -- Elliot_CKN
