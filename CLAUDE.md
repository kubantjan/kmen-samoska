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
- **Lidi** — členové jsou ve sdílené DB (tabulka `members`), spravují se
  v appce (záložka „Lidi"), nic není napevno v kódu. Tři stavy: *člen*
  (počítá se saldo i rozpočítání manka), *host* (má saldo, ale manko se mezi
  hosty nedělí), *schovaný/bývalý* (`archived` — k dnešku už nefiguruje,
  historie zůstává, jde vrátit). `VITE_MEMBERS` je už jen prvotní seed prázdné
  tabulky. Schéma: `db/members.sql`.

## Stack

- Vite + React 18 (jediná komponenta v `src/App.jsx`, styly inline)
- `@zxing/browser` na čtení čárových kódů
- Data zatím v `localStorage` (klíče `samoska.*`) — **žádný backend**,
  stav je lokální v každém telefonu. Sdílený stav mezi lidmi je další krok.
- Deploy: GitHub Pages přes Actions (`.github/workflows/deploy.yml`)

## Než nasadíš

1. **`vite.config.js`** — `base` musí být `"/<nazev-repa>/"` (GitHub Pages
   servíruje z podadresáře). Teď je `"/samoska/"`.
2. **Členové** — v Supabase spusť `db/members.sql`. Jména buď rovnou přidej
   v appce (záložka „Lidi"), nebo předvyplň `VITE_MEMBERS` v `.env` (nasype se
   do prázdné tabulky při prvním spuštění).
3. V GitHubu: Settings → Pages → Source = **GitHub Actions**.
4. Push do `main` → workflow buildne a nasadí. URL bude
   `https://<user>.github.io/<repo>/`.

## Kam appku posunout dál (backlog)

- **Sdílený backend** — hlavní věc. Aby všech 11 lidí vidělo stejný stav.
  Zvažovaný stack: .NET minimal API + Postgres (konzistentní s hlavním
  produktem), nebo něco lehčího. Datový model: members, products (ean+název),
  stock_batches (produkt, kdo, qty, left, price, at), purchases (kdo, produkt,
  šarže, cena). Salda = suma naskladnění − suma odběrů per člověk.
- Odběr více kusů naráz (teď 1 klik = 1 kus).
- Editace/smazání omylem zadané položky.
- Historie transakcí.
- Záporný sklad / došlé zboží (co když si někdo vezme něco, co "není"?).
- Přihlašování (teď se jen klikne jméno).
