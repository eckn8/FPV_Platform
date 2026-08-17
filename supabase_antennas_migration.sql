-- =======================================================
-- 📡 supabase_antennas_migration.sql — Move "Antennas"
-- Run once (SQL Editor → New query → paste → Run), after
-- supabase_root_lock_migration.sql.
--
-- "Antennas" moves from a single folder directly under
-- Drone > Electronic to one folder under each of VTX and RX
-- (an antenna mount is specific to which radio it's for) —
-- checked against production first: no published model currently
-- uses the old Drone/Electronic/Antennas path, so this is a plain
-- delete + insert, nothing to re-root.
-- =======================================================

-- ---- 1. Drop the old folder ---------------------------------
delete from public.custom_folders
where path = array['Drone', 'Electronic', 'Antennas'];

-- ---- 2. Add it under VTX and RX instead ----------------------
insert into public.custom_folders (path)
values
  (array['Drone', 'Electronic', 'VTX', 'Antennas']),
  (array['Drone', 'Electronic', 'RX', 'Antennas'])
on conflict (path) do nothing;
