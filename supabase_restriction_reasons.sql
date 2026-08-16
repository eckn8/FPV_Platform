-- =======================================================
-- 📋 supabase_restriction_reasons.sql — Restricted users list
-- Run once (SQL Editor → New query → paste → Run), after
-- supabase_user_restrictions.sql.
--
-- Adds a free-text reason snapshot to profiles, captured whenever a
-- moderator restricts/bans someone from moderation.html (the
-- reported content + the reasons picked on that report). Also adds
-- get_restricted_users(), a security-definer function moderation.js
-- calls instead of querying `profiles` directly.
--
-- Why a function instead of a plain select: `profiles` has a
-- longstanding "viewable by everyone" policy (usernames need to
-- stay public — they're shown all over the site). RLS is row-level,
-- not column-level, so that policy would also make
-- restriction_reason readable by anyone querying the REST API
-- directly, not just moderators via the UI. Revoking column-level
-- SELECT on restriction_reason and only exposing it through this
-- function (which re-checks is_moderator itself, and runs as
-- security definer to read the column despite the revoke) closes
-- that gap without touching the public username policy.
-- =======================================================

alter table public.profiles
  add column restriction_reason text;

revoke select (restriction_reason) on public.profiles from anon, authenticated;

create or replace function public.get_restricted_users()
returns table (
  id uuid,
  username text,
  is_banned boolean,
  restricted_until timestamptz,
  restriction_reason text
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.username, p.is_banned, p.restricted_until, p.restriction_reason
  from public.profiles p
  where (p.is_banned or (p.restricted_until is not null and p.restricted_until > now()))
    and exists (
      select 1 from public.profiles as moderator
      where moderator.id = auth.uid() and moderator.is_moderator
    )
  order by p.restricted_until nulls first;
$$;

grant execute on function public.get_restricted_users() to authenticated;
