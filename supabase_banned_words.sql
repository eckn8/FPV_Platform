-- =======================================================
-- 🔤 supabase_banned_words.sql — Server-side word filter
-- Run once (SQL Editor → New query → paste → Run).
--
-- Blocks publishing a model or posting a comment whose title/
-- description/print notes/tags/text contains a word from a
-- moderator-managed list — enforced by a trigger (not RLS this
-- time, see below), so it can never be bypassed by calling the
-- Supabase API directly, only client-side UI.
--
-- Deliberately a whole-word match, not a substring search: text is
-- tokenized into words (split on anything that isn't a letter/
-- digit) and each token is compared for exact equality against the
-- list. A substring search would flag innocent words that merely
-- contain a banned one (ban "ass", also block "class"/"assembly").
--
-- Known limitations (inherent to any word-list approach, not fixed
-- here): multi-word phrases aren't matched (only single words),
-- and creative spelling ("a$$", "a-s-s") isn't caught. A real AI
-- moderation API (OpenAI Moderation, Perspective API) would catch
-- both, at the cost of a paid/rate-limited external call — left for
-- later if this list-based layer isn't enough on its own.
--
-- Why a trigger instead of embedding this in the existing RLS
-- policies (like is_user_restricted()): a trigger can raise a
-- clear, specific error message ("contains a word that isn't
-- allowed"). An RLS rejection only ever surfaces as a generic "new
-- row violates row-level security policy" — much less helpful here,
-- since (unlike a restriction) there's no client-side pre-check
-- possible: the word list itself is moderator-only readable, so the
-- browser can't know in advance what will get rejected.
--
-- FPV/drone vocabulary genuinely overlaps with words a generic
-- banned-word list might reasonably include for other reasons —
-- "kill switch" and "dead cat" (a foam windscreen, not the animal)
-- are completely normal here even if "kill"/"dead" ever end up
-- banned for, say, harassment ("I will kill you"). allowed_phrases
-- takes priority: any phrase on it is stripped out of the text
-- BEFORE the banned-word check runs, so a banned single word inside
-- an allowed phrase never gets a chance to match. Seeded with the
-- two examples above — add more FPV-specific terms as they come up
-- ("crash", "burn", "smoke"... anything that reads as violent/
-- alarming out of context but is everyday hobby talk here).
-- =======================================================

-- ---- The lists, moderator-managed -----------------------
create table public.banned_words (
  id uuid primary key default gen_random_uuid(),
  word text not null unique,
  created_at timestamptz not null default now()
);

create table public.allowed_phrases (
  id uuid primary key default gen_random_uuid(),
  phrase text not null unique,
  created_at timestamptz not null default now()
);

insert into public.allowed_phrases (phrase) values
  ('dead cat'),
  ('deadcat'),
  ('kill switch');

alter table public.banned_words enable row level security;
alter table public.allowed_phrases enable row level security;

create policy "Moderators can manage banned words"
  on public.banned_words for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_moderator
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_moderator
    )
  );

create policy "Moderators can manage allowed phrases"
  on public.allowed_phrases for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_moderator
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_moderator
    )
  );

-- ---- The check itself -------------------------------------------
-- security definer: runs with elevated read access to both lists
-- regardless of the calling (non-moderator) user's own row-level
-- access to them — the lists stay hidden from regular users while
-- still being enforceable against them.
create or replace function public.contains_banned_words(input_text text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  cleaned text;
  words text[];
  banned record;
  allowed record;
begin
  if input_text is null or input_text = '' then
    return false;
  end if;

  cleaned := lower(input_text);

  -- Literal substring replace (not regexp_replace) — moderator-
  -- entered phrases may contain characters that would otherwise
  -- need escaping in a regex.
  for allowed in select phrase from public.allowed_phrases loop
    cleaned := replace(cleaned, lower(allowed.phrase), ' ');
  end loop;

  words := regexp_split_to_array(cleaned, '[^a-z0-9]+');

  for banned in select word from public.banned_words loop
    if lower(banned.word) = any(words) then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

-- ---- The trigger --------------------------------------------------
-- Shared by both tables (branches on tg_table_name). For an UPDATE
-- on models, only re-checks when the actual text content changed —
-- an unrelated update (archiving, soft-delete by a moderator, add-
-- version touching only files/versions) must never get blocked by
-- a word that was already there before this trigger existed, or
-- added to the list since.
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
  else
    combined_text := '';
  end if;

  if public.contains_banned_words(combined_text) then
    raise exception 'Your text contains a word that is not allowed on FPVBase. Please edit it and try again.';
  end if;

  return new;
end;
$$;

create trigger models_banned_words_check
  before insert or update on public.models
  for each row execute function public.check_banned_words();

create trigger comments_banned_words_check
  before insert on public.comments
  for each row execute function public.check_banned_words();
