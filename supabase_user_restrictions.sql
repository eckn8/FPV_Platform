-- =======================================================
-- 🚫 supabase_user_restrictions.sql — Publish/comment restrictions
-- Run once (SQL Editor → New query → paste → Run), after
-- supabase_moderation.sql.
--
-- Adds a lightweight moderation lever short of a real account ban
-- (which would need the service_role key — deliberately never used
-- or stored anywhere in this project, see supabaseClient.js). A
-- restricted/banned account can still log in and browse — only
-- publishing a new model and posting a comment are blocked,
-- enforced by RLS (not just client-side UI) via
-- is_user_restricted().
--
-- is_banned = permanent, lifted manually by a moderator.
-- restricted_until = temporary, expires on its own — nothing needs
-- to run to lift it, the check just stops matching once it's past.
-- =======================================================

alter table public.profiles
  add column is_banned boolean not null default false,
  add column restricted_until timestamptz;

create or replace function public.is_user_restricted(check_user_id uuid)
returns boolean
language sql
stable
as $$
  select coalesce(
    (
      select is_banned or (restricted_until is not null and restricted_until > now())
      from public.profiles
      where id = check_user_id
    ),
    false
  );
$$;

-- ---- Models: block publishing a new model while restricted ------
drop policy "Authenticated users can create their own models" on public.models;

create policy "Authenticated users can create their own models"
  on public.models for insert
  to authenticated
  with check (auth.uid() = creator_id and not public.is_user_restricted(auth.uid()));

-- ---- Comments: block posting a comment while restricted ---------
drop policy "Authenticated users can comment as themselves" on public.comments;

create policy "Authenticated users can comment as themselves"
  on public.comments for insert
  to authenticated
  with check (auth.uid() = user_id and not public.is_user_restricted(auth.uid()));

-- ---- Moderators can set restriction fields on any profile --------
-- Note: RLS is row-level, not column-level — this technically lets
-- a moderator update any column on any profile, not just
-- is_banned/restricted_until. Acceptable at this project's scale
-- (a single trusted moderator, already able to remove any model or
-- comment); revisit with column-level grants if the moderator team
-- grows.
create policy "Moderators can update restriction fields on any profile"
  on public.profiles for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles as moderator
      where moderator.id = auth.uid() and moderator.is_moderator
    )
  );
