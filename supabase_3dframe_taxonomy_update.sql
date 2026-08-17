-- =======================================================
-- 🖼 supabase_3dframe_taxonomy_update.sql — Group size classes
-- Run once (SQL Editor → New query → paste → Run), after
-- supabase_frame_taxonomy_update.sql.
--
-- Tinywhoop/Nano/Speed/Cinewhoop/2inch/3inch/4inch/5inch/6inch+
-- move from directly under Drone/Frame into a new
-- Drone/Frame/3DFrame folder. Checked production first: no
-- published model uses any of the nine old paths, so this is a
-- plain delete + insert, nothing to re-root.
-- =======================================================

-- ---- 1. Drop the nine folders being moved ---------------------
delete from public.custom_folders
where path = array['Drone', 'Frame', 'Tinywhoop']
   or path = array['Drone', 'Frame', 'Nano']
   or path = array['Drone', 'Frame', 'Speed']
   or path = array['Drone', 'Frame', 'Cinewhoop']
   or path = array['Drone', 'Frame', '2inch']
   or path = array['Drone', 'Frame', '3inch']
   or path = array['Drone', 'Frame', '4inch']
   or path = array['Drone', 'Frame', '5inch']
   or path = array['Drone', 'Frame', '6inch+'];

-- ---- 2. Re-create them under Drone/Frame/3DFrame ----------------
-- Insert order doesn't control display order (the folder browser
-- always sorts alphabetically — see getSubfoldersAt() in data.js),
-- kept here only to match how they were requested.
insert into public.custom_folders (path)
values
  (array['Drone', 'Frame', '3DFrame']),
  (array['Drone', 'Frame', '3DFrame', 'Tinywhoop']),
  (array['Drone', 'Frame', '3DFrame', 'Nano']),
  (array['Drone', 'Frame', '3DFrame', 'Cinewhoop']),
  (array['Drone', 'Frame', '3DFrame', 'Speed']),
  (array['Drone', 'Frame', '3DFrame', '2inch']),
  (array['Drone', 'Frame', '3DFrame', '3inch']),
  (array['Drone', 'Frame', '3DFrame', '4inch']),
  (array['Drone', 'Frame', '3DFrame', '5inch']),
  (array['Drone', 'Frame', '3DFrame', '6inch+'])
on conflict (path) do nothing;
