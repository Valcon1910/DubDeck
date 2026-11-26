-- Short profile IDs: profile links (#/profile/<pid>) no longer show the email.
-- Random, not worked out from the email, so a link doesn't give the address away.
-- Ten hex characters from a random UUID: plenty for a members-only site.
alter table public.profiles
  add column if not exists pid text not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
-- (A volatile default gives every existing row its own value.)
create unique index if not exists profiles_pid on public.profiles (pid);
alter table public.profiles drop constraint if exists profiles_pid_format;
alter table public.profiles add constraint profiles_pid_format check (pid ~ '^[0-9a-f]{10}$');
-- Members read it with the rest of the profile (select is granted on the table); nobody edits it.
