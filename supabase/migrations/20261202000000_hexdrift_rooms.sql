-- Hexdrift multiplayer rooms: private live channels named hxroom:<code>, where
-- members see who's in the room (presence) and set up the peer connections
-- (broadcast). Only Vortex members can join. The cars themselves go peer to
-- peer through Cloudflare's relay (see the hexdrift-turn function), never here.
drop policy if exists "hexdrift rooms: members listen" on realtime.messages;
create policy "hexdrift rooms: members listen" on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and realtime.topic() ~ '^hxroom:[A-Z]{6}$' and public.is_member());
drop policy if exists "hexdrift rooms: members send" on realtime.messages;
create policy "hexdrift rooms: members send" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and realtime.topic() ~ '^hxroom:[A-Z]{6}$' and public.is_member());
