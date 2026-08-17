-- =======================================================
-- 🖼 supabase_frame_taxonomy_update.sql — Restructure Frame
-- Run once (SQL Editor → New query → paste → Run), after
-- supabase_root_lock_migration.sql.
--
-- 1. Arm/Bottom/Canopy/Landing Gear/Spacer/Top move from directly
--    under Drone/Frame into a new Drone/Frame/Parts folder, plus a
--    new sibling "Ducts". Checked against production first: no
--    published model uses any of the six old paths, so this is a
--    plain delete + insert, nothing to re-root.
-- 2. Nine new size-class folders directly under Drone/Frame:
--    Tinywhoop, Nano, Speed, Cinewhoop, 2inch, 3inch, 4inch, 5inch,
--    6inch+. Motors/Propellers/Camera Mount are untouched.
-- =======================================================

-- ---- 1. Drop the six folders being moved ---------------------
delete from public.custom_folders
where path = array['Drone', 'Frame', 'Arm']
   or path = array['Drone', 'Frame', 'Bottom']
   or path = array['Drone', 'Frame', 'Canopy']
   or path = array['Drone', 'Frame', 'Landing Gear']
   or path = array['Drone', 'Frame', 'Spacer']
   or path = array['Drone', 'Frame', 'Top'];

-- ---- 2. Re-create them under Drone/Frame/Parts, plus Ducts -----
insert into public.custom_folders (path)
values
  (array['Drone', 'Frame', 'Parts']),
  (array['Drone', 'Frame', 'Parts', 'Arm']),
  (array['Drone', 'Frame', 'Parts', 'Bottom']),
  (array['Drone', 'Frame', 'Parts', 'Canopy']),
  (array['Drone', 'Frame', 'Parts', 'Landing Gear']),
  (array['Drone', 'Frame', 'Parts', 'Spacer']),
  (array['Drone', 'Frame', 'Parts', 'Top']),
  (array['Drone', 'Frame', 'Parts', 'Ducts'])
on conflict (path) do nothing;

-- ---- 3. New size-class folders directly under Drone/Frame -------
insert into public.custom_folders (path)
values
  (array['Drone', 'Frame', 'Tinywhoop']),
  (array['Drone', 'Frame', 'Nano']),
  (array['Drone', 'Frame', 'Speed']),
  (array['Drone', 'Frame', 'Cinewhoop']),
  (array['Drone', 'Frame', '2inch']),
  (array['Drone', 'Frame', '3inch']),
  (array['Drone', 'Frame', '4inch']),
  (array['Drone', 'Frame', '5inch']),
  (array['Drone', 'Frame', '6inch+'])
on conflict (path) do nothing;
