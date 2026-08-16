-- =======================================================
-- 🗑 supabase_account_deletion.sql — Self-service account deletion
-- Run once (SQL Editor → New query → paste → Run).
--
-- Enables a real "Delete my account" feature (see worker.js's
-- /api/delete-account) that genuinely removes the Supabase Auth
-- user — unlike restrictions/bans, this needs the project's secret
-- key (what Supabase used to call "service_role"). That key is
-- stored only as a Cloudflare Worker secret, never in wrangler.toml,
-- never exposed to the browser, used only from worker.js after
-- verifying the caller's own identity, and only ever able to delete
-- the CALLER's own account — never someone else's.
--
-- Before the auth user (and its profiles row, which cascades) can
-- be deleted, anything with a NOT NULL foreign key to profiles
-- would block the deletion outright. These columns become nullable
-- so a user's models/comments/requests/reports can be anonymized
-- (kept, attributed to nobody) instead of forcing a full content
-- wipe. "on delete set null" is a defensive default at the database
-- level in case a profile is ever removed through some other path —
-- the deletion endpoint still explicitly sets creator_username/
-- username to "Deleted user" itself, since that's a plain text
-- column a foreign key constraint can't update on its own.
-- =======================================================

alter table public.models
  alter column creator_id drop not null;

alter table public.models
  drop constraint models_creator_id_fkey,
  add constraint models_creator_id_fkey
    foreign key (creator_id) references public.profiles(id) on delete set null;

alter table public.comments
  alter column user_id drop not null;

alter table public.comments
  drop constraint comments_user_id_fkey,
  add constraint comments_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete set null;

alter table public.requests
  alter column creator_id drop not null;

alter table public.requests
  drop constraint requests_creator_id_fkey,
  add constraint requests_creator_id_fkey
    foreign key (creator_id) references public.profiles(id) on delete set null;

alter table public.reports
  alter column reporter_id drop not null;

alter table public.reports
  drop constraint reports_reporter_id_fkey,
  add constraint reports_reporter_id_fkey
    foreign key (reporter_id) references public.profiles(id) on delete set null;

-- A model that resolved someone's request must not block that
-- model's deletion (the "delete everything" choice).
alter table public.requests
  drop constraint requests_resolved_by_model_id_fkey,
  add constraint requests_resolved_by_model_id_fkey
    foreign key (resolved_by_model_id) references public.models(id) on delete set null;
