-- Sdílený seznam členů samošky.
--
-- Do téhle chvíle byli členové napevno v `.env` (VITE_MEMBERS). Teď žijí v DB
-- a spravují se přímo v appce (záložka „Lidi"). VITE_MEMBERS slouží už jen
-- jako prvotní naplnění (seed) — když je tabulka prázdná, appka do ní jména
-- z .env při prvním spuštění nasype.
--
-- Spusť jednou v Supabase → SQL Editor.

create table if not exists public.members (
  name     text primary key,          -- identita = jméno (stejně jako `by` u šarží/ledgeru)
  guest    boolean not null default false,  -- host: viditelný a se saldem, ale nerozpočítává se mu manko
  archived boolean not null default false,  -- schovaný/bývalý: už nefiguruje, historie zůstává
  sort     real,                       -- pořadí dlaždic při výběru jména
  at       bigint                      -- kdy přidán (ms)
);

-- Interní appka pro ~11 lidí, sdílená přes veřejný publishable key — stejný
-- režim jako u ostatních tabulek: povol anonymní přístup.
alter table public.members enable row level security;

drop policy if exists "members anon all" on public.members;
create policy "members anon all" on public.members
  for all to anon using (true) with check (true);

-- Realtime, ať se změny (přidání/schování člověka) propíšou všem hned.
alter publication supabase_realtime add table public.members;
