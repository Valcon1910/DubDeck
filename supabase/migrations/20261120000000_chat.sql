-- Vortex Chat. Safe to run again: every statement is idempotent, so the
-- "Set up Chat" workflow runs this whole file on each setup.
--
-- Identity is the visitor's email (verified by here.now's sign-in gate and
-- handed to Supabase by the vortex-login function). Everything is keyed by
-- email so members can be added to chats before they first open Chat.
-- Privacy is enforced here, by row level security: people only ever read
-- conversations they're in (the owner can read all, for moderation).

create extension if not exists pgcrypto;

-- ── Tables ─────────────────────────────────────────────────────────────────

-- Everyone on the site's access list (filled by scripts/chat-sync.mjs).
create table if not exists public.profiles (
  email text primary key check (email = lower(email)),
  name text not null default '' check (length(name) <= 60),
  avatar text not null default '' check (length(avatar) <= 500),
  member boolean not null default true,
  last_seen timestamptz
);

-- The site's owners (from web/src/vortex/admins.ts): moderators.
create table if not exists public.chat_owners (
  email text primary key
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm', 'group')),
  name text not null default '' check (length(name) <= 60),
  icon text not null default '' check (length(icon) <= 500),
  dm_key text unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.participants (
  conversation_id uuid not null references public.conversations on delete cascade,
  email text not null references public.profiles on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default 'epoch',
  primary key (conversation_id, email)
);
create index if not exists participants_email on public.participants (email);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations on delete cascade,
  sender text not null,
  body text not null default '' check (length(body) <= 4000),
  attachments jsonb not null default '[]' check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10),
  reply_to uuid references public.messages on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted boolean not null default false
);
create index if not exists messages_conversation on public.messages (conversation_id, created_at desc);

-- ── Helpers ────────────────────────────────────────────────────────────────

create or replace function public.me() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_chat_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from chat_owners where email = public.me())
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where email = public.me() and member)
$$;

create or replace function public.is_participant(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from participants where conversation_id = cid and email = public.me())
$$;

create or replace function public.is_group_admin(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_chat_owner() or exists (
    select 1 from participants where conversation_id = cid and email = public.me() and role = 'admin')
$$;

-- "some/uuid/file" → uuid, or null when the folder isn't a uuid.
create or replace function public.folder_uuid(path text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(path, '/', 1)::uuid;
exception when others then
  return null;
end $$;

-- ── Row level security ─────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.chat_owners enable row level security;
alter table public.conversations enable row level security;
alter table public.participants enable row level security;
alter table public.messages enable row level security;

-- Members see each other (to start chats); each edits only their own name/picture.
drop policy if exists "members read profiles" on public.profiles;
create policy "members read profiles" on public.profiles for select to authenticated using (public.is_member());
drop policy if exists "edit own profile" on public.profiles;
create policy "edit own profile" on public.profiles for update to authenticated
  using (email = public.me()) with check (email = public.me());
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name, avatar) on public.profiles to authenticated;

drop policy if exists "read owners" on public.chat_owners;
create policy "read owners" on public.chat_owners for select to authenticated using (public.is_member());
revoke insert, update, delete on public.chat_owners from anon, authenticated;

drop policy if exists "read own conversations" on public.conversations;
create policy "read own conversations" on public.conversations for select to authenticated
  using (public.is_participant(id) or public.is_chat_owner());
-- Creating, renaming and membership go through the functions below.
revoke insert, update, delete on public.conversations from anon, authenticated;

drop policy if exists "read members of own conversations" on public.participants;
create policy "read members of own conversations" on public.participants for select to authenticated
  using (public.is_participant(conversation_id) or public.is_chat_owner());
revoke insert, update, delete on public.participants from anon, authenticated;

drop policy if exists "read messages" on public.messages;
create policy "read messages" on public.messages for select to authenticated
  using (public.is_participant(conversation_id) or public.is_chat_owner());
drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages for insert to authenticated
  with check (sender = public.me() and not deleted and edited_at is null and public.is_participant(conversation_id));
drop policy if exists "edit own messages" on public.messages;
create policy "edit own messages" on public.messages for update to authenticated
  using (sender = public.me() or public.is_chat_owner())
  with check (sender = public.me() or public.is_chat_owner());
revoke insert, update, delete on public.messages from anon, authenticated;
grant select, insert on public.messages to authenticated;
grant update (body, attachments, edited_at, deleted) on public.messages to authenticated;

revoke all on all tables in schema public from anon;

-- Newer Supabase projects don't grant new tables to the API roles on their
-- own, so say it explicitly (row-level security above still decides rows).
grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant select on public.chat_owners, public.conversations, public.participants to authenticated;

-- ── Triggers ───────────────────────────────────────────────────────────────

-- Messages are stamped server-side (sender, time) and bump the conversation.
create or replace function public.on_message_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.sender := public.me();
  new.created_at := now();
  update conversations set last_message_at = new.created_at where id = new.conversation_id;
  -- Sending means you've read everything before it.
  update participants set last_read_at = new.created_at where conversation_id = new.conversation_id and email = new.sender;
  return new;
end $$;
drop trigger if exists message_insert on public.messages;
create trigger message_insert before insert on public.messages
  for each row when (current_user = 'authenticated') execute function public.on_message_insert();

-- Edits: a deleted message loses its text and files; the owner may only delete.
create or replace function public.on_message_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.deleted then raise exception 'Message was deleted'; end if;
  if new.deleted then
    new.body := ''; new.attachments := '[]';
  elsif old.sender <> public.me() then
    raise exception 'Only the sender can edit a message';
  elsif new.body is distinct from old.body or new.attachments is distinct from old.attachments then
    new.edited_at := now();
  end if;
  return new;
end $$;
drop trigger if exists message_update on public.messages;
create trigger message_update before update on public.messages
  for each row when (current_user = 'authenticated') execute function public.on_message_update();

-- ── Functions the site calls ───────────────────────────────────────────────

-- Opens (or reuses) a direct chat, or creates a group. Returns its id.
create or replace function public.create_conversation(p_kind text, p_members text[], p_name text default '', p_icon text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me text := public.me();
  v_members text[];
  v_key text;
  v_id uuid;
begin
  if v_me = '' or not exists (select 1 from profiles where email = v_me and member) then
    raise exception 'Not a Vortex member';
  end if;
  select array_agg(distinct lower(trim(m))) into v_members
    from unnest(coalesce(p_members, '{}') || v_me) m where trim(m) <> '';
  if exists (select 1 from unnest(v_members) m where not exists (select 1 from profiles where email = m and member)) then
    raise exception 'Everyone in a chat must be a Vortex member';
  end if;
  if p_kind = 'dm' then
    if array_length(v_members, 1) <> 2 then raise exception 'A direct chat is between two people'; end if;
    select string_agg(m, ' ' order by m) into v_key from unnest(v_members) m;
    select id into v_id from conversations where dm_key = v_key;
    if v_id is not null then return v_id; end if;
    insert into conversations (kind, dm_key, created_by) values ('dm', v_key, v_me) returning id into v_id;
  elsif p_kind = 'group' then
    if trim(coalesce(p_name, '')) = '' then raise exception 'A group needs a name'; end if;
    if array_length(v_members, 1) > 100 then raise exception 'Groups are limited to 100 people'; end if;
    insert into conversations (kind, name, icon, created_by) values ('group', left(trim(p_name), 60), coalesce(p_icon, ''), v_me) returning id into v_id;
  else
    raise exception 'Unknown kind';
  end if;
  insert into participants (conversation_id, email, role)
    select v_id, m, case when m = v_me and p_kind = 'group' then 'admin' else 'member' end from unnest(v_members) m;
  update participants set last_read_at = now() where conversation_id = v_id and email = v_me;
  return v_id;
end $$;

create or replace function public.update_group(p_id uuid, p_name text, p_icon text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(p_id) then raise exception 'Only group admins can change the group'; end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'A group needs a name'; end if;
  update conversations set name = left(trim(p_name), 60), icon = coalesce(p_icon, '') where id = p_id and kind = 'group';
end $$;

create or replace function public.add_members(p_id uuid, p_members text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(p_id) then raise exception 'Only group admins can add people'; end if;
  if not exists (select 1 from conversations where id = p_id and kind = 'group') then raise exception 'Not a group'; end if;
  insert into participants (conversation_id, email)
    select p_id, p.email from profiles p where p.member and p.email = any (select lower(trim(m)) from unnest(p_members) m)
    on conflict do nothing;
end $$;

-- Group admins remove anyone; everyone may remove themselves (leave).
create or replace function public.remove_member(p_id uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if lower(p_email) <> public.me() and not public.is_group_admin(p_id) then
    raise exception 'Only group admins can remove people';
  end if;
  delete from participants where conversation_id = p_id and email = lower(p_email)
    and exists (select 1 from conversations where id = p_id and kind = 'group');
  -- Keep an admin around: promote the longest-standing member.
  if not exists (select 1 from participants where conversation_id = p_id and role = 'admin') then
    update participants set role = 'admin' where conversation_id = p_id and email =
      (select email from participants where conversation_id = p_id order by joined_at limit 1);
  end if;
  if not exists (select 1 from participants where conversation_id = p_id) then
    delete from conversations where id = p_id;
  end if;
end $$;

create or replace function public.set_admin(p_id uuid, p_email text, p_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(p_id) then raise exception 'Only group admins can do that'; end if;
  update participants set role = case when p_admin then 'admin' else 'member' end
    where conversation_id = p_id and email = lower(p_email);
end $$;

create or replace function public.delete_conversation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_chat_owner() or exists (
    select 1 from conversations c where c.id = p_id and c.kind = 'group' and public.is_group_admin(p_id))) then
    raise exception 'Only group admins can delete a group';
  end if;
  delete from conversations where id = p_id;
end $$;

create or replace function public.mark_read(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update participants set last_read_at = now() where conversation_id = p_id and email = public.me();
$$;

-- The chat list: newest first, with the last message and unread count.
create or replace function public.my_conversations()
returns table (
  id uuid, kind text, name text, icon text, created_by text, last_message_at timestamptz,
  last_read_at timestamptz, my_role text, unread int, members text[],
  last_body text, last_sender text, last_files int, last_deleted boolean
) language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.name, c.icon, c.created_by, c.last_message_at, p.last_read_at, p.role,
    (select count(*)::int from messages m where m.conversation_id = c.id and m.created_at > p.last_read_at and m.sender <> p.email),
    (select array_agg(q.email order by q.joined_at) from participants q where q.conversation_id = c.id),
    l.body, l.sender, coalesce(jsonb_array_length(l.attachments), 0), l.deleted
  from participants p
  join conversations c on c.id = p.conversation_id
  left join lateral (select * from messages m where m.conversation_id = c.id order by m.created_at desc limit 1) l on true
  where p.email = public.me()
  order by c.last_message_at desc
$$;

create or replace function public.touch_seen()
returns void language sql security definer set search_path = public as $$
  update profiles set last_seen = now() where email = public.me();
$$;

revoke execute on all functions in schema public from anon, public;
grant execute on function public.me(), public.is_member(), public.is_chat_owner(), public.is_participant(uuid), public.is_group_admin(uuid),
  public.folder_uuid(text), public.create_conversation(text, text[], text, text), public.update_group(uuid, text, text),
  public.add_members(uuid, text[]), public.remove_member(uuid, text), public.set_admin(uuid, text, boolean),
  public.delete_conversation(uuid), public.mark_read(uuid), public.my_conversations(), public.touch_seen()
  to authenticated;

-- ── Live updates ───────────────────────────────────────────────────────────

alter table public.messages replica identity full;
alter table public.participants replica identity full;
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['messages', 'participants', 'conversations', 'profiles'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── Files ──────────────────────────────────────────────────────────────────
-- "chat": private, files sent in messages, in a folder per conversation.
-- "pics": public pictures (profile pictures and group icons).

insert into storage.buckets (id, name, public, file_size_limit)
  values ('chat', 'chat', false, 26214400)
  on conflict (id) do update set public = false, file_size_limit = 26214400;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('pics', 'pics', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  on conflict (id) do update set public = true, file_size_limit = 2097152,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

drop policy if exists "chat files: members read" on storage.objects;
create policy "chat files: members read" on storage.objects for select to authenticated
  using (bucket_id = 'chat' and (public.is_participant(public.folder_uuid(name)) or public.is_chat_owner()));
drop policy if exists "chat files: members upload" on storage.objects;
create policy "chat files: members upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and public.is_participant(public.folder_uuid(name)));

-- pics/<email>/... for your own picture, pics/<conversation id>/... for a group icon.
drop policy if exists "pics: upload own" on storage.objects;
create policy "pics: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'pics' and public.is_member() and (split_part(name, '/', 1) = public.me() or public.is_group_admin(public.folder_uuid(name))));
drop policy if exists "chat files: admins delete" on storage.objects;
create policy "chat files: admins delete" on storage.objects for delete to authenticated
  using (bucket_id = 'chat' and (owner_id = auth.uid()::text or public.is_group_admin(public.folder_uuid(name))));
drop policy if exists "pics: delete own" on storage.objects;
create policy "pics: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'pics' and owner_id = auth.uid()::text);

-- "…is typing" signals: private live channels named typing:<conversation id>,
-- which only that conversation's members can send to or hear.
drop policy if exists "typing: members listen" on realtime.messages;
create policy "typing: members listen" on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and realtime.topic() like 'typing:%'
    and public.is_participant(public.folder_uuid(substr(realtime.topic(), 8))));
drop policy if exists "typing: members send" on realtime.messages;
create policy "typing: members send" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and realtime.topic() like 'typing:%'
    and public.is_participant(public.folder_uuid(substr(realtime.topic(), 8))));
