-- Hexdrift Community Maps. Safe to run again (every statement is idempotent).
--
-- Players publish maps they made in the editor. A map is its pieces (JSON);
-- the game rebuilds the road from them. Publishing goes through the
-- hexdrift-maps function, which rebuilds the map and re-drives the maker's
-- run (the author time) before saving, so every published map can be finished.
-- Records on a community map live in hexdrift_records under "<id>-<version>":
-- editing a published map starts a fresh leaderboard.
--
-- Members can like, play and report maps. Three reports hide a map until a
-- site owner (chat_owners) looks at it. Owners feature, hide and unhide maps.

create table if not exists public.hexdrift_maps (
  id text primary key check (id ~ '^c[0-9a-z]{8}$'),
  author text not null references public.profiles (email) on delete cascade,
  -- The map's id in the maker's editor (publishing again updates this row).
  local_id text not null check (local_id ~ '^u[0-9a-z]{4,12}$'),
  name text not null check (length(name) between 1 and 32),
  theme text not null check (theme in ('miami', 'storm', 'alpine', 'baja', 'sky', 'space')),
  pieces jsonb not null check (jsonb_typeof(pieces) = 'array' and length(pieces::text) <= 40000),
  version text not null check (version ~ '^[0-9a-z]{1,8}$'),
  author_ticks integer not null check (author_ticks > 0 and author_ticks <= 36000),
  author_inputs text not null check (length(author_inputs) <= 48000),
  length_m integer not null check (length_m between 0 and 10000),
  checkpoints integer not null default 0 check (checkpoints between 0 and 240),
  v integer not null,
  likes integer not null default 0,
  -- Players who drove it (each counted once).
  plays integer not null default 0,
  reports integer not null default 0,
  featured_at timestamptz,
  -- Taken down: by an owner, or by three reports until an owner looks.
  hidden boolean not null default false,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author, local_id)
);

create index if not exists hexdrift_maps_featured on public.hexdrift_maps (hidden, featured_at desc nulls last);
create index if not exists hexdrift_maps_popular on public.hexdrift_maps (hidden, likes desc, published_at desc);
create index if not exists hexdrift_maps_played on public.hexdrift_maps (hidden, plays desc, published_at desc);
create index if not exists hexdrift_maps_new on public.hexdrift_maps (hidden, published_at desc);
create index if not exists hexdrift_maps_author on public.hexdrift_maps (author);

create table if not exists public.hexdrift_map_likes (
  map_id text not null references public.hexdrift_maps (id) on delete cascade,
  email text not null default public.me() references public.profiles (email) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (map_id, email)
);
create index if not exists hexdrift_map_likes_email on public.hexdrift_map_likes (email);

create table if not exists public.hexdrift_map_plays (
  map_id text not null references public.hexdrift_maps (id) on delete cascade,
  email text not null references public.profiles (email) on delete cascade,
  runs integer not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (map_id, email)
);

create table if not exists public.hexdrift_map_reports (
  map_id text not null references public.hexdrift_maps (id) on delete cascade,
  email text not null default public.me() references public.profiles (email) on delete cascade,
  reason text not null check (reason in ('name', 'broken', 'copied', 'other')),
  note text not null default '' check (length(note) <= 200),
  created_at timestamptz not null default now(),
  primary key (map_id, email)
);

-- ── Who sees what ───────────────────────────────────────────────────────────

alter table public.hexdrift_maps enable row level security;
alter table public.hexdrift_map_likes enable row level security;
alter table public.hexdrift_map_plays enable row level security;
alter table public.hexdrift_map_reports enable row level security;

-- Members see every map that isn't hidden; makers see their own; owners see all.
drop policy if exists "members read maps" on public.hexdrift_maps;
create policy "members read maps" on public.hexdrift_maps for select to authenticated
  using (public.is_member() and (not hidden or author = public.me() or public.is_chat_owner()));
-- Makers take their maps down; owners can remove any.
drop policy if exists "makers delete maps" on public.hexdrift_maps;
create policy "makers delete maps" on public.hexdrift_maps for delete to authenticated
  using (author = public.me() or public.is_chat_owner());

drop policy if exists "members read likes" on public.hexdrift_map_likes;
create policy "members read likes" on public.hexdrift_map_likes for select to authenticated using (public.is_member());
drop policy if exists "members like" on public.hexdrift_map_likes;
create policy "members like" on public.hexdrift_map_likes for insert to authenticated
  with check (email = public.me() and public.is_member()
    and exists (select 1 from public.hexdrift_maps m where m.id = map_id and not m.hidden and m.author <> public.me()));
drop policy if exists "members unlike" on public.hexdrift_map_likes;
create policy "members unlike" on public.hexdrift_map_likes for delete to authenticated using (email = public.me());

-- Plays are written by hexdrift_played() only; you can see your own.
drop policy if exists "read own plays" on public.hexdrift_map_plays;
create policy "read own plays" on public.hexdrift_map_plays for select to authenticated using (email = public.me());

-- Reports: you file and see your own (one per map); owners see them all.
drop policy if exists "members report" on public.hexdrift_map_reports;
create policy "members report" on public.hexdrift_map_reports for insert to authenticated
  with check (email = public.me() and public.is_member()
    and exists (select 1 from public.hexdrift_maps m where m.id = map_id and m.author <> public.me()));
drop policy if exists "read reports" on public.hexdrift_map_reports;
create policy "read reports" on public.hexdrift_map_reports for select to authenticated
  using (email = public.me() or public.is_chat_owner());

revoke all on public.hexdrift_maps, public.hexdrift_map_likes, public.hexdrift_map_plays, public.hexdrift_map_reports from anon, authenticated;
grant select, delete on public.hexdrift_maps to authenticated;
grant select, insert, delete on public.hexdrift_map_likes to authenticated;
grant select on public.hexdrift_map_plays to authenticated;
grant select, insert on public.hexdrift_map_reports to authenticated;
grant all on public.hexdrift_maps, public.hexdrift_map_likes, public.hexdrift_map_plays, public.hexdrift_map_reports to service_role;

-- ── Counters ────────────────────────────────────────────────────────────────

create or replace function public.hexdrift_like_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update hexdrift_maps set likes = likes + 1 where id = new.map_id;
  else update hexdrift_maps set likes = greatest(0, likes - 1) where id = old.map_id; end if;
  return null;
end $$;
drop trigger if exists hexdrift_like_count on public.hexdrift_map_likes;
create trigger hexdrift_like_count after insert or delete on public.hexdrift_map_likes
  for each row execute function public.hexdrift_like_count();

-- Three reports hide a map until an owner looks (featured maps stay up).
create or replace function public.hexdrift_report_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update hexdrift_maps set reports = reports + 1,
    hidden = hidden or (reports + 1 >= 3 and featured_at is null)
  where id = new.map_id;
  return null;
end $$;
drop trigger if exists hexdrift_report_count on public.hexdrift_map_reports;
create trigger hexdrift_report_count after insert on public.hexdrift_map_reports
  for each row execute function public.hexdrift_report_count();

-- A removed map takes its leaderboards with it.
create or replace function public.hexdrift_map_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from hexdrift_records where map like old.id || '-%';
  return null;
end $$;
drop trigger if exists hexdrift_map_gone on public.hexdrift_maps;
create trigger hexdrift_map_gone after delete on public.hexdrift_maps
  for each row execute function public.hexdrift_map_gone();

-- Called when a member starts a community map: counts each player once.
create or replace function public.hexdrift_played(p_map text) returns void
language plpgsql security definer set search_path = public as $$
declare fresh boolean;
begin
  if not public.is_member() then raise exception 'Members only'; end if;
  if not exists (select 1 from hexdrift_maps where id = p_map and not hidden) then return; end if;
  insert into hexdrift_map_plays (map_id, email) values (p_map, public.me())
    on conflict (map_id, email) do update set runs = hexdrift_map_plays.runs + 1, last_at = now()
    returning (xmax = 0) into fresh;
  if fresh then update hexdrift_maps set plays = plays + 1 where id = p_map; end if;
end $$;
revoke all on function public.hexdrift_played(text) from public, anon;
grant execute on function public.hexdrift_played(text) to authenticated;

-- Owners: feature, unfeature, hide, unhide (unhiding clears the reports).
create or replace function public.hexdrift_moderate(p_map text, p_action text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_chat_owner() then raise exception 'Only site owners can do that'; end if;
  if p_action = 'feature' then update hexdrift_maps set featured_at = now(), hidden = false where id = p_map;
  elsif p_action = 'unfeature' then update hexdrift_maps set featured_at = null where id = p_map;
  elsif p_action = 'hide' then update hexdrift_maps set hidden = true, featured_at = null where id = p_map;
  elsif p_action = 'unhide' then
    update hexdrift_maps set hidden = false, reports = 0 where id = p_map;
    delete from hexdrift_map_reports where map_id = p_map;
  else raise exception 'Unknown action'; end if;
end $$;
revoke all on function public.hexdrift_moderate(text, text) from public, anon;
grant execute on function public.hexdrift_moderate(text, text) to authenticated;
