-- Emoji reactions on chat messages. Safe to run again.
-- One row per person, message and emoji; tapping the same emoji again removes it.

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages on delete cascade,
  conversation_id uuid not null references public.conversations on delete cascade,
  email text not null default public.me(),
  emoji text not null check (length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, email, emoji)
);
create index if not exists message_reactions_conversation on public.message_reactions (conversation_id);

alter table public.message_reactions enable row level security;

drop policy if exists "read reactions" on public.message_reactions;
create policy "read reactions" on public.message_reactions for select to authenticated
  using (public.is_participant(conversation_id) or public.is_chat_owner());
drop policy if exists "add own reaction" on public.message_reactions;
create policy "add own reaction" on public.message_reactions for insert to authenticated
  with check (email = public.me() and public.is_participant(conversation_id)
    and exists (select 1 from public.messages m where m.id = message_id and m.conversation_id = message_reactions.conversation_id and not m.deleted));
drop policy if exists "remove own reaction" on public.message_reactions;
create policy "remove own reaction" on public.message_reactions for delete to authenticated
  using (email = public.me());

revoke all on public.message_reactions from anon;
revoke update on public.message_reactions from authenticated;
grant select, insert, delete on public.message_reactions to authenticated;
grant all on public.message_reactions to service_role;

-- At most 6 different emoji per person on one message, and 60 reactions a minute.
create or replace function public.reaction_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email := public.me();
  new.created_at := now();
  if (select count(*) from message_reactions where message_id = new.message_id and email = new.email) >= 6 then
    raise exception 'That''s enough reactions on one message.';
  end if;
  if (select count(*) from message_reactions where email = new.email and created_at > now() - interval '1 minute') >= 60 then
    raise exception 'You''re reacting too fast. Wait a moment and try again.';
  end if;
  return new;
end $$;
drop trigger if exists reaction_limit on public.message_reactions;
create trigger reaction_limit before insert on public.message_reactions
  for each row when (current_user = 'authenticated') execute function public.reaction_limit();
revoke execute on function public.reaction_limit() from anon, public;

-- Live updates (full rows, so removals say which chat they were in).
alter table public.message_reactions replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
