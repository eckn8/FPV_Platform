-- =======================================================
-- 🔤 supabase_username_case_insensitive.sql — Case-insensitive usernames
-- Run once (SQL Editor → New query → paste → Run).
--
-- profiles.username already has a plain `unique` constraint (see
-- supabase_setup.sql), which only blocks an EXACT duplicate —
-- "EliotFPV" and "eliotfpv" could still both exist as separate
-- accounts, which reads as impersonation/confusion on a public
-- platform. Checked production first: only one profile exists
-- today ("Elliot_CKN"), so there's nothing that would collide.
--
-- The plain unique constraint is left in place (harmless, and this
-- index is strictly stronger). auth.js's error translation already
-- matches on the substring "profiles_username" to show "This
-- username is already taken." — this index's name
-- ("profiles_username_lower_key") still contains that substring, so
-- no JS change is needed.
-- =======================================================

create unique index profiles_username_lower_key
  on public.profiles (lower(username));
