-- =======================================================
-- 🩹 supabase_content_schema_fix.sql — Small fix
-- Run right after supabase_content_schema.sql (SQL Editor
-- → New query → paste → Run).
--
-- Adds the denormalized username to `requests` (missed in the
-- initial script — models and comments already had it) to display
-- "Requested by: X" without a join, and properly links
-- resolved_by_model_id to models now that the table exists.
-- =======================================================

alter table public.requests
  add column creator_username text not null default '';

alter table public.requests
  add constraint requests_resolved_by_model_id_fkey
  foreign key (resolved_by_model_id) references public.models(id);
