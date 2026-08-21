-- =======================================================
-- 🔤 supabase_banned_words_extend.sql — Cover usernames, bios, requests
-- Run once (SQL Editor → New query → paste → Run), after
-- supabase_banned_words.sql.
--
-- The original filter only ever covered models (title/description/
-- print_notes/tags) and comments — usernames, profile bios, and
-- community requests (title/description) went through unchecked.
-- Reuses the exact same check_banned_words()/contains_banned_words()
-- machinery (create or replace — the two existing triggers on
-- models/comments reference this function by name and pick up the
-- new logic automatically, no need to touch them).
--
-- profiles: checked on INSERT (this is what actually runs at
-- signup — handle_new_user() inserts the row, and a BEFORE INSERT
-- trigger still fires no matter what caused the insert) AND on
-- UPDATE (no username-editing UI exists today, but the RLS policy
-- itself doesn't stop a raw API call from changing it; bio IS
-- editable from profile.html, so this matters there regardless).
-- Only re-checks on UPDATE if username or bio actually changed,
-- same reasoning as the existing models re-check skip.
--
-- requests: INSERT only — there's no text-editing path for an
-- existing request (resolveRequest() only ever touches status/
-- resolved_by_model_id).
-- =======================================================

create or replace function public.check_banned_words()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  combined_text text;
begin
  if tg_table_name = 'models' then
    if tg_op = 'UPDATE'
       and new.title is not distinct from old.title
       and new.description is not distinct from old.description
       and new.print_notes is not distinct from old.print_notes
       and new.tags is not distinct from old.tags then
      return new;
    end if;

    combined_text := coalesce(new.title, '') || ' ' || coalesce(new.description, '') || ' ' ||
                      coalesce(new.print_notes, '') || ' ' || coalesce(array_to_string(new.tags, ' '), '');
  elsif tg_table_name = 'comments' then
    combined_text := coalesce(new.text, '');
  elsif tg_table_name = 'profiles' then
    if tg_op = 'UPDATE'
       and new.username is not distinct from old.username
       and new.bio is not distinct from old.bio then
      return new;
    end if;

    combined_text := coalesce(new.username, '') || ' ' || coalesce(new.bio, '');
  elsif tg_table_name = 'requests' then
    combined_text := coalesce(new.title, '') || ' ' || coalesce(new.description, '');
  else
    combined_text := '';
  end if;

  if public.contains_banned_words(combined_text) then
    raise exception 'Your text contains a word that is not allowed on FPVBase. Please edit it and try again.';
  end if;

  return new;
end;
$$;

create trigger profiles_banned_words_check
  before insert or update on public.profiles
  for each row execute function public.check_banned_words();

create trigger requests_banned_words_check
  before insert on public.requests
  for each row execute function public.check_banned_words();
