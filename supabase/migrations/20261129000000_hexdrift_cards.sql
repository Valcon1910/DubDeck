-- Hexdrift Community Maps: cards and profiles. Safe to run again.
--
-- Each map gets a picture (taken by the game on the maker's test drive and
-- uploaded by the hexdrift-maps function to the public "pics" bucket).
-- hexdrift_list() feeds the browse page: every card with its world record
-- holder, how many players finished it, and how hard it is. hexdrift_held()
-- lists the world records one player holds (for their profile page).

alter table public.hexdrift_maps add column if not exists picture text not null default ''
  check (length(picture) <= 300);

-- Finishing players per map version, for the world record and difficulty.
create index if not exists hexdrift_records_v_map on public.hexdrift_records (v, map, ticks, set_at);
create index if not exists hexdrift_map_likes_recent on public.hexdrift_map_likes (map_id, created_at);
create index if not exists hexdrift_map_plays_recent on public.hexdrift_map_plays (map_id, last_at);

-- Sorts: trending (likes and players this week), new, liked, played,
-- hardest (fewest players reach the finish), featured, mine, hidden (owners),
-- author (one player's maps, for their profile).
-- Difficulty is 0 (everyone finishes) to 1 (nobody does); it needs 5 players
-- before it counts, until then it's null ("not rated yet").
drop function if exists public.hexdrift_list(text, text, integer, text, integer);
create or replace function public.hexdrift_list(p_sort text, p_search text, p_v integer, p_author text default null, p_limit integer default 60)
returns table (
  id text, author text, local_id text, name text, theme text, version text, author_ticks integer, length_m integer,
  checkpoints integer, likes integer, plays integer, reports integer, featured_at timestamptz, hidden boolean,
  published_at timestamptz, updated_at timestamptz, picture text,
  wr_email text, wr_ticks integer, finishers integer, difficulty real, trend integer
)
language sql stable security definer set search_path = public as $$
  with seen as (
    select m.* from hexdrift_maps m
    where public.is_member()
      and (not m.hidden or m.author = public.me() or public.is_chat_owner())
      and case p_sort
        when 'mine' then m.author = public.me()
        when 'author' then m.author = lower(coalesce(p_author, '')) and (not m.hidden or m.author = public.me())
        when 'hidden' then m.hidden and public.is_chat_owner()
        when 'featured' then not m.hidden and m.featured_at is not null
        else not m.hidden end
      and (coalesce(trim(p_search), '') = '' or m.name ilike '%' || replace(replace(replace(trim(p_search), '\', ''), '%', ''), '_', '') || '%')
  ), cards as (
    select s.*, wr.email as wr_email, wr.ticks as wr_ticks,
      (select count(*)::int from hexdrift_records r where r.v = p_v and r.map = s.id || '-' || s.version) as finishers,
      (select count(*)::int from hexdrift_map_likes l where l.map_id = s.id and l.created_at > now() - interval '7 days') * 3
        + (select count(*)::int from hexdrift_map_plays p where p.map_id = s.id and p.last_at > now() - interval '7 days') as trend
    from seen s
    left join lateral (
      select r.email, r.ticks from hexdrift_records r
      where r.v = p_v and r.map = s.id || '-' || s.version
      order by r.ticks, r.set_at limit 1
    ) wr on true
  )
  select c.id, c.author, c.local_id, c.name, c.theme, c.version, c.author_ticks, c.length_m, c.checkpoints,
    c.likes, c.plays, c.reports, c.featured_at, c.hidden, c.published_at, c.updated_at, c.picture,
    c.wr_email, c.wr_ticks, c.finishers,
    case when c.plays >= 5 then greatest(0, 1 - least(c.finishers, c.plays)::real / c.plays)::real end as difficulty,
    c.trend
  from cards c
  order by
    case when p_sort = 'trending' then c.trend end desc nulls last,
    case when p_sort = 'liked' then c.likes end desc nulls last,
    case when p_sort = 'played' then c.plays end desc nulls last,
    case when p_sort = 'hardest' then (case when c.plays >= 5 then 1 - least(c.finishers, c.plays)::real / c.plays end) end desc nulls last,
    case when p_sort = 'hardest' then c.author_ticks::real / greatest(c.length_m, 1) end desc nulls last,
    case when p_sort = 'featured' then c.featured_at end desc nulls last,
    case when p_sort = 'hidden' then c.reports end desc nulls last,
    c.published_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 100);
$$;
revoke all on function public.hexdrift_list(text, text, integer, text, integer) from public, anon;
grant execute on function public.hexdrift_list(text, text, integer, text, integer) to authenticated;

-- The maps where this player has the fastest run (built-in and community).
drop function if exists public.hexdrift_held(text, integer);
create or replace function public.hexdrift_held(p_email text, p_v integer)
returns table (map text, ticks integer, set_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.map, b.ticks, b.set_at from (
    select distinct on (r.map) r.map, r.email, r.ticks, r.set_at
    from hexdrift_records r
    where r.v = p_v and r.map in (select x.map from hexdrift_records x where x.email = lower(p_email) and x.v = p_v)
    order by r.map, r.ticks, r.set_at
  ) b
  where public.is_member() and b.email = lower(p_email)
    -- Community maps count on their current version, and not while hidden
    -- (unless they're yours to see).
    and (b.map !~ '^c[0-9a-z]{8}-' or exists (select 1 from hexdrift_maps m where m.id || '-' || m.version = b.map
      and (not m.hidden or m.author = public.me() or public.is_chat_owner())))
  order by b.set_at desc;
$$;
revoke all on function public.hexdrift_held(text, integer) from public, anon;
grant execute on function public.hexdrift_held(text, integer) to authenticated;
