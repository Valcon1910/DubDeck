-- Hexdrift online records. Safe to run again (every statement is idempotent).
--
-- One row per player per map: their best run. A run is the list of the
-- player's button presses (base64), so it doubles as their ghost.
-- Nobody writes here directly: the hexdrift-submit function re-drives each
-- run with the game's own physics and only saves it if the time matches.
-- Members can read every record (for leaderboards and world-record ghosts).

create table if not exists public.hexdrift_records (
  map text not null check (map ~ '^[a-z0-9-]{1,40}$'),
  email text not null references public.profiles (email) on delete cascade,
  ticks integer not null check (ticks > 0 and ticks <= 36000),
  inputs text not null check (length(inputs) <= 48000),
  v integer not null,
  set_at timestamptz not null default now(),
  primary key (map, email)
);

create index if not exists hexdrift_records_board on public.hexdrift_records (map, v, ticks, set_at);
create index if not exists hexdrift_records_player on public.hexdrift_records (email);

alter table public.hexdrift_records enable row level security;

drop policy if exists "members read records" on public.hexdrift_records;
create policy "members read records" on public.hexdrift_records for select to authenticated using (public.is_member());

-- Explicit grants: read for signed-in members only (writes go through the function).
revoke all on public.hexdrift_records from anon, authenticated;
grant select on public.hexdrift_records to authenticated;
grant all on public.hexdrift_records to service_role;
