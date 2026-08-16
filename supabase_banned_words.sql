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
-- Deliberately a whole-word/whole-phrase match, not a plain
-- substring search: text is normalized (lowercased, everything that
-- isn't a letter/digit collapsed to single spaces) and padded with
-- a leading/trailing space, so a literal substring search for
-- " <entry> " enforces boundaries at both ends — an entry can be a
-- single word ("ass") or a multi-word phrase ("kill switch"),
-- matched the same way. A plain substring search without padding
-- would flag innocent words that merely contain a banned one (ban
-- "ass", also block "class"/"assembly").
--
-- Known limitation (inherent to any word-list approach, not fixed
-- here): creative spelling ("a$$", "a-s-s") isn't caught — those
-- get normalized away entirely rather than matched, since only
-- letters/digits survive normalization. A real AI moderation API
-- (OpenAI Moderation, Perspective API) would catch that, at the
-- cost of a paid/rate-limited external call — left for later if
-- this list-based layer isn't enough on its own.
--
-- Seeded with the English + French lists from LDNOOBW (List of
-- Dirty, Naughty, Obscene, and Otherwise Bad Words — open source,
-- github.com/LDNOOBW), minus 3 French entries ("péter", "gerbe",
-- "folle") excluded up front: all three are common non-vulgar
-- technical/everyday French words too ("le moteur a pété" = the
-- motor blew, "une gerbe d'étincelles" = a shower of sparks, "une
-- idée folle" = a crazy idea) — the false-positive risk outweighed
-- their (fairly minor) value as vulgar words on this list.
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

-- LDNOOBW English + French lists (see the header comment above for
-- the 3 French exclusions and the rationale). One emoji-only entry
-- ("🖕") from the source list is skipped here — it has no letters/
-- digits, so normalize_for_word_match() would reduce it to nothing
-- and it could never actually match any real text anyway.
insert into public.banned_words (word) values
  ('2g1c'),
  ('2 girls 1 cup'),
  ('acrotomophilia'),
  ('alabama hot pocket'),
  ('alaskan pipeline'),
  ('anal'),
  ('anilingus'),
  ('anus'),
  ('apeshit'),
  ('arsehole'),
  ('ass'),
  ('asshole'),
  ('assmunch'),
  ('auto erotic'),
  ('autoerotic'),
  ('babeland'),
  ('baby batter'),
  ('baby juice'),
  ('ball gag'),
  ('ball gravy'),
  ('ball kicking'),
  ('ball licking'),
  ('ball sack'),
  ('ball sucking'),
  ('bangbros'),
  ('bangbus'),
  ('bareback'),
  ('barely legal'),
  ('barenaked'),
  ('bastard'),
  ('bastardo'),
  ('bastinado'),
  ('bbw'),
  ('bdsm'),
  ('beaner'),
  ('beaners'),
  ('beaver cleaver'),
  ('beaver lips'),
  ('beastiality'),
  ('bestiality'),
  ('big black'),
  ('big breasts'),
  ('big knockers'),
  ('big tits'),
  ('bimbos'),
  ('birdlock'),
  ('bitch'),
  ('bitches'),
  ('black cock'),
  ('blonde action'),
  ('blonde on blonde action'),
  ('blowjob'),
  ('blow job'),
  ('blow your load'),
  ('blue waffle'),
  ('blumpkin'),
  ('bollocks'),
  ('bondage'),
  ('boner'),
  ('boob'),
  ('boobs'),
  ('booty call'),
  ('brown showers'),
  ('brunette action'),
  ('bukkake'),
  ('bulldyke'),
  ('bullet vibe'),
  ('bullshit'),
  ('bung hole'),
  ('bunghole'),
  ('busty'),
  ('butt'),
  ('buttcheeks'),
  ('butthole'),
  ('camel toe'),
  ('camgirl'),
  ('camslut'),
  ('camwhore'),
  ('carpet muncher'),
  ('carpetmuncher'),
  ('chocolate rosebuds'),
  ('cialis'),
  ('circlejerk'),
  ('cleveland steamer'),
  ('clit'),
  ('clitoris'),
  ('clover clamps'),
  ('clusterfuck'),
  ('cock'),
  ('cocks'),
  ('coprolagnia'),
  ('coprophilia'),
  ('cornhole'),
  ('coon'),
  ('coons'),
  ('creampie'),
  ('cum'),
  ('cumming'),
  ('cumshot'),
  ('cumshots'),
  ('cunnilingus'),
  ('cunt'),
  ('darkie'),
  ('date rape'),
  ('daterape'),
  ('deep throat'),
  ('deepthroat'),
  ('dendrophilia'),
  ('dick'),
  ('dildo'),
  ('dingleberry'),
  ('dingleberries'),
  ('dirty pillows'),
  ('dirty sanchez'),
  ('doggie style'),
  ('doggiestyle'),
  ('doggy style'),
  ('doggystyle'),
  ('dog style'),
  ('dolcett'),
  ('domination'),
  ('dominatrix'),
  ('dommes'),
  ('donkey punch'),
  ('double dong'),
  ('double penetration'),
  ('dp action'),
  ('dry hump'),
  ('dvda'),
  ('eat my ass'),
  ('ecchi'),
  ('ejaculation'),
  ('erotic'),
  ('erotism'),
  ('escort'),
  ('eunuch'),
  ('fag'),
  ('faggot'),
  ('fecal'),
  ('felch'),
  ('fellatio'),
  ('feltch'),
  ('female squirting'),
  ('femdom'),
  ('figging'),
  ('fingerbang'),
  ('fingering'),
  ('fisting'),
  ('foot fetish'),
  ('footjob'),
  ('frotting'),
  ('fuck'),
  ('fuck buttons'),
  ('fuckin'),
  ('fucking'),
  ('fucktards'),
  ('fudge packer'),
  ('fudgepacker'),
  ('futanari'),
  ('gangbang'),
  ('gang bang'),
  ('gay sex'),
  ('genitals'),
  ('giant cock'),
  ('girl on'),
  ('girl on top'),
  ('girls gone wild'),
  ('goatcx'),
  ('goatse'),
  ('god damn'),
  ('gokkun'),
  ('golden shower'),
  ('goodpoop'),
  ('goo girl'),
  ('goregasm'),
  ('grope'),
  ('group sex'),
  ('g-spot'),
  ('guro'),
  ('hand job'),
  ('handjob'),
  ('hard core'),
  ('hardcore'),
  ('hentai'),
  ('homoerotic'),
  ('honkey'),
  ('hooker'),
  ('horny'),
  ('hot carl'),
  ('hot chick'),
  ('how to kill'),
  ('how to murder'),
  ('huge fat'),
  ('humping'),
  ('incest'),
  ('intercourse'),
  ('jack off'),
  ('jail bait'),
  ('jailbait'),
  ('jelly donut'),
  ('jerk off'),
  ('jigaboo'),
  ('jiggaboo'),
  ('jiggerboo'),
  ('jizz'),
  ('juggs'),
  ('kike'),
  ('kinbaku'),
  ('kinkster'),
  ('kinky'),
  ('knobbing'),
  ('leather restraint'),
  ('leather straight jacket'),
  ('lemon party'),
  ('livesex'),
  ('lolita'),
  ('lovemaking'),
  ('make me come'),
  ('male squirting'),
  ('masturbate'),
  ('masturbating'),
  ('masturbation'),
  ('menage a trois'),
  ('milf'),
  ('missionary position'),
  ('mong'),
  ('motherfucker'),
  ('mound of venus'),
  ('mr hands'),
  ('muff diver'),
  ('muffdiving'),
  ('nambla'),
  ('nawashi'),
  ('negro'),
  ('neonazi'),
  ('nigga'),
  ('nigger'),
  ('nig nog'),
  ('nimphomania'),
  ('nipple'),
  ('nipples'),
  ('nsfw'),
  ('nsfw images'),
  ('nude'),
  ('nudity'),
  ('nutten'),
  ('nympho'),
  ('nymphomania'),
  ('octopussy'),
  ('omorashi'),
  ('one cup two girls'),
  ('one guy one jar'),
  ('orgasm'),
  ('orgy'),
  ('paedophile'),
  ('paki'),
  ('panties'),
  ('panty'),
  ('pedobear'),
  ('pedophile'),
  ('pegging'),
  ('penis'),
  ('phone sex'),
  ('piece of shit'),
  ('pikey'),
  ('pissing'),
  ('piss pig'),
  ('pisspig'),
  ('playboy'),
  ('pleasure chest'),
  ('pole smoker'),
  ('ponyplay'),
  ('poof'),
  ('poon'),
  ('poontang'),
  ('punany'),
  ('poop chute'),
  ('poopchute'),
  ('porn'),
  ('porno'),
  ('pornography'),
  ('prince albert piercing'),
  ('pthc'),
  ('pubes'),
  ('pussy'),
  ('queaf'),
  ('queef'),
  ('quim'),
  ('raghead'),
  ('raging boner'),
  ('rape'),
  ('raping'),
  ('rapist'),
  ('rectum'),
  ('reverse cowgirl'),
  ('rimjob'),
  ('rimming'),
  ('rosy palm'),
  ('rosy palm and her 5 sisters'),
  ('rusty trombone'),
  ('sadism'),
  ('santorum'),
  ('scat'),
  ('schlong'),
  ('scissoring'),
  ('semen'),
  ('sex'),
  ('sexcam'),
  ('sexo'),
  ('sexy'),
  ('sexual'),
  ('sexually'),
  ('sexuality'),
  ('shaved beaver'),
  ('shaved pussy'),
  ('shemale'),
  ('shibari'),
  ('shit'),
  ('shitblimp'),
  ('shitty'),
  ('shota'),
  ('shrimping'),
  ('skeet'),
  ('slanteye'),
  ('slut'),
  ('s&m'),
  ('smut'),
  ('snatch'),
  ('snowballing'),
  ('sodomize'),
  ('sodomy'),
  ('spastic'),
  ('spic'),
  ('splooge'),
  ('splooge moose'),
  ('spooge'),
  ('spread legs'),
  ('spunk'),
  ('strap on'),
  ('strapon'),
  ('strappado'),
  ('strip club'),
  ('style doggy'),
  ('suck'),
  ('sucks'),
  ('suicide girls'),
  ('sultry women'),
  ('swastika'),
  ('swinger'),
  ('tainted love'),
  ('taste my'),
  ('tea bagging'),
  ('threesome'),
  ('throating'),
  ('thumbzilla'),
  ('tied up'),
  ('tight white'),
  ('tit'),
  ('tits'),
  ('titties'),
  ('titty'),
  ('tongue in a'),
  ('topless'),
  ('tosser'),
  ('towelhead'),
  ('tranny'),
  ('tribadism'),
  ('tub girl'),
  ('tubgirl'),
  ('tushy'),
  ('twat'),
  ('twink'),
  ('twinkie'),
  ('two girls one cup'),
  ('undressing'),
  ('upskirt'),
  ('urethra play'),
  ('urophilia'),
  ('vagina'),
  ('venus mound'),
  ('viagra'),
  ('vibrator'),
  ('violet wand'),
  ('vorarephilia'),
  ('voyeur'),
  ('voyeurweb'),
  ('voyuer'),
  ('vulva'),
  ('wank'),
  ('wetback'),
  ('wet dream'),
  ('white power'),
  ('whore'),
  ('worldsex'),
  ('wrapping men'),
  ('wrinkled starfish'),
  ('xx'),
  ('xxx'),
  ('yaoi'),
  ('yellow showers'),
  ('yiffy'),
  ('zoophilia'),
  ('baiser'),
  ('bander'),
  ('bigornette'),
  ('bite'),
  ('bitte'),
  ('bloblos'),
  ('bordel'),
  ('bourré'),
  ('bourrée'),
  ('brackmard'),
  ('branlage'),
  ('branler'),
  ('branlette'),
  ('branleur'),
  ('branleuse'),
  ('brouter le cresson'),
  ('caca'),
  ('chatte'),
  ('chiasse'),
  ('chier'),
  ('chiottes'),
  ('clito'),
  ('con'),
  ('connard'),
  ('connasse'),
  ('conne'),
  ('couilles'),
  ('cramouille'),
  ('cul'),
  ('déconne'),
  ('déconner'),
  ('emmerdant'),
  ('emmerder'),
  ('emmerdeur'),
  ('emmerdeuse'),
  ('enculé'),
  ('enculée'),
  ('enculeur'),
  ('enculeurs'),
  ('enfoiré'),
  ('enfoirée'),
  ('étron'),
  ('fille de pute'),
  ('fils de pute'),
  ('foutre'),
  ('gerber'),
  ('gouine'),
  ('grande folle'),
  ('grogniasse'),
  ('gueule'),
  ('jouir'),
  ('la putain de ta mère'),
  ('malpt'),
  ('ménage à trois'),
  ('merde'),
  ('merdeuse'),
  ('merdeux'),
  ('meuf'),
  ('nègre'),
  ('nique ta mère'),
  ('nique ta race'),
  ('palucher'),
  ('pédale'),
  ('pédé'),
  ('pipi'),
  ('pisser'),
  ('pouffiasse'),
  ('pousse-crotte'),
  ('putain'),
  ('pute'),
  ('ramoner'),
  ('sac à foutre'),
  ('sac à merde'),
  ('salaud'),
  ('salope'),
  ('suce'),
  ('tapette'),
  ('tanche'),
  ('teuch'),
  ('tringler'),
  ('trique'),
  ('troncher'),
  ('trou du cul'),
  ('turlute'),
  ('zigounette'),
  ('zizi')
on conflict (word) do nothing;

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
--
-- normalize_for_word_match() is shared by both the input text and
-- every list entry, so they're always compared on equal footing —
-- collapsing anything that isn't a letter/digit to a single space
-- means "kill-switch", "kill  switch" and "Kill Switch" all match
-- the stored entry "kill switch".
create or replace function public.normalize_for_word_match(input_text text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(lower(coalesce(input_text, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function public.contains_banned_words(input_text text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  cleaned text;
  padded text;
  banned record;
  allowed record;
begin
  if input_text is null or input_text = '' then
    return false;
  end if;

  cleaned := public.normalize_for_word_match(input_text);

  -- Literal replace (not regexp_replace) on the now fully
  -- alphanumeric-plus-space `cleaned` string — safe even though
  -- allowed_phrases/banned_words are moderator-entered free text,
  -- since neither the normalized text nor a normalized entry can
  -- contain regex or LIKE wildcard characters at this point.
  for allowed in select phrase from public.allowed_phrases loop
    cleaned := replace(cleaned, public.normalize_for_word_match(allowed.phrase), ' ');
  end loop;

  padded := ' ' || cleaned || ' ';

  for banned in select word from public.banned_words loop
    if padded like '% ' || public.normalize_for_word_match(banned.word) || ' %' then
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
