-- Hexdrift party rooms on Supabase's live channels (the free plan allows 100
-- live messages a second and 2 million a month, chat included).
--
-- 1. Members may also use one shared channel, hxlive, where everyone in a room
--    shows up: the rooms split the message budget between them by its count.
-- 2. A monthly count of the messages rooms use (added in batches by the
--    players' browsers), so new races stop before the month's limit.
drop policy if exists "hexdrift rooms: members listen" on realtime.messages;
create policy "hexdrift rooms: members listen" on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and realtime.topic() ~ '^(hxroom:[A-Z]{6}|hxlive)$' and public.is_member());
drop policy if exists "hexdrift rooms: members send" on realtime.messages;
create policy "hexdrift rooms: members send" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and realtime.topic() ~ '^(hxroom:[A-Z]{6}|hxlive)$' and public.is_member());

create table if not exists public.hexdrift_usage (
  month date primary key,
  used bigint not null default 0
);
alter table public.hexdrift_usage enable row level security;
revoke all on public.hexdrift_usage from anon, authenticated;

-- Adds n messages to this month's count and returns the total (n = 0 just reads it).
create or replace function public.hexdrift_usage_add(n integer)
returns bigint language plpgsql security definer set search_path = public as $$
declare total bigint;
begin
  if not public.is_member() then raise exception 'members only'; end if;
  -- One browser's batch covers at most about 30 seconds of a full room.
  if n is null or n < 0 or n > 20000 then raise exception 'bad count'; end if;
  insert into public.hexdrift_usage as u (month, used) values (date_trunc('month', now())::date, n)
    on conflict (month) do update set used = u.used + excluded.used
    returning u.used into total;
  return total;
end $$;
revoke all on function public.hexdrift_usage_add(integer) from public, anon;
grant execute on function public.hexdrift_usage_add(integer) to authenticated;
