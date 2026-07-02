# Samoška — kontext pro Claude Code

Interní appka pro "barákovou samošku" komunity (kmene) o 11 lidech. Nahrazuje
současné řešení přes SettleUp, kde je "samoška" fiktivní osoba a účetnictví se
dělá ručně.

## Co appka dělá

Model je společný měšec (jako SettleUp):

- **Naskladnění** — kdokoliv přikoupí věci do samošky. Zadá název, počet kusů
  a cenu za kus. Vznikne *šarže* (batch). Naskladnění = kredit toho člověka
  (samoška mu dluží).
- **Odběr** — kdokoliv si vezme věc ze samošky. Platí cenu **nejstarší šarže
  (FIFO)** — tedy reálnou pořizovací cenu, žádné průměrování. Odběr = dluh.
- **Sklad** — kdykoliv je vidět, co je v samošce: souhrn (5× kečup) i rozpad
  po šaržích (2× po 35, 3× po 40, od koho).
- **Salda** — kdo je v plusu/mínusu. Žádné vyúčtování; průběžně někdo někomu
  pošle prachy (nejmínusovější → nejplusovějšímu). App navrhne převod.
- **Čárové kódy** — scan EANu kamerou (ZXing, funguje Android i iOS).
  Lookup názvu z Open Food Facts; když produkt není, zadá se ručně a app si
  ho podle EANu zapamatuje.

## Stack

- Vite + React 18 (jediná komponenta v `src/App.jsx`, styly inline)
- `@zxing/browser` na čtení čárových kódů
- **Sdílená DB: Supabase (Postgres).** Tabulky `products`, `batches`
  (sloupec `remaining` = v appce `left`), `ledger`. Realtime subscribe →
  změny se propíšou všem. FIFO odběr přes RPC `take_item` (atomicky).
  Klíče v `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- **Auth: jeden sdílený login** (Supabase Auth, `signInWithPassword`).
  Email v `.env` (`VITE_SUPABASE_LOGIN_EMAIL`), heslo píše uživatel.
  RLS je jen pro `authenticated` — viz `db/auth-rls.sql`. Identita
  ("kdo jsem") zůstává lokální (klik na jméno, `localStorage`).
- **Ceny z Rohlíku** — `searchRohlik()` volá neoficiální endpoint
  (posílá CORS `*`), hledá podle názvu, doplní název + orientační cenu.
- Deploy: GitHub Pages přes Actions (`.github/workflows/deploy.yml`)

## Než nasadíš

1. **`vite.config.js`** — `base` musí být `"/<nazev-repa>/"` (GitHub Pages
   servíruje z podadresáře). Teď je `"/samoska/"`.
2. **`src/App.jsx`** — pole `MEMBERS` nahoře přepiš na reálných 11 jmen.
3. V GitHubu: Settings → Pages → Source = **GitHub Actions**.
4. Push do `main` → workflow buildne a nasadí. URL bude
   `https://<user>.github.io/<repo>/`.

## Kam appku posunout dál (backlog)

- Editace/smazání omylem zadané položky.
- Historie transakcí.
- Záporný sklad / došlé zboží (co když si někdo vezme něco, co "není"?).
- Účty per člověk (magic link) místo jednoho sdíleného hesla — až pro
  ostrý provoz (viz varianta B v issue #1).

## Hotovo (dřív v backlogu)

- Sdílený backend → **Supabase** (viz Stack).
- Odběr více kusů naráz → počítadlo v potvrzovacím okně.
- Přihlašování → sdílený login (viz Stack + `db/auth-rls.sql`).
