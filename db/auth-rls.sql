-- Zpřísnění přístupu po zavedení sdíleného loginu (issue #1).
-- Spustit v Supabase → SQL Editor AŽ POTÉ, co appka s loginem běží
-- a ověřil ses, že se přihlášení daří. Do té chvíle nech otevřené,
-- ať se nezamkneš.

-- 1) Nahraď otevřené anon politiky za "jen přihlášený"
drop policy if exists "anon all products" on products;
drop policy if exists "anon all batches"  on batches;
drop policy if exists "anon all ledger"   on ledger;

create policy "auth all products" on products for all to authenticated using (true) with check (true);
create policy "auth all batches"  on batches  for all to authenticated using (true) with check (true);
create policy "auth all ledger"   on ledger   for all to authenticated using (true) with check (true);

-- 2) RPC take_item je SECURITY DEFINER (obchází RLS), takže mu musíme
--    zakázat spuštění nepřihlášeným — jinak by se dala obejít ochrana.
revoke execute on function take_item(text, text, uuid, bigint) from anon, public;
grant  execute on function take_item(text, text, uuid, bigint) to authenticated;
