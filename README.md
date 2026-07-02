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

- Jména členů: pole `MEMBERS` v `src/App.jsx`.
- Data se ukládají do `localStorage` (jen v daném telefonu). Sdílený stav
  vyžaduje backend — viz `CLAUDE.md`, sekce backlog.

Podrobnější kontext v [`CLAUDE.md`](./CLAUDE.md).
