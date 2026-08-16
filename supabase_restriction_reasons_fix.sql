-- =======================================================
-- 🩹 supabase_restriction_reasons_fix.sql — Fix column revoke
-- Run right after supabase_restriction_reasons.sql (SQL Editor →
-- New query → paste → Run).
--
-- The previous script's `revoke select (restriction_reason) on
-- public.profiles from anon, authenticated;` had no effect: anon/
-- authenticated already hold a table-wide SELECT grant from
-- Supabase's default setup, and a column-level REVOKE only removes
-- a column-level grant — it doesn't subtract from a table-wide one
-- that's still in effect. Confirmed live: `restriction_reason` was
-- still readable via a plain REST query after the "fix".
--
-- The correct approach: revoke SELECT on the whole table, then
-- re-grant it column-by-column for every column except
-- restriction_reason. Everything else keeps working exactly as
-- before (same columns effectively public either way) — only
-- restriction_reason becomes unreadable outside
-- get_restricted_users().
-- =======================================================

revoke select on public.profiles from anon, authenticated;

grant select (id, username, bio, avatar_url, created_at, is_moderator, is_banned, restricted_until)
  on public.profiles to anon, authenticated;
