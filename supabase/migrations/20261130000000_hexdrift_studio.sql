-- Hexdrift studio maps: what the computer studio adds to a map (free parts,
-- placed objects, terrain edits, the sky and weather, object-list folders),
-- kept beside the road pieces. The hexdrift-maps function checks and cleans
-- it with the game's own code before saving. Safe to run again.

alter table public.hexdrift_maps add column if not exists scene jsonb not null default '{}'::jsonb;
alter table public.hexdrift_maps drop constraint if exists hexdrift_maps_scene_check;
alter table public.hexdrift_maps add constraint hexdrift_maps_scene_check
  check (jsonb_typeof(scene) = 'object' and length(scene::text) <= 400000);
