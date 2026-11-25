-- Groups can be set so only admins send messages (everyone still reads and reacts).
-- Safe to run again.

alter table public.conversations add column if not exists admins_only boolean not null default false;

create or replace function public.set_admins_only(p_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(p_id) then raise exception 'Only group admins can change who can send messages'; end if;
  update conversations set admins_only = coalesce(p_on, false) where id = p_id and kind = 'group';
end $$;

create or replace function public.can_send(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_participant(cid) and (
    not coalesce((select admins_only from conversations where id = cid), false)
    or exists (select 1 from participants where conversation_id = cid and email = public.me() and role = 'admin'))
$$;

drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages for insert to authenticated
  with check (sender = public.me() and not deleted and edited_at is null and public.can_send(conversation_id));

-- The chat list, now saying whether only admins can send.
drop function if exists public.my_conversations();
create function public.my_conversations()
returns table (
  id uuid, kind text, name text, icon text, created_by text, last_message_at timestamptz,
  last_read_at timestamptz, my_role text, unread int, members text[],
  last_body text, last_sender text, last_files int, last_deleted boolean, cleared_at timestamptz, admins_only boolean
) language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.name, c.icon, c.created_by, c.last_message_at, p.last_read_at, p.role,
    (select count(*)::int from messages m where m.conversation_id = c.id and m.created_at > p.last_read_at and m.sender <> p.email),
    (select array_agg(q.email order by q.joined_at) from participants q where q.conversation_id = c.id),
    l.body, l.sender, coalesce(jsonb_array_length(l.attachments), 0), l.deleted, p.cleared_at, c.admins_only
  from participants p
  join conversations c on c.id = p.conversation_id
  left join lateral (select * from messages m where m.conversation_id = c.id order by m.created_at desc limit 1) l on true
  where p.email = public.me() and (p.cleared_at is null or c.last_message_at > p.cleared_at)
  order by c.last_message_at desc
$$;

revoke execute on function public.set_admins_only(uuid, boolean), public.can_send(uuid), public.my_conversations() from anon, public;
grant execute on function public.set_admins_only(uuid, boolean), public.can_send(uuid), public.my_conversations() to authenticated;
