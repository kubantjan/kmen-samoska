import React, { useState, useEffect, useRef, useMemo } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";

// ─────────────────────────────────────────────────────────────
// KMEN · SAMOŠKA
// Prototyp bez backendu. Data se ukládají lokálně (localStorage)
// v každém telefonu zvlášť — sdílený stav mezi lidmi přijde až
// s backendem. Slouží k vyzkoušení flow: scan → naskladnit →
// vzít → salda.
// ─────────────────────────────────────────────────────────────

// Členy nastav v `.env` přes VITE_MEMBERS (čárkou oddělená jména).
const MEMBERS = (import.meta.env.VITE_MEMBERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const KC = (n) =>
  new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n) + " Kč";

// ── localStorage persistence ────────────────────────────────
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
      const brand = (j.product.brands || "").split(",")[0]?.trim();
      return [brand, name].filter(Boolean).join(" ").trim() || null;
    }
  } catch (e) { /* offline / not found */ }
  return null;
}

export default function App() {
  const [me, setMe] = useState(() => load("me", null));
  const [tab, setTab] = useState("shop");
  const [products, setProducts] = useState(() => load("products", {}));
  const [batches, setBatches] = useState(() => load("batches", []));
  const [ledger, setLedger] = useState(() => load("ledger", []));

  useEffect(() => save("me", me), [me]);
  useEffect(() => save("products", products), [products]);
  useEffect(() => save("batches", batches), [batches]);
  useEffect(() => save("ledger", ledger), [ledger]);

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

  function addBatch(ean, name, qty, price) {
    setProducts((p) => ({ ...p, [ean]: { ean, name } }));
    setBatches((bs) => [
      ...bs,
      { id: crypto.randomUUID(), ean, by: me, qty, left: qty, price, at: Date.now() },
    ]);
  }

  function take(ean) {
    const b = batches.filter((x) => x.ean === ean && x.left > 0).sort((a, b) => a.at - b.at)[0];
    if (!b) return;
    setBatches((bs) => bs.map((x) => (x.id === b.id ? { ...x, left: x.left - 1 } : x)));
    setLedger((lg) => [...lg, { id: crypto.randomUUID(), ean, by: me, price: b.price, at: Date.now() }]);
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
        {[["shop", "Naskladnit / Vzít"], ["stock", "Sklad"], ["balance", "Kdo komu"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.tab, ...(tab === k ? S.tabOn : {}) }}>
            {label}
          </button>
        ))}
      </nav>

      <main style={S.main}>
        {tab === "shop" && <Shop stock={stock} onStock={addBatch} onTake={take} />}
        {tab === "stock" && <Stock stock={stock} />}
        {tab === "balance" && <Balance balances={balances} suggestion={suggestion} me={me} />}
      </main>

      <footer style={S.footer}>
        Prototyp · data jsou uložená jen v tomhle telefonu (localStorage)
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
  const [scanning, setScanning] = useState(false);
  const [draft, setDraft] = useState(null);

  function onScanned(ean) {
    setScanning(false);
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
          <button style={S.primary} onClick={() => setScanning(true)}>📷 Skenovat kód</button>
          <button style={S.ghost} onClick={() => setDraft({ ean: "", name: "", qty: 1, price: "" })}>
            Přidat ručně
          </button>
        </div>
      </section>

      {scanning && <Scanner onScanned={onScanned} onClose={() => setScanning(false)} />}

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
        {stock.length === 0 ? (
          <p style={S.empty}>Sklad je zatím prázdný. Něco přikup a objeví se to tady.</p>
        ) : (
          <div style={S.takeList}>
            {stock.map((s) => {
              const next = s.batches.slice().sort((a, b) => a.at - b.at)[0];
              return (
                <button key={s.ean} style={S.takeRow} onClick={() => onTake(s.ean)}>
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
        <p style={S.hint}>Klepnutím si vezmeš 1 kus za cenu nejstaršího naskladněného (FIFO).</p>
      </section>
    </>
  );
}

function StockForm({ draft, setDraft, onSave, onCancel }) {
  const valid = draft.name.trim() && Number(draft.price) > 0 && Number(draft.qty) > 0;
  return (
    <section style={{ ...S.card, ...S.cardActive }}>
      <div style={S.cardTitle}>Naskladnění</div>
      {draft.ean && <div style={S.eanTag}>EAN {draft.ean}</div>}
      <label style={S.label}>Název</label>
      <input style={S.input} value={draft.name} placeholder="Kečup Heinz 500g"
        onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
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
  );
}

function Stock({ stock }) {
  const [open, setOpen] = useState(null);
  const total = stock.reduce((s, x) => s + x.batches.reduce((t, b) => t + b.left * b.price, 0), 0);
  return (
    <section style={S.card}>
      <div style={S.cardTitle}>Co je teď v samošce</div>
      <div style={S.stockTotal}>Hodnota skladu <b>{KC(total)}</b></div>
      {stock.length === 0 ? (
        <p style={S.empty}>Prázdno. Až něco přikoupíte, uvidíte to tady.</p>
      ) : stock.map((s) => (
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

  tabs: { display: "flex", gap: 6, padding: "0 14px", borderBottom: "1px solid var(--line)" },
  tab: { flex: 1, padding: "12px 4px", background: "none", border: "none", borderBottom: "3px solid transparent", color: "var(--sub)", fontSize: 14, fontWeight: 600 },
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
  scanBox: { width: "100%", maxWidth: 460, background: "var(--ink)", borderRadius: 16, overflow: "hidden" },
  video: { width: "100%", height: 300, objectFit: "cover", display: "block", background: "#000" },
  scanFrame: { position: "absolute", top: "50%", left: "12%", right: "12%", height: 110, marginTop: -55, border: "2px solid var(--accent)", borderRadius: 10, pointerEvents: "none" },
};
