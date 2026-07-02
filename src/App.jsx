import React, { useState, useEffect, useRef, useMemo } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { createClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────
// KMEN · SAMOŠKA
// Sdílený sklad přes Supabase (Postgres). Sklad, šarže a salda
// jsou společné pro všechny; identita ("kdo jsem") zůstává lokální
// v telefonu. Realtime → změny se propíšou všem naráz.
// ─────────────────────────────────────────────────────────────

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Členy nastav v `.env` přes VITE_MEMBERS (čárkou oddělená jména).
const MEMBERS = (import.meta.env.VITE_MEMBERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const KC = (n) =>
  new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n) + " Kč";

// Hledání bez ohledu na velikost písmen a diakritiku ("mleko" najde "Mléko").
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// ── "kdo jsem" zůstává lokální v telefonu ───────────────────
const load = (k, fallback) => {
  try { const v = localStorage.getItem("samoska." + k); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
};
const save = (k, v) => {
  try { localStorage.setItem("samoska." + k, JSON.stringify(v)); } catch {}
};

// ── Open Food Facts lookup ──────────────────────────────────
async function lookupEAN(ean) {
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,product_name_cs,brands`);
    const j = await r.json();
    if (j.status === 1 && j.product) {
      const name = j.product.product_name_cs || j.product.product_name || "";
      // Poslední značka bývá konkrétnější (např. "Kofola, Rajec" → "Rajec").
      const brands = (j.product.brands || "").split(",").map((s) => s.trim()).filter(Boolean);
      const brand = brands[brands.length - 1];
      return [brand, name].filter(Boolean).join(" ").trim() || null;
    }
  } catch (e) { /* offline / not found */ }
  return null;
}

// ── Rohlík — vyhledávání podle názvu (název + orientační cena) ──
// Neoficiální endpoint, ale posílá CORS `*`, takže jde volat z prohlížeče.
async function searchRohlik(query, limit = 6) {
  const q = (query || "").trim();
  if (q.length < 2) return [];
  try {
    const r = await fetch(
      `https://www.rohlik.cz/services/frontend-service/search-metadata?search=${encodeURIComponent(q)}&companyId=1`
    );
    const j = await r.json();
    const list = j?.data?.productList || [];
    return list
      .map((p) => ({
        id: p.productId,
        name: p.productName,
        price: p.price?.full ?? null,
        amount: p.textualAmount || "",
      }))
      .filter((x) => x.price != null)
      .slice(0, limit);
  } catch { return []; }
}

export default function App() {
  const [me, setMe] = useState(() => load("me", null));
  const [tab, setTab] = useState("shop");
  const [products, setProducts] = useState({});
  const [batches, setBatches] = useState([]);
  const [ledger, setLedger] = useState([]);

  useEffect(() => save("me", me), [me]);

  // Načti sdílený stav z Supabase (DB sloupec `remaining` → v appce `left`).
  async function refetch() {
    const [p, b, l] = await Promise.all([
      supabase.from("products").select("*"),
      supabase.from("batches").select("*"),
      supabase.from("ledger").select("*"),
    ]);
    if (p.data) setProducts(Object.fromEntries(p.data.map((r) => [r.ean, { ean: r.ean, name: r.name }])));
    if (b.data) setBatches(b.data.map((r) => ({ id: r.id, ean: r.ean, by: r.by, qty: r.qty, left: r.remaining, price: Number(r.price), at: r.at })));
    if (l.data) setLedger(l.data.map((r) => ({ id: r.id, ean: r.ean, by: r.by, price: Number(r.price), at: r.at })));
  }

  useEffect(() => {
    refetch();
    const ch = supabase
      .channel("samoska")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "batches" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "ledger" }, refetch)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const stock = useMemo(() => {
    const map = {};
    for (const b of batches) {
      if (b.left <= 0) continue;
      if (!map[b.ean]) map[b.ean] = { ean: b.ean, name: products[b.ean]?.name || b.ean, qty: 0, batches: [] };
      map[b.ean].qty += b.left;
      map[b.ean].batches.push(b);
    }
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, "cs"));
  }, [batches, products]);

  const balances = useMemo(() => {
    const bal = Object.fromEntries(MEMBERS.map((m) => [m, 0]));
    for (const b of batches) if (bal[b.by] !== undefined) bal[b.by] += b.qty * b.price;
    for (const l of ledger) if (bal[l.by] !== undefined) bal[l.by] -= l.price;
    return MEMBERS.map((m) => ({ name: m, amount: bal[m] })).sort((a, b) => b.amount - a.amount);
  }, [batches, ledger]);

  const suggestion = useMemo(() => {
    const top = balances[0];
    const bottom = balances[balances.length - 1];
    if (!top || !bottom || bottom.amount >= 0 || top.amount <= 0) return null;
    return { from: bottom.name, to: top.name, amount: Math.min(-bottom.amount, top.amount) };
  }, [balances]);

  async function addBatch(ean, name, qty, price) {
    await supabase.from("products").upsert({ ean, name });
    await supabase.from("batches").insert({
      id: crypto.randomUUID(), ean, by: me, qty, remaining: qty, price, at: Date.now(),
    });
    refetch();
  }

  // FIFO odběr atomicky na serveru (RPC take_item) — dva lidi naráz
  // nerozbijí `remaining` ani nevezmou stejný kus dvakrát. Víc kusů =
  // víc volání za sebou, každé sebere nejstarší dostupný kus.
  async function take(ean, count = 1) {
    for (let i = 0; i < count; i++) {
      const { error } = await supabase.rpc("take_item", {
        p_ean: ean, p_by: me, p_id: crypto.randomUUID(), p_at: Date.now(),
      });
      if (error) { alert("Nepovedlo se vzít: " + error.message); break; }
    }
    refetch();
  }

  // Inventura: srovná stav skladu na napočítaná čísla (odpis `remaining`)
  // a manko rozpočítá rovnoměrně mezi všechny členy (řádky v ledger).
  async function commitInventura(updates, manko) {
    for (const u of updates) {
      await supabase.from("batches").update({ remaining: u.remaining }).eq("id", u.id);
    }
    const per = Math.round((manko / (MEMBERS.length || 1)) * 100) / 100;
    if (per !== 0) {
      const at = Date.now();
      const rows = MEMBERS.map((m) => ({
        id: crypto.randomUUID(), ean: "__manko__", by: m, price: per, at,
      }));
      await supabase.from("ledger").insert(rows);
    }
    await refetch();
  }

  if (!me) return <NamePicker onPick={setMe} />;

  return (
    <div style={S.wrap}>
      <style>{CSS}</style>
      <header style={S.header}>
        <div>
          <div style={S.kicker}>KMEN · BARÁKOVÁ</div>
          <div style={S.wordmark}>SAMOŠKA</div>
        </div>
        <button style={S.mePill} onClick={() => setMe(null)}>
          <span style={{ opacity: 0.55, fontSize: 11, letterSpacing: 1 }}>NAKUPUJE</span>
          <span style={{ fontWeight: 700 }}>{me}</span>
        </button>
      </header>

      <nav style={S.tabs}>
        {[["shop", "Naskladnit / Vzít"], ["stock", "Sklad"], ["balance", "Kdo komu"], ["inv", "Inventura"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.tab, ...(tab === k ? S.tabOn : {}) }}>
            {label}
          </button>
        ))}
      </nav>

      <main style={S.main}>
        {tab === "shop" && <Shop stock={stock} onStock={addBatch} onTake={take} />}
        {tab === "stock" && <Stock stock={stock} />}
        {tab === "balance" && <Balance balances={balances} suggestion={suggestion} me={me} />}
        {tab === "inv" && <Inventura stock={stock} onCommit={commitInventura} />}
      </main>

      <footer style={S.footer}>
        Sdílený sklad · živě přes Supabase
      </footer>
    </div>
  );
}

function NamePicker({ onPick }) {
  return (
    <div style={S.wrap}>
      <style>{CSS}</style>
      <div style={S.pickerHero}>
        <div style={S.kicker}>KMEN · BARÁKOVÁ</div>
        <div style={S.wordmarkBig}>SAMOŠKA</div>
        <p style={S.pickerLead}>Kdo jsi? Klepni na svoje jméno.</p>
      </div>
      <div style={S.nameGrid}>
        {MEMBERS.map((m) => (
          <button key={m} style={S.nameTile} onClick={() => onPick(m)}>{m}</button>
        ))}
      </div>
    </div>
  );
}

function Shop({ stock, onStock, onTake }) {
  const [scanMode, setScanMode] = useState(null); // "stock" | "take" | null
  const [draft, setDraft] = useState(null);       // formulář naskladnění
  const [takeItem, setTakeItem] = useState(null);  // potvrzení odběru
  const [q, setQ] = useState("");                  // hledání ve skladu

  const filtered = q.trim() ? stock.filter((s) => norm(s.name).includes(norm(q))) : stock;

  function openTake(s) {
    // šarže od nejstarší (FIFO) — kvůli přesné ceně při odběru víc kusů
    const batches = s.batches.slice().sort((a, b) => a.at - b.at).map((b) => ({ left: b.left, price: b.price }));
    setTakeItem({ ean: s.ean, name: s.name, qty: s.qty, batches });
  }

  function onScanned(ean) {
    const mode = scanMode;
    setScanMode(null);
    if (mode === "take") {
      const s = stock.find((x) => x.ean === ean);
      if (!s) { alert("Tohle v samošce zatím není — nejdřív to musí někdo naskladnit."); return; }
      openTake(s);
      return;
    }
    setDraft({ ean, name: "", qty: 1, price: "" });
    lookupEAN(ean).then((name) => {
      if (name) setDraft((d) => (d && d.ean === ean && !d.name ? { ...d, name } : d));
    });
  }

  return (
    <>
      <section style={S.card}>
        <div style={S.cardTitle}>Přikoupil jsem do samošky</div>
        <p style={S.cardLead}>Naskenuj čárový kód, nebo přidej ručně.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button style={S.primary} onClick={() => setScanMode("stock")}>📷 Skenovat kód</button>
          <button style={S.ghost} onClick={() => setDraft({ ean: "", name: "", qty: 1, price: "" })}>
            Přidat ručně
          </button>
        </div>
      </section>

      {scanMode && <Scanner onScanned={onScanned} onClose={() => setScanMode(null)} />}

      {draft && (
        <StockForm
          draft={draft}
          setDraft={setDraft}
          onSave={(d) => { onStock(d.ean || "man-" + crypto.randomUUID().slice(0, 8), d.name || "Bezejmenné", d.qty, d.price); setDraft(null); }}
          onCancel={() => setDraft(null)}
        />
      )}

      <section style={S.card}>
        <div style={S.cardTitle}>Beru ze samošky</div>
        <p style={S.cardLead}>Klepni na položku, nebo naskenuj kód věci, kterou si bereš.</p>
        <button style={{ ...S.ghost, marginBottom: 12 }} onClick={() => setScanMode("take")}>
          📷 Skenovat &amp; vzít
        </button>
        {stock.length > 0 && (
          <SearchBox q={q} setQ={setQ} count={filtered.length} />
        )}
        {stock.length === 0 ? (
          <p style={S.empty}>Sklad je zatím prázdný. Něco přikup a objeví se to tady.</p>
        ) : filtered.length === 0 ? (
          <p style={S.empty}>Nic ve skladu neodpovídá „{q}".</p>
        ) : (
          <div style={S.takeList}>
            {filtered.map((s) => {
              const next = s.batches.slice().sort((a, b) => a.at - b.at)[0];
              return (
                <button key={s.ean} style={S.takeRow} onClick={() => openTake(s)}>
                  <span style={S.takeName}>{s.name}</span>
                  <span style={S.takeMeta}>
                    <span style={S.qtyBadge}>{s.qty}×</span>
                    <span style={S.takePrice}>{KC(next.price)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <p style={S.hint}>Bereš 1 kus za cenu nejstaršího naskladněného (FIFO). Před zapsáním se zeptáme na potvrzení.</p>
      </section>

      {takeItem && (
        <ConfirmTake
          item={takeItem}
          onConfirm={(n) => { onTake(takeItem.ean, n); setTakeItem(null); }}
          onCancel={() => setTakeItem(null)}
        />
      )}
    </>
  );
}

function StockForm({ draft, setDraft, onSave, onCancel }) {
  const valid = draft.name.trim() && Number(draft.price) > 0 && Number(draft.qty) > 0;
  const [rohlik, setRohlik] = useState([]);        // výsledky hledání
  const [rohlikLoading, setRohlikLoading] = useState(false);
  const [picked, setPicked] = useState(false);      // po výběru schovat seznam

  // Hledej na Rohlíku podle názvu (s malým zpožděním). Po výběru se nehledá.
  useEffect(() => {
    if (picked) return;
    const q = draft.name.trim();
    if (q.length < 2) { setRohlik([]); setRohlikLoading(false); return; }
    let live = true;
    setRohlikLoading(true);
    const t = setTimeout(() => {
      searchRohlik(q).then((rs) => { if (live) { setRohlik(rs); setRohlikLoading(false); } });
    }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [draft.name, picked]);

  // Po "Přidat ručně" (bez EANu) skoč kurzorem rovnou do názvu.
  const nameRef = useRef(null);
  useEffect(() => { if (!draft.ean) nameRef.current?.focus(); }, []);

  function setName(v) { setPicked(false); setDraft({ ...draft, name: v }); }
  function pick(r) {
    setDraft({ ...draft, name: r.name, price: String(r.price) });
    setPicked(true);
    setRohlik([]);
  }

  return (
    <div style={S.formOverlay} onClick={onCancel}>
    <section style={{ ...S.card, ...S.cardActive, ...S.formBox }} onClick={(e) => e.stopPropagation()}>
      <div style={S.cardTitle}>Naskladnění</div>
      {draft.ean && <div style={S.eanTag}>EAN {draft.ean}</div>}
      <label style={S.label}>Název — piš a vyber z Rohlíku (doplní název i cenu)</label>
      <input ref={nameRef} style={S.input} value={draft.name} placeholder="Kečup Heinz 500g"
        onChange={(e) => setName(e.target.value)} />

      {!picked && rohlikLoading && rohlik.length === 0 && (
        <div style={S.rohlikMuted}>Hledám na Rohlíku…</div>
      )}
      {!picked && rohlik.length > 0 && (
        <div style={S.rohlik}>
          <div style={S.rohlikHead}>
            <span style={S.rohlikTag}>ROHLÍK</span> klepni a doplní se název i cena
          </div>
          {rohlik.map((r) => (
            <button type="button" key={r.id} style={S.rohlikRow} onClick={() => pick(r)}>
              <span style={S.rohlikRowName}>{r.name}{r.amount ? ` · ${r.amount}` : ""}</span>
              <span style={S.rohlikRowPrice}>{KC(r.price)}</span>
            </button>
          ))}
          <div style={S.rohlikNote}>Cena je orientační (za balení na Rohlíku) — po výběru ji můžeš přepsat.</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Kusů</label>
          <input style={S.input} type="number" min="1" value={draft.qty}
            onChange={(e) => setDraft({ ...draft, qty: e.target.value })} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Cena za kus</label>
          <input style={S.input} type="number" min="0" step="0.01" value={draft.price} placeholder="35"
            onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button style={{ ...S.primary, opacity: valid ? 1 : 0.4 }} disabled={!valid}
          onClick={() => onSave({ ...draft, price: Number(draft.price), qty: Number(draft.qty) })}>
          Uložit do skladu
        </button>
        <button style={S.ghost} onClick={onCancel}>Zrušit</button>
      </div>
    </section>
    </div>
  );
}

function SearchBox({ q, setQ, count }) {
  return (
    <div style={S.searchWrap}>
      <span style={S.searchIcon}>🔎</span>
      <input
        style={S.searchInput}
        value={q}
        placeholder="Hledat ve skladu…"
        onChange={(e) => setQ(e.target.value)}
      />
      {q && (
        <button style={S.searchClear} onClick={() => setQ("")} aria-label="Vymazat">
          ✕
        </button>
      )}
      {q.trim() && <span style={S.searchCount}>{count}</span>}
    </div>
  );
}

function Stock({ stock }) {
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");
  const total = stock.reduce((s, x) => s + x.batches.reduce((t, b) => t + b.left * b.price, 0), 0);
  const filtered = q.trim() ? stock.filter((s) => norm(s.name).includes(norm(q))) : stock;
  return (
    <section style={S.card}>
      <div style={S.cardTitle}>Co je teď v samošce</div>
      <div style={S.stockTotal}>Hodnota skladu <b>{KC(total)}</b></div>
      {stock.length > 0 && <SearchBox q={q} setQ={setQ} count={filtered.length} />}
      {stock.length === 0 ? (
        <p style={S.empty}>Prázdno. Až něco přikoupíte, uvidíte to tady.</p>
      ) : filtered.length === 0 ? (
        <p style={S.empty}>Nic ve skladu neodpovídá „{q}".</p>
      ) : filtered.map((s) => (
        <div key={s.ean} style={S.stockItem}>
          <button style={S.stockHead} onClick={() => setOpen(open === s.ean ? null : s.ean)}>
            <span style={S.takeName}>{s.name}</span>
            <span style={S.qtyBadge}>{s.qty}×</span>
          </button>
          {open === s.ean && (
            <div style={S.batchList}>
              {s.batches.slice().sort((a, b) => a.at - b.at).map((b) => (
                <div key={b.id} style={S.batchRow}>
                  <span>{b.left}× po {KC(b.price)}</span>
                  <span style={S.batchBy}>od {b.by}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function Inventura({ stock, onCommit }) {
  const [counts, setCounts] = useState({});   // ean -> zadaný počet (string)
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  // Napočítej manko + jaké šarže odepsat (odběr chybějících kusů = FIFO).
  const { manko, updates } = useMemo(() => {
    let manko = 0;
    const updates = [];
    for (const item of stock) {
      const raw = counts[item.ean];
      const target = raw === undefined || raw === "" ? item.qty : Math.max(0, Number(raw));
      let diff = item.qty - target; // >0 chybí, <0 přebývá
      const bs = item.batches.slice().sort((a, b) => a.at - b.at).map((b) => ({ id: b.id, left: b.left, price: b.price }));
      if (diff > 0) {
        let rem = diff;
        for (const b of bs) {
          if (rem <= 0) break;
          const r = Math.min(rem, b.left);
          manko += r * b.price;
          rem -= r;
          updates.push({ id: b.id, remaining: b.left - r });
        }
      } else if (diff < 0 && bs.length) {
        const nb = bs[bs.length - 1]; // přebytek přičti k nejnovější šarži
        const add = -diff;
        manko -= add * nb.price;
        updates.push({ id: nb.id, remaining: nb.left + add });
      }
    }
    return { manko, updates };
  }, [stock, counts]);

  const bookValue = stock.reduce((s, x) => s + x.batches.reduce((t, b) => t + b.left * b.price, 0), 0);
  const countedValue = bookValue - manko;
  const per = Math.round((manko / (MEMBERS.length || 1)) * 100) / 100;

  async function commit() {
    if (busy) return;
    const msg = manko >= 0
      ? `Zaúčtovat manko ${KC(manko)}? Každému z ${MEMBERS.length} přibude dluh ${KC(per)}. Nejde vzít zpět.`
      : `Přebytek ${KC(-manko)} — každému připíšeme kredit ${KC(-per)}. Zaúčtovat? Nejde vzít zpět.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    await onCommit(updates, manko);
    setBusy(false);
    setDone({ manko, per });
    setCounts({});
  }

  if (stock.length === 0) {
    return (
      <section style={S.card}>
        <div style={S.cardTitle}>Inventura</div>
        <p style={S.empty}>Sklad je prázdný. Nejdřív naskladni věci (přes Naskladnit / Vzít), pak jde dělat inventuru.</p>
      </section>
    );
  }

  return (
    <>
      <section style={S.card}>
        <div style={S.cardTitle}>Inventura — napočítej regál</div>
        <p style={S.cardLead}>U každé věci zadej, kolik jich reálně je. Předvyplněno stavem z appky; přepiš jen rozdíly.</p>
        {stock.map((item) => (
          <div key={item.ean} style={S.invRow}>
            <span style={S.invName}>{item.name}</span>
            <span style={S.invBook}>app {item.qty}×</span>
            <input
              style={S.invInput}
              type="number"
              min="0"
              inputMode="numeric"
              value={counts[item.ean] ?? String(item.qty)}
              onChange={(e) => setCounts((c) => ({ ...c, [item.ean]: e.target.value }))}
            />
          </div>
        ))}
      </section>

      <section style={{ ...S.card, ...S.cardActive }}>
        <div style={S.cardTitle}>Výsledek</div>
        <div style={S.invSum}>
          <div style={S.invSumRow}><span>Hodnota dle appky</span><b>{KC(bookValue)}</b></div>
          <div style={S.invSumRow}><span>Napočítáno</span><b>{KC(countedValue)}</b></div>
          <div style={S.invSumRow}>
            <span>{manko >= 0 ? "Manko (chybí)" : "Přebytek"}</span>
            <b style={{ color: manko >= 0 ? "var(--neg)" : "var(--pos)" }}>{KC(Math.abs(manko))}</b>
          </div>
          <div style={S.invSumRow}>
            <span>Na osobu ({MEMBERS.length})</span>
            <b style={{ color: manko >= 0 ? "var(--neg)" : "var(--pos)" }}>{KC(Math.abs(per))}</b>
          </div>
        </div>
        <p style={S.hint}>
          {manko >= 0
            ? "Manko rozpočítáme jako dluh každému z členů rovným dílem."
            : "Přebytek připíšeme každému jako kredit rovným dílem."}
        </p>
        <button style={{ ...S.primary, opacity: busy ? 0.5 : 1, width: "100%" }} disabled={busy} onClick={commit}>
          {busy ? "Účtuju…" : (manko === 0 ? "Sklad sedí — srovnat" : `Zaúčtovat ${KC(Math.abs(manko))}`)}
        </button>
        {done && (
          <div style={S.invDone}>
            Hotovo — zaúčtováno {KC(Math.abs(done.manko))} ({KC(Math.abs(done.per))}/os).
          </div>
        )}
      </section>
    </>
  );
}

function Balance({ balances, suggestion, me }) {
  const max = Math.max(1, ...balances.map((b) => Math.abs(b.amount)));
  return (
    <section style={S.card}>
      <div style={S.cardTitle}>Kdo je v plusu, kdo v mínusu</div>
      {suggestion && (
        <div style={S.suggest}>
          <b>{suggestion.from}</b> pošle <b>{KC(suggestion.amount)}</b> → <b>{suggestion.to}</b>
        </div>
      )}
      <div style={S.balList}>
        {balances.map((b) => {
          const pos = b.amount >= 0;
          return (
            <div key={b.name} style={{ ...S.balRow, ...(b.name === me ? S.balMe : {}) }}>
              <span style={S.balName}>{b.name}{b.name === me ? " (ty)" : ""}</span>
              <div style={S.balBarWrap}>
                <div style={{ ...S.balBar, width: `${(Math.abs(b.amount) / max) * 50}%`, background: pos ? "var(--pos)" : "var(--neg)", left: pos ? "50%" : "auto", right: pos ? "auto" : "50%" }} />
                <div style={S.balMid} />
              </div>
              <span style={{ ...S.balAmt, color: pos ? "var(--pos)" : "var(--neg)" }}>
                {pos ? "+" : ""}{KC(b.amount)}
              </span>
            </div>
          );
        })}
      </div>
      <p style={S.hint}>Plus = samoška ti dluží (přikoupil jsi víc, než vzal). Mínus = dlužíš samošce.</p>
    </section>
  );
}

// ── Potvrzení odběru ────────────────────────────────────────
function ConfirmTake({ item, onConfirm, onCancel }) {
  const [n, setN] = useState(1);
  const max = item.qty;

  // Přesná cena za n kusů — postupně z nejstarších šarží (FIFO).
  const total = useMemo(() => {
    let left = n, sum = 0;
    for (const b of item.batches) {
      if (left <= 0) break;
      const t = Math.min(left, b.left);
      sum += t * b.price;
      left -= t;
    }
    return sum;
  }, [n, item.batches]);

  const pricey = total >= 500;
  const clamp = (x) => Math.max(1, Math.min(max, x));

  return (
    <div style={S.scanOverlay} onClick={onCancel}>
      <div style={S.confirmBox} onClick={(e) => e.stopPropagation()}>
        <div style={S.confirmKicker}>BEREŠ ZE SAMOŠKY</div>
        <div style={S.confirmName}>{item.name}</div>

        <div style={S.stepRow}>
          <button style={S.stepBtn} onClick={() => setN((x) => clamp(x - 1))} disabled={n <= 1}>−</button>
          <div style={S.stepVal}>{n}<span style={S.stepUnit}>×</span></div>
          <button style={S.stepBtn} onClick={() => setN((x) => clamp(x + 1))} disabled={n >= max}>+</button>
          <button style={S.stepMax} onClick={() => setN(max)}>vše ({max})</button>
        </div>

        <div style={{ ...S.confirmPrice, color: pricey ? "var(--neg)" : "var(--brand-ink)" }}>
          {KC(total)}
        </div>
        <div style={S.confirmMeta}>
          Cena z nejstarších šarží (FIFO) · skladem {max}×
          {pricey && <div style={S.confirmWarn}>⚠️ Dražší nákup — zkontroluj, že bereš tohle.</div>}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button style={{ ...S.primary, flex: 1 }} onClick={() => onConfirm(n)}>
            Vzít {n}× za {KC(total)}
          </button>
          <button style={S.ghost} onClick={onCancel}>Zrušit</button>
        </div>
      </div>
    </div>
  );
}

// ── Scanner (ZXing — Android i iOS) ─────────────────────────
function Scanner({ onScanned, onClose }) {
  const videoRef = useRef(null);
  const [err, setErr] = useState(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls;
    let cancelled = false;
    (async () => {
      try {
        controls = await reader.decodeFromVideoDevice(
          undefined, // default = zadní kamera na mobilu
          videoRef.current,
          (result, e, ctrl) => {
            if (result && !cancelled) {
              cancelled = true;
              ctrl.stop();
              onScanned(result.getText());
            }
          }
        );
      } catch (e) {
        setErr("Nepovedlo se zapnout kameru. Zkontroluj oprávnění v prohlížeči, nebo zadej EAN ručně.");
      }
    })();
    return () => { cancelled = true; try { controls?.stop(); } catch {} };
  }, [onScanned]);

  return (
    <div style={S.scanOverlay}>
      <div style={S.scanBox}>
        <div style={{ position: "relative" }}>
          {!err && <video ref={videoRef} style={S.video} muted playsInline />}
          {!err && <div style={S.scanFrame} />}
          {err && <p style={{ ...S.empty, padding: 20, color: "var(--paper)" }}>{err}</p>}
        </div>
        <div style={{ display: "flex", gap: 8, padding: 12, background: "var(--ink)" }}>
          <input style={{ ...S.input, margin: 0, flex: 1 }} placeholder="EAN ručně…" value={manual}
            onChange={(e) => setManual(e.target.value)} inputMode="numeric" />
          <button style={S.primary} disabled={!manual} onClick={() => onScanned(manual)}>OK</button>
          <button style={S.ghost} onClick={onClose}>Zavřít</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
const CSS = `
:root{
  --paper:#F2EDE4; --panel:#FBF8F2; --ink:#1C1B18; --sub:#6E685C;
  --line:#DAD2C4; --brand:#1F4FD8; --brand-ink:#16308A;
  --pos:#1F7A4D; --neg:#C0392B; --accent:#E8B23A;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--paper)}
#root{min-height:100vh}
input:focus{outline:2px solid var(--brand);outline-offset:1px}
button{cursor:pointer;font-family:inherit}
`;

const mono = "'DM Mono', ui-monospace, 'SF Mono', Menlo, monospace";
const sans = "'Inter', system-ui, -apple-system, sans-serif";

const S = {
  wrap: { fontFamily: sans, background: "var(--paper)", color: "var(--ink)", minHeight: "100vh", maxWidth: 560, margin: "0 auto", display: "flex", flexDirection: "column" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "20px 18px 14px" },
  kicker: { fontFamily: mono, fontSize: 11, letterSpacing: 3, color: "var(--sub)" },
  wordmark: { fontSize: 30, fontWeight: 800, letterSpacing: -1, lineHeight: 1 },
  wordmarkBig: { fontSize: 54, fontWeight: 800, letterSpacing: -2, lineHeight: 1, margin: "6px 0" },
  mePill: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: "7px 12px", color: "var(--ink)" },

  tabs: { display: "flex", gap: 4, padding: "0 12px", borderBottom: "1px solid var(--line)", overflowX: "auto" },
  tab: { flex: "0 0 auto", padding: "12px 10px", background: "none", border: "none", borderBottom: "3px solid transparent", color: "var(--sub)", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" },
  tabOn: { color: "var(--brand-ink)", borderBottom: "3px solid var(--brand)" },

  main: { flex: 1, padding: 14, display: "flex", flexDirection: "column", gap: 14 },
  footer: { fontFamily: mono, fontSize: 10.5, letterSpacing: 0.5, color: "var(--sub)", textAlign: "center", padding: "10px 14px 20px" },

  card: { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, padding: 16 },
  cardActive: { borderColor: "var(--brand)", boxShadow: "0 0 0 3px rgba(31,79,216,.12)" },
  cardTitle: { fontSize: 16, fontWeight: 700, marginBottom: 4 },
  cardLead: { fontSize: 13.5, color: "var(--sub)", margin: "0 0 12px" },

  primary: { background: "var(--brand)", color: "#fff", border: "none", borderRadius: 11, padding: "12px 16px", fontSize: 14.5, fontWeight: 700 },
  ghost: { background: "none", color: "var(--brand-ink)", border: "1px solid var(--line)", borderRadius: 11, padding: "12px 16px", fontSize: 14.5, fontWeight: 600 },

  label: { display: "block", fontFamily: mono, fontSize: 11, letterSpacing: 1, color: "var(--sub)", margin: "12px 0 5px" },
  input: { width: "100%", padding: "11px 12px", fontSize: 15, border: "1px solid var(--line)", borderRadius: 10, background: "#fff", fontFamily: sans },
  eanTag: { fontFamily: mono, fontSize: 12, color: "var(--brand-ink)", background: "rgba(31,79,216,.08)", display: "inline-block", padding: "3px 8px", borderRadius: 6, marginBottom: 4 },

  takeList: { display: "flex", flexDirection: "column", gap: 8 },
  takeRow: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: "1px solid var(--line)", borderRadius: 11, padding: "13px 14px", width: "100%" },
  takeName: { fontSize: 15, fontWeight: 600, textAlign: "left" },
  takeMeta: { display: "flex", alignItems: "center", gap: 10 },
  qtyBadge: { fontFamily: mono, fontSize: 13, fontWeight: 700, background: "var(--ink)", color: "var(--paper)", borderRadius: 6, padding: "2px 7px" },
  takePrice: { fontFamily: mono, fontSize: 14, fontWeight: 700, color: "var(--brand-ink)" },
  hint: { fontSize: 12, color: "var(--sub)", margin: "12px 0 0", lineHeight: 1.4 },
  empty: { fontSize: 13.5, color: "var(--sub)", textAlign: "center", padding: "18px 0", lineHeight: 1.5 },

  invRow: { display: "grid", gridTemplateColumns: "1fr auto 84px", alignItems: "center", gap: 10, padding: "9px 2px", borderTop: "1px solid var(--line)" },
  invName: { fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  invBook: { fontFamily: mono, fontSize: 12, color: "var(--sub)" },
  invInput: { width: "100%", padding: "9px 10px", fontSize: 15, border: "1px solid var(--line)", borderRadius: 9, background: "#fff", fontFamily: mono, textAlign: "center" },
  invSum: { display: "flex", flexDirection: "column", gap: 6, margin: "6px 0 4px" },
  invSumRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14 },
  invDone: { marginTop: 12, background: "rgba(31,122,77,.1)", color: "var(--pos)", borderRadius: 10, padding: "10px 12px", fontSize: 13.5, fontWeight: 600 },

  stockTotal: { fontFamily: mono, fontSize: 13, color: "var(--sub)", marginBottom: 12 },
  stockItem: { borderTop: "1px solid var(--line)", padding: "2px 0" },
  stockHead: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", padding: "13px 2px" },
  batchList: { paddingBottom: 10 },
  batchRow: { display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 13, color: "var(--ink)", padding: "5px 8px", background: "#fff", borderRadius: 7, marginBottom: 5 },
  batchBy: { color: "var(--sub)" },

  suggest: { background: "var(--accent)", color: "var(--ink)", borderRadius: 11, padding: "12px 14px", fontSize: 14.5, marginBottom: 14, lineHeight: 1.5 },
  balList: { display: "flex", flexDirection: "column", gap: 3 },
  balRow: { display: "grid", gridTemplateColumns: "72px 1fr 82px", alignItems: "center", gap: 8, padding: "7px 4px" },
  balMe: { background: "rgba(31,79,216,.06)", borderRadius: 8 },
  balName: { fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  balBarWrap: { position: "relative", height: 16, background: "#fff", border: "1px solid var(--line)", borderRadius: 5, overflow: "hidden" },
  balBar: { position: "absolute", top: 0, bottom: 0, borderRadius: 3 },
  balMid: { position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--line)" },
  balAmt: { fontFamily: mono, fontSize: 13, fontWeight: 700, textAlign: "right" },

  pickerHero: { padding: "40px 22px 20px", textAlign: "center" },
  pickerLead: { fontSize: 15, color: "var(--sub)", marginTop: 10 },
  nameGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "0 18px 30px" },
  nameTile: { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, padding: "22px 10px", fontSize: 17, fontWeight: 700, color: "var(--ink)" },

  scanOverlay: { position: "fixed", inset: 0, background: "rgba(20,18,14,.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 },

  formOverlay: { position: "fixed", inset: 0, background: "rgba(20,18,14,.72)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 60, padding: "20px 14px 40px", overflowY: "auto" },
  formBox: { width: "100%", maxWidth: 520, margin: "auto" },

  confirmBox: { width: "100%", maxWidth: 420, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 18, padding: "22px 20px" },
  confirmKicker: { fontFamily: mono, fontSize: 11, letterSpacing: 2, color: "var(--sub)" },
  confirmName: { fontSize: 22, fontWeight: 800, letterSpacing: -0.5, margin: "6px 0 10px", lineHeight: 1.15 },
  confirmPrice: { fontFamily: mono, fontSize: 34, fontWeight: 800, letterSpacing: -1 },
  confirmMeta: { fontSize: 13, color: "var(--sub)", marginTop: 10, lineHeight: 1.5 },
  confirmWarn: { color: "var(--neg)", fontWeight: 700, marginTop: 8 },

  stepRow: { display: "flex", alignItems: "center", gap: 10, margin: "14px 0 12px" },
  stepBtn: { width: 46, height: 46, borderRadius: 12, border: "1px solid var(--line)", background: "#fff", fontSize: 24, fontWeight: 700, color: "var(--ink)", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  stepVal: { minWidth: 56, textAlign: "center", fontFamily: mono, fontSize: 28, fontWeight: 800 },
  stepUnit: { fontSize: 16, opacity: 0.55, marginLeft: 2 },
  stepMax: { marginLeft: "auto", background: "none", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontSize: 13, fontWeight: 600, color: "var(--brand-ink)" },

  rohlikMuted: { fontFamily: mono, fontSize: 12, color: "var(--sub)", margin: "10px 0" },
  rohlik: { margin: "10px 0", background: "#fff", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 10px 8px" },
  rohlikHead: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--sub)", marginBottom: 8 },
  rohlikTag: { fontFamily: mono, fontSize: 10, fontWeight: 700, letterSpacing: 1, color: "#fff", background: "#00A56C", borderRadius: 5, padding: "2px 6px" },
  rohlikRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 9, padding: "10px 11px", marginBottom: 6, textAlign: "left" },
  rohlikRowName: { fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 },
  rohlikRowPrice: { fontFamily: mono, fontSize: 14, fontWeight: 800, color: "#00794F", whiteSpace: "nowrap" },
  rohlikNote: { fontSize: 11, color: "var(--sub)", marginTop: 4 },

  searchWrap: { position: "relative", display: "flex", alignItems: "center", marginBottom: 12 },
  searchIcon: { position: "absolute", left: 12, fontSize: 14, opacity: 0.6, pointerEvents: "none" },
  searchInput: { width: "100%", padding: "11px 68px 11px 36px", fontSize: 15, border: "1px solid var(--line)", borderRadius: 10, background: "#fff", fontFamily: sans },
  searchClear: { position: "absolute", right: 40, background: "none", border: "none", color: "var(--sub)", fontSize: 15, padding: 4, lineHeight: 1 },
  searchCount: { position: "absolute", right: 12, fontFamily: mono, fontSize: 12, fontWeight: 700, color: "var(--sub)" },
  scanBox: { width: "100%", maxWidth: 460, background: "var(--ink)", borderRadius: 16, overflow: "hidden" },
  video: { width: "100%", height: 300, objectFit: "cover", display: "block", background: "#000" },
  scanFrame: { position: "absolute", top: "50%", left: "12%", right: "12%", height: 110, marginTop: -55, border: "2px solid var(--accent)", borderRadius: 10, pointerEvents: "none" },
};
