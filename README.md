# Samoška

Interní appka pro barákovou samošku kmene. Naskladnění, odběr (FIFO), sklad, salda, scan čárových kódů.

## Lokální vývoj

```bash
npm install
npm run dev
```

Otevři `http://localhost:5173`. Kamera (scan kódů) potřebuje HTTPS nebo
`localhost` — na `localhost` funguje, po síti (IP adresa) ne.

## Nasazení na GitHub Pages

1. V `vite.config.js` nastav `base` na `"/<nazev-repa>/"`.
2. Push do `main`.
3. GitHub → Settings → Pages → Source = **GitHub Actions**.
4. Appka poběží na `https://<user>.github.io/<repo>/`.

## Přizpůsobení

- **Lidi** se spravují přímo v appce (záložka „Lidi") — přidání, host,
  schování. Nic není napevno v kódu.
  - **Člen** — normální člověk, počítá se mu saldo i se s ním rozpočítává
    manko z inventury.
  - **Host** — je vidět a má saldo, ale manko/přebytek z inventury se mezi
    hosty **nedělí**.
  - **Schovaný / bývalý** — k dnešku se schová: přestane se nabízet a
    nefiguruje v rozpočítávání. Historie zůstává, jde vrátit zpět.
  - Tabulku v Supabase založ jednou přes `db/members.sql`.
  - `VITE_MEMBERS` v `.env` slouží už jen jako **prvotní naplnění** —
    appka jména nasype do DB, jen když je tabulka členů prázdná.
- Sdílený stav běží přes Supabase (viz `CLAUDE.md`). Identita „kdo jsem"
  zůstává lokální v telefonu (`localStorage`).

Podrobnější kontext v [`CLAUDE.md`](./CLAUDE.md).
