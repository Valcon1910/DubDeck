-- Vortex Chat, part 2. Idempotent like the first file (setup runs it each time).
--  - Remove a chat just for yourself (swipe → Delete): it disappears from your
--    list with its history; a new message brings it back, without the old ones.
--  - Flood protection: a cap on how fast one person can send messages.

alter table public.participants add column if not exists cleared_at timestamptz;

create or replace function public.clear_conversation(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update participants set cleared_at = now(), last_read_at = now() where conversation_id = p_id and email = public.me();
$$;

-- The chat list now hides chats you cleared (until something new arrives) and
-- tells the page where your history starts. The return type changed, so the
-- old version has to go first.
drop function if exists public.my_conversations();
create function public.my_conversations()
returns table (
  id uuid, kind text, name text, icon text, created_by text, last_message_at timestamptz,
  last_read_at timestamptz, my_role text, unread int, members text[],
  last_body text, last_sender text, last_files int, last_deleted boolean, cleared_at timestamptz
) language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.name, c.icon, c.created_by, c.last_message_at, p.last_read_at, p.role,
    (select count(*)::int from messages m where m.conversation_id = c.id and m.created_at > p.last_read_at and m.sender <> p.email),
    (select array_agg(q.email order by q.joined_at) from participants q where q.conversation_id = c.id),
    l.body, l.sender, coalesce(jsonb_array_length(l.attachments), 0), l.deleted, p.cleared_at
  from participants p
  join conversations c on c.id = p.conversation_id
  left join lateral (select * from messages m where m.conversation_id = c.id order by m.created_at desc limit 1) l on true
  where p.email = public.me() and (p.cleared_at is null or c.last_message_at > p.cleared_at)
  order by c.last_message_at desc
$$;

-- At most 20 messages in 10 seconds and 300 an hour per person.
create or replace function public.message_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_me text := public.me();
begin
  if (select count(*) from messages where sender = v_me and created_at > now() - interval '10 seconds') >= 20
    or (select count(*) from messages where sender = v_me and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'You''re sending messages too fast. Wait a moment and try again.';
  end if;
  return new;
end $$;
create index if not exists messages_sender_time on public.messages (sender, created_at desc);
drop trigger if exists message_rate on public.messages;
create trigger message_rate before insert on public.messages
  for each row when (current_user = 'authenticated') execute function public.message_rate_limit();

revoke execute on function public.clear_conversation(uuid), public.my_conversations() from anon, public;
grant execute on function public.clear_conversation(uuid), public.my_conversations() to authenticated;
