-- =======================================================
-- 🔒 supabase_root_lock_migration.sql — Curated folder taxonomy
-- Run once (SQL Editor → New query → paste → Run), after
-- supabase_content_schema.sql / _fix.sql / comments_delete_policy.sql.
--
-- The folder tree is now a fixed, curated taxonomy: Drone / Camera
-- / Equipment at the top, with the categories below seeded by this
-- script. There is no self-service folder creation anymore —
-- publishing/requesting only *picks* an existing folder (see
-- upload.js/requests.js — the "create a new folder" UI has been
-- removed entirely, client-side). New categories get added the
-- same way this script does: a SQL insert, run as the catalog
-- grows (a "CNC" root, for instance, will be added the same way
-- once that section gets built).
--
-- This script also cleans up real duplicate data found in
-- production: five test folders were created directly under
-- "Camera" back when there was no locked root yet, two of them
-- near-duplicates of each other ("Camera/case/GoPro" vs
-- "Camera/GoPro/Case"). They're dropped in favor of the curated
-- tree below, and the one real model that used one of those paths
-- ("GoPro case") is moved to its proper place: Camera > Action Camera.
-- =======================================================

-- ---- 1. Re-root the one real model ------------------------
update public.models
set path = array['Camera', 'Action Camera']
where id = 'e63d76f4-d1dc-4c35-b087-f4baa00099e1';

-- ---- 2. Drop the five test/duplicate folders ---------------
delete from public.custom_folders
where path = array['Camera']
   or path = array['Camera', 'case']
   or path = array['Camera', 'case', 'GoPro']
   or path = array['Camera', 'GoPro']
   or path = array['Camera', 'GoPro', 'Case'];

-- ---- 3. Seed the curated taxonomy ---------------------------
-- One row per level, so every step of the path is browsable from
-- the folder picker/explorer.
insert into public.custom_folders (path)
values
  -- Drone
  (array['Drone']),
  (array['Drone', 'Frame']),
  (array['Drone', 'Frame', 'Motors']),
  (array['Drone', 'Frame', 'Arm']),
  (array['Drone', 'Frame', 'Propellers']),
  (array['Drone', 'Frame', 'Bottom']),
  (array['Drone', 'Frame', 'Top']),
  (array['Drone', 'Frame', 'Spacer']),
  (array['Drone', 'Frame', 'Canopy']),
  (array['Drone', 'Frame', 'Landing Gear']),
  -- For action cams (GoPro, Insta360...) mounted on the frame —
  -- distinct from Electronic > FPVCamera, which is the FPV camera
  -- itself (analog/digital), not an action cam.
  (array['Drone', 'Frame', 'Camera Mount']),
  (array['Drone', 'Battery']),
  (array['Drone', 'Battery', '1S']),
  (array['Drone', 'Battery', '2S']),
  (array['Drone', 'Battery', '3S']),
  (array['Drone', 'Battery', '4S']),
  (array['Drone', 'Battery', '5S']),
  (array['Drone', 'Battery', '6S']),
  (array['Drone', 'Battery', '8S']),
  (array['Drone', 'Battery', '12S']),
  (array['Drone', 'Battery', 'XTConnector']),
  (array['Drone', 'Battery', 'Mount']),
  (array['Drone', 'Electronic']),
  (array['Drone', 'Electronic', 'VTX']),
  (array['Drone', 'Electronic', 'RX']),
  (array['Drone', 'Electronic', 'FPVCamera']),
  (array['Drone', 'Electronic', 'Antennas']),
  (array['Drone', 'Electronic', 'Beeper']),
  (array['Drone', 'Electronic', 'GPS']),
  (array['Drone', 'Electronic', 'Stack']),
  (array['Drone', 'Electronic', 'BEC']),
  (array['Drone', 'Electronic', 'LED']),

  -- Camera
  (array['Camera']),
  (array['Camera', 'Action Camera']),
  (array['Camera', 'Cinema Camera']),

  -- Equipment
  (array['Equipment']),
  (array['Equipment', 'FPV']),
  (array['Equipment', 'FPV', 'Goggles']),
  (array['Equipment', 'FPV', 'Monitors']),
  (array['Equipment', 'FPV', 'Battery']),
  (array['Equipment', 'FPV', 'Case / Cover']),
  (array['Equipment', 'Radio']),
  (array['Equipment', 'Radio', 'Supports']),
  (array['Equipment', 'Radio', 'Sticks']),
  (array['Equipment', 'Radio', 'Externals TX']),
  (array['Equipment', 'Radio', 'Case / Cover']),
  (array['Equipment', 'Radio', 'Gimbal Protector']),
  (array['Equipment', 'Tools'])
on conflict (path) do nothing;

-- ---- 4. Lock the root going forward -------------------------
-- Enforced at the database level (not just a client-side check)
-- so it can never be bypassed.
alter table public.custom_folders
  add constraint custom_folders_locked_root
  check (path[1] = any (array['Drone', 'Camera', 'Equipment']));

alter table public.models
  add constraint models_locked_root
  check (path[1] = any (array['Drone', 'Camera', 'Equipment']));

-- ---- 5. Remove self-service folder creation ------------------
-- The "create a folder" UI is gone client-side, but that alone
-- doesn't stop a signed-in user from calling the Supabase REST API
-- directly. Dropping the INSERT policy closes that: RLS denies
-- everything by default with no policy, so only a service-role
-- key (never used by the client) can add new folders from now on —
-- i.e. only through a script/migration like this one.
drop policy "Authenticated users can create folders" on public.custom_folders;
