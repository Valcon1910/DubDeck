-- Hexdrift: each record keeps the car it was driven with (the garage look,
-- as short JSON), so podiums can show the record holder's own car on top.
-- Safe to run again.
alter table public.hexdrift_records add column if not exists look text check (look is null or length(look) <= 400);
