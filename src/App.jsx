import { useState, useEffect, useCallback } from "react";

// ── constants ──────────────────────────────────────────────────────────────
const CATEGORIES = [
  { name: "Housing",      icon: "🏠", color: "#4ade80" },
  { name: "Food & Dining",icon: "🍽️", color: "#fb923c" },
  { name: "Groceries",    icon: "🛒", color: "#facc15" },
  { name: "Transport",    icon: "🚗", color: "#60a5fa" },
  { name: "Subscriptions",icon: "📱", color: "#c084fc" },
  { name: "Shopping",     icon: "🛍️", color: "#f472b6" },
  { name: "Health",       icon: "💊", color: "#34d399" },
  { name: "Entertainment",icon: "🎬", color: "#f87171" },
  { name: "Utilities",    icon: "⚡", color: "#38bdf8" },
  { name: "Pets",         icon: "🐾", color: "#fb7185" },
  { name: "Student Loan", icon: "🎓", color: "#a78bfa" },
  { name: "Savings",      icon: "💰", color: "#a3e635" },
  { name: "Income",       icon: "💵", color: "#4ade80" },
  { name: "Other",        icon: "📦", color: "#94a3b8" },
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const NOW = new Date();
const CURRENT_MONTH = NOW.getMonth();
const CURRENT_YEAR  = NOW.getFullYear();

// ── helpers ────────────────────────────────────────────────────────────────
const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;

function lsGet(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
function lsSet(k, v)  { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

function parseTransactions(raw) {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const parts = line.split(/\t|,|\|{2,}|\s{2,}/).map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    let amount = null, amountIdx = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      const cleaned = parts[i].replace(/[$,()]/g, "");
      if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
        amount = parseFloat(cleaned);
        if (parts[i].includes("(")) amount = -Math.abs(amount);
        amountIdx = i; break;
      }
    }
    if (amount === null) continue;
    let date = "", dateIdx = -1;
    for (let i = 0; i < parts.length; i++) {
      if (/\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?/.test(parts[i]) || /\d{4}-\d{2}-\d{2}/.test(parts[i])) {
        date = parts[i]; dateIdx = i; break;
      }
    }
    const desc = parts.filter((_, i) => i !== amountIdx && i !== dateIdx).join(" ").replace(/\s+/g, " ").trim();
    if (!desc && !date) continue;
    out.push({ id: Math.random().toString(36).slice(2), date, description: desc, amount, category: "Other", account: "" });
  }
  return out;
}

function guessCategory(d) {
  d = d.toLowerCase();
  if (/salary|payroll|direct dep|zelle from|venmo from|transfer in/.test(d)) return "Income";
  if (/rent|mortgage|hoa|apartment/.test(d)) return "Housing";
  if (/uber eats|doordash|grubhub|seamless|postmates|chipotle|mcdonald|starbucks|dunkin|restaurant|dining|pizza|sushi|taco|burger|cafe|diner|panera/.test(d)) return "Food & Dining";
  if (/walmart|target|kroger|safeway|trader joe|whole foods|aldi|costco|grocery|food lion|publix|market/.test(d)) return "Groceries";
  if (/uber|lyft|metro|subway|transit|gas station|shell|bp|exxon|chevron|parking|toll|amtrak|airline|delta|southwest|united/.test(d)) return "Transport";
  if (/netflix|spotify|hulu|disney|amazon prime|apple.*sub|youtube|hbo|peacock|paramount|subscription/.test(d)) return "Subscriptions";
  if (/amazon|ebay|etsy|zara|h&m|gap|nordstrom|macy|walmart\.com|best buy|apple store|shopping|clothing|fashion/.test(d)) return "Shopping";
  if (/cvs|walgreens|pharmacy|hospital|clinic|doctor|dental|medical|health|gym|fitness|yoga/.test(d)) return "Health";
  if (/movie|cinema|amc|regal|concert|ticketmaster|stubhub|game|steam|playstation|xbox|entertainment/.test(d)) return "Entertainment";
  if (/electric|gas bill|water bill|internet|comcast|at&t|verizon|t-mobile|utility/.test(d)) return "Utilities";
  if (/petco|petsmart|vet |veterinary|chewy|pet supply|pet food|banfield|pet insurance/.test(d)) return "Pets";
  if (/student loan|sallie mae|navient|fedloan|mohela|great lakes|nelnet|student debt/.test(d)) return "Student Loan";
  if (/transfer to savings|savings deposit|investment|vanguard|fidelity|robinhood|schwab/.test(d)) return "Savings";
  return "Other";
}

// ── API calls ──────────────────────────────────────────────────────────────
const isExternal = (() => { try { return !window.location.hostname.includes("claude.ai") && !window.location.hostname.includes("anthropic.com"); } catch { return false; } })();
const CLAUDE_URL = isExternal ? "/api/claude" : "https://api.anthropic.com/v1/messages";
const DATA_URL   = "/api/data";

async function dbGet(key) {
  try {
    const r = await fetch(`${DATA_URL}?action=get&key=${encodeURIComponent(key)}`);
    const j = await r.json();
    return j.data ?? null;
  } catch { return null; }
}

async function dbSet(key, value) {
  try {
    await fetch(DATA_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set", key, value }) });
  } catch {}
}

async function dbKeys(prefix) {
  try {
    const r = await fetch(`${DATA_URL}?action=keys&key=${encodeURIComponent(prefix)}`);
    const j = await r.json();
    return j.keys ?? [];
  } catch { return []; }
}

async function aiCategorize(transactions, apiKey) {
  const toClassify = transactions.filter(t => t.category === "Other").slice(0, 50);
  if (!toClassify.length) return transactions;
  const list = toClassify.map((t, i) => `${i}. "${t.description}" amount:${t.amount}`).join("\n");
  const catNames = CATEGORIES.map(c => c.name).join(", ");
  const prompt = `Categorize these bank transactions. Reply ONLY with a JSON array: [{"index":0,"category":"Food & Dining"},...].
Categories: ${catNames}

Transactions:
${list}`;
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(CLAUDE_URL, { method: "POST", headers, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }) });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.content?.find(b => b.type === "text")?.text || "[]";
  const results = JSON.parse(text.replace(/```json|```/g, "").trim());
  const updated = [...transactions];
  for (const r of results) {
    const tx = toClassify[r.index];
    if (tx && CATEGORIES.find(c => c.name === r.category)) {
      const idx = updated.findIndex(t => t.id === tx.id);
      if (idx !== -1) updated[idx] = { ...updated[idx], category: r.category };
    }
  }
  return updated;
}

async function aiInsights(transactions, budgets, apiKey) {
  const income = transactions.filter(t => t.category === "Income" && t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const summary = CATEGORIES.filter(c => c.name !== "Income").map(c => {
    const spent = transactions.filter(t => t.category === c.name && t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    return `${c.name}: $${spent.toFixed(2)} spent, budget $${budgets[c.name] || 0}`;
  }).join("\n");
  const prompt = `You are a tough-love financial advisor. Monthly household spending:
Income: $${income.toFixed(2)}
${summary}
Give 4 sharp, specific, actionable insights to maximize savings. JSON: [{"title":"...","detail":"...","severity":"high|medium|low"}]`;
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(CLAUDE_URL, { method: "POST", headers, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 800, messages: [{ role: "user", content: prompt }] }) });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.content?.find(b => b.type === "text")?.text || "[]";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ── main component ─────────────────────────────────────────────────────────
export default function BudgetTracker() {

  // ── settings (persisted locally + synced) ─────────────────────────────
  const [spouse1Name, setSpouse1Name] = useState(() => lsGet("bt_s1name", "Person 1"));
  const [spouse2Name, setSpouse2Name] = useState(() => lsGet("bt_s2name", "Person 2"));
  const [budgets,     setBudgets]     = useState(() => lsGet("bt_budgets", {}));
  const [savingsGoal, setSavingsGoal] = useState(() => lsGet("bt_goal", 1000));
  const [apiKey,      setApiKey]      = useState(() => { try { return localStorage.getItem("budget_anthropic_key") || ""; } catch { return ""; } });

  // ── per-person accounts (statement paste boxes, not persisted — ephemeral) ─
  const [accounts, setAccounts] = useState([
    { id: "a1", name: "My Checking",      owner: "s1", raw: "", color: "#60a5fa" },
    { id: "a2", name: "My Credit Card",   owner: "s1", raw: "", color: "#4ade80" },
    { id: "a3", name: "Spouse Checking",  owner: "s2", raw: "", color: "#fb923c" },
    { id: "a4", name: "Spouse Credit",    owner: "s2", raw: "", color: "#c084fc" },
  ]);

  // ── UI state ───────────────────────────────────────────────────────────
  const [tab,           setTab]           = useState("dashboard");
  const [activeView,    setActiveView]    = useState("household"); // household | s1 | s2
  const [selMonth,      setSelMonth]      = useState(CURRENT_MONTH);
  const [selYear,       setSelYear]       = useState(CURRENT_YEAR);
  const [loading,       setLoading]       = useState(false);
  const [syncing,       setSyncing]       = useState(false);
  const [syncStatus,    setSyncStatus]    = useState(""); // "", "saved", "error"
  const [insights,      setInsights]      = useState([]);
  const [insightsLoad,  setInsightsLoad]  = useState(false);
  const [filterCat,     setFilterCat]     = useState("All");
  const [sortField,     setSortField]     = useState("date");
  const [apiKeyInput,   setApiKeyInput]   = useState("");
  const [showApiTxt,    setShowApiTxt]    = useState(false);
  const [apiError,      setApiError]      = useState("");
  const [showApiPanel,  setShowApiPanel]  = useState(false);
  const [showSettings,  setShowSettings]  = useState(false);
  const [newAccName,    setNewAccName]    = useState("");
  const [newAccOwner,   setNewAccOwner]   = useState("s1");
  const [showAddAcc,    setShowAddAcc]    = useState(false);
  const [availMonths,   setAvailMonths]   = useState([]);

  // transactions stored as: { [monthKey]: Transaction[] }
  const [txMap, setTxMap] = useState({});

  const mk = monthKey(selYear, selMonth);

  // transactions for current view
  const allMonthTx  = txMap[mk] || [];
  const transactions = activeView === "household" ? allMonthTx
    : allMonthTx.filter(t => t.owner === activeView);

  // ── load data from DB on mount ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setSyncing(true);
      try {
        const keys = await dbKeys("bt_tx_");
        const months = keys.map(k => k.replace("bt_tx_", "")).sort().reverse();
        setAvailMonths(months);
        // load current month
        const data = await dbGet(`bt_tx_${mk}`);
        if (data) setTxMap(prev => ({ ...prev, [mk]: data }));
        // load settings
        const settings = await dbGet("bt_settings");
        if (settings) {
          if (settings.spouse1Name) setSpouse1Name(settings.spouse1Name);
          if (settings.spouse2Name) setSpouse2Name(settings.spouse2Name);
          if (settings.budgets)     setBudgets(settings.budgets);
          if (settings.savingsGoal) setSavingsGoal(settings.savingsGoal);
        }
      } catch {}
      setSyncing(false);
    })();
  }, []);

  // load month data when month changes
  useEffect(() => {
    (async () => {
      if (txMap[mk]) return; // already loaded
      setSyncing(true);
      const data = await dbGet(`bt_tx_${mk}`);
      if (data) setTxMap(prev => ({ ...prev, [mk]: data }));
      setSyncing(false);
    })();
  }, [mk]);

  // persist locally
  useEffect(() => { lsSet("bt_s1name", spouse1Name); }, [spouse1Name]);
  useEffect(() => { lsSet("bt_s2name", spouse2Name), lsSet("bt_budgets", budgets); }, [spouse2Name, budgets]);
  useEffect(() => { lsSet("bt_goal", savingsGoal); }, [savingsGoal]);

  // sync transactions to DB
  const syncTx = useCallback(async (key, data) => {
    setSyncStatus("");
    try {
      await dbSet(`bt_tx_${key}`, data);
      setAvailMonths(prev => prev.includes(key) ? prev : [key, ...prev].sort().reverse());
      setSyncStatus("saved");
      setTimeout(() => setSyncStatus(""), 2500);
    } catch { setSyncStatus("error"); }
  }, []);

  // sync settings to DB
  const syncSettings = useCallback(async (overrides = {}) => {
    await dbSet("bt_settings", { spouse1Name, spouse2Name, budgets, savingsGoal, ...overrides });
  }, [spouse1Name, spouse2Name, budgets, savingsGoal]);

  function updateTx(newList) {
    setTxMap(prev => ({ ...prev, [mk]: newList }));
    syncTx(mk, newList);
  }

  // ── derived stats ──────────────────────────────────────────────────────
  function statsFor(txList) {
    const inc   = txList.filter(t => t.category === "Income" && t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const spent = txList.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const net   = inc - spent;
    const rate  = inc > 0 ? ((net / inc) * 100).toFixed(1) : "0.0";
    return { inc, spent, net, rate };
  }

  const householdStats = statsFor(allMonthTx);
  const s1Stats        = statsFor(allMonthTx.filter(t => t.owner === "s1"));
  const s2Stats        = statsFor(allMonthTx.filter(t => t.owner === "s2"));
  const viewStats      = activeView === "household" ? householdStats : activeView === "s1" ? s1Stats : s2Stats;

  function catSpend(txList) {
    return CATEGORIES.filter(c => c.name !== "Income").map(c => ({
      ...c,
      spent:     txList.filter(t => t.category === c.name && t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
      spentS1:   allMonthTx.filter(t => t.owner === "s1" && t.category === c.name && t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
      spentS2:   allMonthTx.filter(t => t.owner === "s2" && t.category === c.name && t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
      budgetAmt: budgets[c.name] || 0,
    }));
  }

  const spendByCategory = catSpend(transactions);

  // month-over-month comparison
  function prevMonthKey() {
    if (selMonth === 0) return monthKey(selYear - 1, 11);
    return monthKey(selYear, selMonth - 1);
  }
  const prevTx    = txMap[prevMonthKey()] || [];
  const prevStats = statsFor(prevTx);

  // ── parse & categorize ─────────────────────────────────────────────────
  async function handleParse(accId) {
    const acc = accounts.find(a => a.id === accId);
    if (!acc?.raw.trim()) return;
    if (isExternal && !apiKey) { setApiError("Set your Anthropic API key first."); setShowApiPanel(true); return; }
    setApiError("");
    setLoading(true);
    try {
      let parsed = parseTransactions(acc.raw);
      parsed = parsed.map(t => ({ ...t, account: acc.name, owner: acc.owner, monthKey: mk, category: guessCategory(t.description) }));
      parsed = await aiCategorize(parsed, isExternal ? apiKey : "");
      const existing = (txMap[mk] || []).filter(t => t.account !== acc.name);
      const newList  = [...existing, ...parsed];
      updateTx(newList);
    } catch (e) { setApiError("AI categorization failed: " + (e.message || "Check your API key.")); }
    setLoading(false);
  }

  async function fetchInsights() {
    if (isExternal && !apiKey) { setApiError("Set your API key first."); setShowApiPanel(true); return; }
    setApiError("");
    setInsightsLoad(true);
    try {
      const ins = await aiInsights(allMonthTx, budgets, isExternal ? apiKey : "");
      setInsights(ins);
    } catch (e) { setApiError("Insights failed: " + (e.message || "Check your API key.")); }
    setInsightsLoad(false);
  }

  const filteredTx = transactions
    .filter(t => filterCat === "All" || t.category === filterCat)
    .sort((a, b) => {
      if (sortField === "amount")   return a.amount - b.amount;
      if (sortField === "category") return a.category.localeCompare(b.category);
      if (sortField === "owner")    return (a.owner || "").localeCompare(b.owner || "");
      return (a.date || "").localeCompare(b.date || "");
    });

  const ownerLabel = o => o === "s1" ? spouse1Name : o === "s2" ? spouse2Name : "—";
  const ownerColor = o => o === "s1" ? "#60a5fa" : "#fb923c";

  const TABS = [
    { id: "dashboard",    label: "Dashboard",    icon: "◈" },
    { id: "statements",   label: "Statements",   icon: "⊞" },
    { id: "transactions", label: "Transactions", icon: "≡" },
    { id: "budgets",      label: "Budgets",      icon: "◎" },
    { id: "savings",      label: "Savings Plan", icon: "◆" },
  ];

  const yearOptions = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

  // ── render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'DM Mono','Fira Code',monospace", background: "#0a0a0f", minHeight: "100vh", color: "#e2e8f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#111}::-webkit-scrollbar-thumb{background:#333;border-radius:2px}
        input,textarea,select{background:#13131a;border:1px solid #2a2a3a;color:#e2e8f0;border-radius:6px;padding:8px 12px;font-family:inherit;font-size:13px;outline:none;transition:border-color .2s}
        input:focus,textarea:focus,select:focus{border-color:#4ade80}
        button{cursor:pointer;font-family:inherit;transition:all .15s}
        .tab-btn{background:none;border:none;color:#64748b;padding:10px 18px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;border-bottom:2px solid transparent;display:flex;align-items:center;gap:6px;white-space:nowrap}
        .tab-btn:hover{color:#94a3b8}.tab-btn.active{color:#4ade80;border-bottom-color:#4ade80}
        .view-btn{background:none;border:1px solid #2a2a3a;color:#475569;padding:6px 14px;font-size:11px;border-radius:99px;letter-spacing:.05em}
        .view-btn:hover{border-color:#4ade80;color:#94a3b8}.view-btn.active{background:#0f1f0f;border-color:#4ade80;color:#4ade80}
        .card{background:#13131a;border:1px solid #1e1e2e;border-radius:12px;padding:20px}
        .pill{display:inline-block;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:500}
        .metric-val{font-family:'Syne',sans-serif;font-size:26px;font-weight:800}
        .metric-label{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#475569;margin-top:2px}
        .bar-bg{background:#1e1e2e;border-radius:4px;height:8px;overflow:hidden}
        .bar-fill{height:100%;border-radius:4px;transition:width .5s ease}
        .tx-row{display:grid;grid-template-columns:75px 90px 1fr 130px 85px 30px;gap:6px;align-items:center;padding:9px 12px;border-radius:8px;border-bottom:1px solid #1a1a28;font-size:12px}
        .tx-row:hover{background:#16161f}
        .btn-primary{background:#4ade80;color:#0a0a0f;border:none;padding:8px 18px;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:.05em}
        .btn-primary:hover{background:#86efac}
        .btn-ghost{background:none;border:1px solid #2a2a3a;color:#94a3b8;padding:7px 14px;border-radius:6px;font-size:12px}
        .btn-ghost:hover{border-color:#4ade80;color:#4ade80}
        .insight-card{border-radius:10px;padding:16px;margin-bottom:10px;border-left:3px solid}
        select option{background:#13131a}
        .glow{box-shadow:0 0 20px rgba(74,222,128,.15)}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      {/* ── header ── */}
      <div style={{ background: "#0d0d14", borderBottom: "1px solid #1e1e2e", padding: "0 24px" }}>
        <div style={{ maxWidth: 1160, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 16, paddingBottom: 10 }}>
            {/* logo */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, color: "#4ade80" }}>BUDGET</span>
              <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 300, color: "#475569" }}>TRACKER</span>
              <span style={{ width: 6, height: 6, background: "#4ade80", borderRadius: "50%", display: "inline-block", marginLeft: 4, animation: "pulse 2s infinite" }} />
              {syncing && <span style={{ fontSize: 10, color: "#475569", marginLeft: 6 }}>syncing…</span>}
              {syncStatus === "saved" && <span style={{ fontSize: 10, color: "#4ade80", marginLeft: 6 }}>✓ saved</span>}
            </div>

            {/* right controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* month/year picker */}
              <select value={selMonth} onChange={e => setSelMonth(+e.target.value)} style={{ fontSize: 11, padding: "4px 8px" }}>
                {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <select value={selYear} onChange={e => setSelYear(+e.target.value)} style={{ fontSize: 11, padding: "4px 8px" }}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              {/* settings */}
              <button onClick={() => setShowSettings(p => !p)} className="btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }}>⚙ Settings</button>
              {/* api key (external only) */}
              {isExternal && (
                <button onClick={() => setShowApiPanel(p => !p)} style={{ background: apiKey ? "#0a1a0a" : "#1a0a0a", border: `1px solid ${apiKey ? "#4ade80" : "#f87171"}`, color: apiKey ? "#4ade80" : "#f87171", borderRadius: 6, padding: "5px 10px", fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
                  🔑 {apiKey ? "API Key ✓" : "Set API Key"}
                </button>
              )}
            </div>
          </div>

          {/* view switcher */}
          <div style={{ display: "flex", gap: 6, paddingBottom: 10, alignItems: "center" }}>
            {[
              { id: "household", label: "🏡 Household" },
              { id: "s1",        label: `👤 ${spouse1Name}` },
              { id: "s2",        label: `👤 ${spouse2Name}` },
            ].map(v => (
              <button key={v.id} className={`view-btn${activeView === v.id ? " active" : ""}`} onClick={() => setActiveView(v.id)}>{v.label}</button>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", gap: 0, overflowX: "auto" }}>
              {TABS.map(t => (
                <button key={t.id} className={`tab-btn${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
                  <span>{t.icon}</span>{t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── settings panel ── */}
      {showSettings && (
        <div style={{ background: "#0d0d14", borderBottom: "1px solid #1e1e2e" }}>
          <div style={{ maxWidth: 1160, margin: "0 auto", padding: "16px 24px" }}>
            <div className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".05em" }}>Person 1 Name</div>
                <input value={spouse1Name} onChange={e => setSpouse1Name(e.target.value)} onBlur={() => syncSettings({ spouse1Name })} style={{ width: "100%" }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".05em" }}>Person 2 Name</div>
                <input value={spouse2Name} onChange={e => setSpouse2Name(e.target.value)} onBlur={() => syncSettings({ spouse2Name })} style={{ width: "100%" }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".05em" }}>Monthly Savings Goal ($)</div>
                <input type="number" value={savingsGoal} onChange={e => setSavingsGoal(+e.target.value)} onBlur={() => syncSettings({ savingsGoal: +savingsGoal })} style={{ width: "100%" }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── api key panel ── */}
      {showApiPanel && isExternal && (
        <div style={{ background: "#0d0d14", borderBottom: "1px solid #1e1e2e" }}>
          <div style={{ maxWidth: 1160, margin: "0 auto", padding: "16px 24px" }}>
            <div className="card">
              <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 6 }}>🔑 Anthropic API Key</div>
              <div style={{ fontSize: 12, color: "#475569", marginBottom: 12 }}>Required for AI categorization. Get yours at <span style={{ color: "#60a5fa" }}>console.anthropic.com</span>. Stored only in your browser.</div>
              {apiKey && <div style={{ fontSize: 12, color: "#4ade80", marginBottom: 10 }}>✓ Key saved: <span style={{ color: "#64748b" }}>sk-ant-...{apiKey.slice(-6)}</span> <button onClick={() => { setApiKey(""); try { localStorage.removeItem("budget_anthropic_key"); } catch {} }} style={{ background: "none", border: "1px solid #5a1111", color: "#f87171", borderRadius: 4, padding: "2px 8px", fontSize: 11, marginLeft: 8 }}>Remove</button></div>}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <input type={showApiTxt ? "text" : "password"} placeholder="sk-ant-api03-..." value={apiKeyInput} onChange={e => setApiKeyInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { const k = apiKeyInput.trim(); setApiKey(k); try { localStorage.setItem("budget_anthropic_key", k); } catch {} setApiKeyInput(""); setShowApiPanel(false); } }} style={{ width: "100%", paddingRight: 36 }} />
                  <button onClick={() => setShowApiTxt(p => !p)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#475569", fontSize: 14 }}>{showApiTxt ? "🙈" : "👁"}</button>
                </div>
                <button className="btn-primary" onClick={() => { const k = apiKeyInput.trim(); if (!k) return; setApiKey(k); try { localStorage.setItem("budget_anthropic_key", k); } catch {} setApiKeyInput(""); setShowApiPanel(false); setApiError(""); }} disabled={!apiKeyInput.trim()}>Save Key</button>
                <button className="btn-ghost" onClick={() => setShowApiPanel(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "20px 24px" }}>

        {/* error banner */}
        {apiError && (
          <div style={{ background: "#1a0808", border: "1px solid #5a1111", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "#f87171", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>⚠ {apiError}</span>
            <button onClick={() => setApiError("")} style={{ background: "none", border: "none", color: "#f87171", fontSize: 16 }}>×</button>
          </div>
        )}

        {/* ── DASHBOARD ── */}
        {tab === "dashboard" && (
          <div>
            {/* top metrics — household */}
            {activeView === "household" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr) repeat(2, 1fr)", gap: 12, marginBottom: 16 }}>
                {[
                  { label: "Household Income", val: `$${householdStats.inc.toLocaleString("en",{minimumFractionDigits:2})}`, color: "#4ade80" },
                  { label: "Total Spent",       val: `$${householdStats.spent.toLocaleString("en",{minimumFractionDigits:2})}`, color: "#f87171" },
                  { label: "Net Remaining",     val: `$${householdStats.net.toLocaleString("en",{minimumFractionDigits:2})}`,  color: householdStats.net >= 0 ? "#4ade80" : "#f87171" },
                  { label: `${spouse1Name} Rate`, val: `${s1Stats.rate}%`, color: +s1Stats.rate >= 20 ? "#4ade80" : "#facc15", sub: spouse1Name },
                  { label: `${spouse2Name} Rate`, val: `${s2Stats.rate}%`, color: +s2Stats.rate >= 20 ? "#4ade80" : "#facc15", sub: spouse2Name },
                ].map(m => (
                  <div key={m.label} className="card" style={{ position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: m.color, opacity: .7 }} />
                    <div className="metric-label">{m.label}</div>
                    <div className="metric-val" style={{ color: m.color, marginTop: 6 }}>{m.val}</div>
                  </div>
                ))}
              </div>
            )}

            {/* individual view metrics */}
            {activeView !== "household" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
                {[
                  { label: "Income",        val: `$${viewStats.inc.toLocaleString("en",{minimumFractionDigits:2})}`,   color: "#4ade80" },
                  { label: "Total Spent",   val: `$${viewStats.spent.toLocaleString("en",{minimumFractionDigits:2})}`, color: "#f87171" },
                  { label: "Net",           val: `$${viewStats.net.toLocaleString("en",{minimumFractionDigits:2})}`,   color: viewStats.net >= 0 ? "#4ade80" : "#f87171" },
                  { label: "Savings Rate",  val: `${viewStats.rate}%`, color: +viewStats.rate >= 20 ? "#4ade80" : +viewStats.rate >= 10 ? "#facc15" : "#f87171" },
                ].map(m => (
                  <div key={m.label} className="card" style={{ position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: m.color, opacity: .7 }} />
                    <div className="metric-label">{m.label}</div>
                    <div className="metric-val" style={{ color: m.color, marginTop: 6 }}>{m.val}</div>
                  </div>
                ))}
              </div>
            )}

            {/* savings goal */}
            <div className="card glow" style={{ marginBottom: 16, borderColor: "#1a2a1a" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#4ade80", letterSpacing: ".05em" }}>◆ HOUSEHOLD SAVINGS GOAL</div>
                <div style={{ fontSize: 11, color: "#475569" }}>Goal: <span style={{ color: "#e2e8f0" }}>${savingsGoal.toLocaleString()}/mo</span>
                  {prevStats.net !== 0 && <span style={{ marginLeft: 12, color: householdStats.net > prevStats.net ? "#4ade80" : "#f87171" }}>
                    {householdStats.net > prevStats.net ? "▲" : "▼"} vs last month
                  </span>}
                </div>
              </div>
              <div className="bar-bg" style={{ height: 12 }}>
                <div className="bar-fill" style={{ width: `${Math.min(100, Math.max(0, (householdStats.net / savingsGoal) * 100))}%`, background: "linear-gradient(90deg,#16a34a,#4ade80)" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "#475569" }}>
                <span>${Math.max(0, householdStats.net).toFixed(0)} saved</span>
                <span>{savingsGoal > 0 ? `${Math.min(100, Math.max(0, (householdStats.net / savingsGoal) * 100)).toFixed(0)}%` : "—"}</span>
                <span>${savingsGoal} goal</span>
              </div>
            </div>

            {/* category breakdown + who spent what */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="card">
                <div style={{ fontSize: 11, letterSpacing: ".1em", color: "#475569", marginBottom: 14, textTransform: "uppercase" }}>
                  Spending by Category {activeView !== "household" && `— ${ownerLabel(activeView)}`}
                </div>
                {spendByCategory.filter(c => c.spent > 0).sort((a, b) => b.spent - a.spent).map(c => (
                  <div key={c.name} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                      <span>{c.icon} {c.name}</span>
                      <span style={{ color: c.budgetAmt > 0 && c.spent > c.budgetAmt ? "#f87171" : "#94a3b8" }}>
                        ${c.spent.toFixed(2)}{c.budgetAmt > 0 ? ` / $${c.budgetAmt}` : ""}
                      </span>
                    </div>
                    {/* stacked bar: s1 vs s2 in household view */}
                    {activeView === "household" ? (
                      <div className="bar-bg">
                        <div style={{ display: "flex", height: "100%" }}>
                          <div style={{ width: `${c.budgetAmt > 0 ? Math.min(100, (c.spentS1 / c.budgetAmt) * 100) : 0}%`, background: "#60a5fa", borderRadius: "4px 0 0 4px", transition: "width .5s" }} />
                          <div style={{ width: `${c.budgetAmt > 0 ? Math.min(100 - Math.min(100, (c.spentS1 / c.budgetAmt) * 100), (c.spentS2 / c.budgetAmt) * 100) : 0}%`, background: "#fb923c", borderRadius: "0 4px 4px 0", transition: "width .5s" }} />
                        </div>
                      </div>
                    ) : (
                      <div className="bar-bg">
                        <div className="bar-fill" style={{ width: c.budgetAmt > 0 ? `${Math.min(100, (c.spent / c.budgetAmt) * 100)}%` : "0%", background: c.budgetAmt > 0 && c.spent > c.budgetAmt ? "#f87171" : c.color }} />
                      </div>
                    )}
                    {/* per-person amounts in household view */}
                    {activeView === "household" && (c.spentS1 > 0 || c.spentS2 > 0) && (
                      <div style={{ display: "flex", gap: 12, marginTop: 3, fontSize: 10, color: "#475569" }}>
                        <span style={{ color: "#60a5fa" }}>{spouse1Name}: ${c.spentS1.toFixed(2)}</span>
                        <span style={{ color: "#fb923c" }}>{spouse2Name}: ${c.spentS2.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                ))}
                {spendByCategory.filter(c => c.spent > 0).length === 0 && (
                  <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: "20px 0" }}>No transactions yet — paste statements in the Statements tab</div>
                )}
                {/* legend */}
                {activeView === "household" && allMonthTx.length > 0 && (
                  <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11, color: "#475569", borderTop: "1px solid #1e1e2e", paddingTop: 10 }}>
                    <span><span style={{ color: "#60a5fa" }}>■</span> {spouse1Name}</span>
                    <span><span style={{ color: "#fb923c" }}>■</span> {spouse2Name}</span>
                  </div>
                )}
              </div>

              {/* AI insights */}
              <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ fontSize: 11, letterSpacing: ".1em", color: "#475569", textTransform: "uppercase" }}>AI Savings Insights</div>
                  <button className="btn-ghost" style={{ fontSize: 10, padding: "4px 10px" }} onClick={fetchInsights} disabled={insightsLoad || allMonthTx.length === 0}>
                    {insightsLoad ? "Analyzing…" : "✦ Analyze"}
                  </button>
                </div>
                {insights.length === 0 && !insightsLoad && (
                  <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: "20px 0" }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>🤖</div>
                    Add transactions then click Analyze for personalized household savings advice
                  </div>
                )}
                {insightsLoad && <div style={{ color: "#4ade80", fontSize: 12, textAlign: "center", padding: "20px 0" }}>Consulting your household finances…</div>}
                {insights.map((ins, i) => (
                  <div key={i} className="insight-card" style={{
                    background: ins.severity === "high" ? "#1a0f0f" : ins.severity === "medium" ? "#1a1a0a" : "#0f1a0f",
                    borderLeftColor: ins.severity === "high" ? "#f87171" : ins.severity === "medium" ? "#facc15" : "#4ade80"
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>{ins.title}</div>
                    <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>{ins.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── STATEMENTS ── */}
        {tab === "statements" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: "#475569" }}>
                Importing for: <strong style={{ color: "#e2e8f0" }}>{MONTHS[selMonth]} {selYear}</strong> — transactions will be tagged to this month.
              </div>
              <button className="btn-ghost" onClick={() => setShowAddAcc(p => !p)}>+ Add Account</button>
            </div>

            {showAddAcc && (
              <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input placeholder="Account name" value={newAccName} onChange={e => setNewAccName(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                <select value={newAccOwner} onChange={e => setNewAccOwner(e.target.value)} style={{ fontSize: 12 }}>
                  <option value="s1">{spouse1Name}</option>
                  <option value="s2">{spouse2Name}</option>
                </select>
                <button className="btn-primary" onClick={() => {
                  if (!newAccName.trim()) return;
                  setAccounts(prev => [...prev, { id: Math.random().toString(36).slice(2), name: newAccName.trim(), owner: newAccOwner, raw: "", color: newAccOwner === "s1" ? "#60a5fa" : "#fb923c" }]);
                  setNewAccName(""); setShowAddAcc(false);
                }}>Add</button>
              </div>
            )}

            {/* grouped by owner */}
            {["s1", "s2"].map(owner => (
              <div key={owner} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, letterSpacing: ".1em", color: ownerColor(owner), textTransform: "uppercase", marginBottom: 10 }}>
                  👤 {ownerLabel(owner)}'s Accounts
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {accounts.filter(a => a.owner === owner).map(acc => (
                    <div key={acc.id} className="card" style={{ borderTop: `2px solid ${acc.color}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 9, height: 9, borderRadius: "50%", background: acc.color }} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{acc.name}</span>
                          <span style={{ fontSize: 11, color: "#475569" }}>{allMonthTx.filter(t => t.account === acc.name).length} txns</span>
                        </div>
                        {accounts.length > 1 && (
                          <button onClick={() => setAccounts(prev => prev.filter(a => a.id !== acc.id))} style={{ background: "none", border: "none", color: "#475569", fontSize: 16 }}>×</button>
                        )}
                      </div>
                      <textarea
                        placeholder={`Paste ${acc.name} statement…\n\nSupported formats:\n01/15  Starbucks  -4.75\n2026-01-16\tNetflix\t-15.99\n1/17, Amazon, -14.99`}
                        value={acc.raw}
                        onChange={e => setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, raw: e.target.value } : a))}
                        style={{ width: "100%", height: 170, resize: "vertical", lineHeight: 1.5, fontSize: 12 }}
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button className="btn-primary" onClick={() => handleParse(acc.id)} disabled={loading || !acc.raw.trim()}>
                          {loading ? "Parsing…" : "✦ Parse & Categorize"}
                        </button>
                        <button className="btn-ghost" onClick={() => setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, raw: "" } : a))}>Clear</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="card" style={{ background: "#0d1117", borderColor: "#1e2a1e" }}>
              <div style={{ fontSize: 11, color: "#4ade80", marginBottom: 8, letterSpacing: ".05em" }}>💡 HOW TO EXPORT YOUR STATEMENT</div>
              <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.8 }}>
                <strong style={{ color: "#64748b" }}>Chase / BofA / Wells Fargo:</strong> Log in → Activity → Download → CSV<br />
                <strong style={{ color: "#64748b" }}>Capital One:</strong> Transactions → Download Account Activity → CSV<br />
                <strong style={{ color: "#64748b" }}>Any bank:</strong> Copy-paste the transaction table directly from your browser
              </div>
            </div>
          </div>
        )}

        {/* ── TRANSACTIONS ── */}
        {tab === "transactions" && (
          <div>
            <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
              <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ fontSize: 12 }}>
                <option>All</option>
                {CATEGORIES.map(c => <option key={c.name}>{c.name}</option>)}
              </select>
              <select value={sortField} onChange={e => setSortField(e.target.value)} style={{ fontSize: 12 }}>
                <option value="date">Sort: Date</option>
                <option value="amount">Sort: Amount</option>
                <option value="category">Sort: Category</option>
                <option value="owner">Sort: Person</option>
              </select>
              <span style={{ fontSize: 11, color: "#475569", marginLeft: "auto" }}>{filteredTx.length} transactions</span>
            </div>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="tx-row" style={{ borderBottom: "1px solid #1e1e2e", fontSize: 10, color: "#475569", letterSpacing: ".1em", textTransform: "uppercase", background: "#0f0f18" }}>
                <span>Date</span><span>Person</span><span>Description</span><span>Category</span><span style={{ textAlign: "right" }}>Amount</span><span />
              </div>
              <div style={{ maxHeight: 500, overflowY: "auto" }}>
                {filteredTx.length === 0 && (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "#475569", fontSize: 12 }}>No transactions. Paste a statement in the Statements tab.</div>
                )}
                {filteredTx.map(tx => (
                  <div key={tx.id} className="tx-row">
                    <span style={{ color: "#475569", fontSize: 11 }}>{tx.date}</span>
                    <span>
                      <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: tx.owner === "s1" ? "#0a1a2a" : "#1a0f0a", color: ownerColor(tx.owner), border: `1px solid ${ownerColor(tx.owner)}33` }}>
                        {ownerLabel(tx.owner)}
                      </span>
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#cbd5e1" }}>{tx.description}</span>
                    <select value={tx.category} onChange={e => { const newList = allMonthTx.map(t => t.id === tx.id ? { ...t, category: e.target.value } : t); updateTx(newList); }} style={{ fontSize: 11, padding: "3px 6px", width: "100%" }}>
                      {CATEGORIES.map(c => <option key={c.name}>{c.name}</option>)}
                    </select>
                    <span style={{ textAlign: "right", color: tx.amount < 0 ? "#f87171" : "#4ade80", fontWeight: 600 }}>
                      {tx.amount < 0 ? "-" : "+"}${Math.abs(tx.amount).toFixed(2)}
                    </span>
                    <button onClick={() => { const newList = allMonthTx.filter(t => t.id !== tx.id); updateTx(newList); }} style={{ background: "none", border: "none", color: "#334155", fontSize: 14 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── BUDGETS ── */}
        {tab === "budgets" && (
          <div>
            <div style={{ fontSize: 12, color: "#475569", marginBottom: 14 }}>Household budget limits per category. The stacked bar shows {spouse1Name} <span style={{ color: "#60a5fa" }}>■</span> vs {spouse2Name} <span style={{ color: "#fb923c" }}>■</span> spending.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {catSpend(allMonthTx).map(c => {
                const pct  = c.budgetAmt > 0 ? Math.min(100, (c.spent / c.budgetAmt) * 100) : 0;
                const pct1 = c.budgetAmt > 0 ? Math.min(100, (c.spentS1 / c.budgetAmt) * 100) : 0;
                const pct2 = c.budgetAmt > 0 ? Math.min(100 - pct1, (c.spentS2 / c.budgetAmt) * 100) : 0;
                const over = c.budgetAmt > 0 && c.spent > c.budgetAmt;
                return (
                  <div key={c.name} className="card" style={{ borderLeft: `3px solid ${over ? "#f87171" : c.color}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 13 }}>{c.icon} <strong>{c.name}</strong></span>
                      {over && <span className="pill" style={{ background: "#2a1111", color: "#f87171", border: "1px solid #5a1111" }}>OVER</span>}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: "#475569" }}>$</span>
                      <input type="number" placeholder="Monthly budget" value={budgets[c.name] || ""} onChange={e => { const b = { ...budgets, [c.name]: +e.target.value }; setBudgets(b); syncSettings({ budgets: b }); }} style={{ flex: 1 }} />
                    </div>
                    <div className="bar-bg">
                      <div style={{ display: "flex", height: "100%" }}>
                        <div style={{ width: `${pct1}%`, background: "#60a5fa", transition: "width .5s" }} />
                        <div style={{ width: `${pct2}%`, background: "#fb923c", transition: "width .5s" }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "#475569" }}>
                      <span style={{ color: "#60a5fa" }}>{spouse1Name}: ${c.spentS1.toFixed(2)}</span>
                      <span style={{ color: c.budgetAmt > 0 && c.spent > c.budgetAmt ? "#f87171" : "#94a3b8" }}>{c.budgetAmt > 0 ? `${pct.toFixed(0)}%` : "—"}</span>
                      <span style={{ color: "#fb923c" }}>{spouse2Name}: ${c.spentS2.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── SAVINGS PLAN ── */}
        {tab === "savings" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              {/* household goal card */}
              <div className="card glow" style={{ marginBottom: 14, borderColor: "#1a2a1a" }}>
                <div style={{ fontSize: 11, letterSpacing: ".1em", color: "#4ade80", marginBottom: 12, textTransform: "uppercase" }}>◆ Household Monthly Goal</div>
                <div style={{ background: "#0a1a0a", borderRadius: 8, padding: 14 }}>
                  {[
                    { label: "Household Net",       val: `$${householdStats.net.toFixed(2)}`,   color: householdStats.net >= 0 ? "#4ade80" : "#f87171" },
                    { label: "Household Rate",       val: `${householdStats.rate}%`,              color: +householdStats.rate >= 20 ? "#4ade80" : "#facc15" },
                    { label: `${spouse1Name} Net`,   val: `$${s1Stats.net.toFixed(2)}`,          color: s1Stats.net >= 0 ? "#60a5fa" : "#f87171" },
                    { label: `${spouse1Name} Rate`,  val: `${s1Stats.rate}%`,                    color: "#60a5fa" },
                    { label: `${spouse2Name} Net`,   val: `$${s2Stats.net.toFixed(2)}`,          color: s2Stats.net >= 0 ? "#fb923c" : "#f87171" },
                    { label: `${spouse2Name} Rate`,  val: `${s2Stats.rate}%`,                    color: "#fb923c" },
                    { label: "Gap to Goal",          val: `$${Math.max(0, savingsGoal - householdStats.net).toFixed(2)}`, color: householdStats.net >= savingsGoal ? "#4ade80" : "#f87171" },
                    { label: "Annual Projection",    val: `$${(Math.max(0, householdStats.net) * 12).toLocaleString()}`, color: "#94a3b8" },
                  ].map(r => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1a2a1a", fontSize: 12 }}>
                      <span style={{ color: "#475569" }}>{r.label}</span>
                      <span style={{ color: r.color, fontWeight: 600 }}>{r.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* month over month */}
              {prevTx.length > 0 && (
                <div className="card">
                  <div style={{ fontSize: 11, letterSpacing: ".1em", color: "#475569", marginBottom: 12, textTransform: "uppercase" }}>
                    vs {MONTHS[selMonth === 0 ? 11 : selMonth - 1]}
                  </div>
                  {[
                    { label: "Spent", cur: householdStats.spent, prev: prevStats.spent, lowerBetter: true },
                    { label: "Net",   cur: householdStats.net,   prev: prevStats.net,   lowerBetter: false },
                  ].map(r => {
                    const diff = r.cur - r.prev;
                    const good = r.lowerBetter ? diff <= 0 : diff >= 0;
                    return (
                      <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #1a1a28", fontSize: 12 }}>
                        <span style={{ color: "#64748b" }}>{r.label}</span>
                        <span style={{ color: good ? "#4ade80" : "#f87171" }}>
                          {diff >= 0 ? "+" : ""}${diff.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              {/* scenarios */}
              <div className="card" style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, letterSpacing: ".1em", color: "#475569", marginBottom: 12, textTransform: "uppercase" }}>Aggressive Savings Scenarios</div>
                {householdStats.inc === 0 ? (
                  <div style={{ color: "#475569", fontSize: 12 }}>Add income transactions to see scenarios.</div>
                ) : [
                  { label: "Conservative (10%)", pct: 0.10, color: "#60a5fa" },
                  { label: "Moderate (20%)",     pct: 0.20, color: "#facc15" },
                  { label: "Aggressive (30%)",   pct: 0.30, color: "#fb923c" },
                  { label: "Extreme (50%)",      pct: 0.50, color: "#f87171" },
                ].map(s => {
                  const monthly = householdStats.inc * s.pct;
                  return (
                    <div key={s.label} style={{ background: "#0f0f18", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: s.color, fontWeight: 600 }}>{s.label}</span>
                        <span style={{ color: "#e2e8f0" }}>${monthly.toFixed(0)}/mo</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#475569" }}>
                        ${(monthly * 12).toLocaleString()}/yr · ${(monthly * 12 * 5).toLocaleString()} in 5yr · ${(monthly * 12 * 10).toLocaleString()} in 10yr
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 50/30/20 */}
              <div className="card">
                <div style={{ fontSize: 11, letterSpacing: ".1em", color: "#475569", marginBottom: 12, textTransform: "uppercase" }}>50/30/20 Rule (Household)</div>
                {householdStats.inc > 0 ? [
                  { label: "Needs (50%)",   target: householdStats.inc * 0.5, color: "#60a5fa" },
                  { label: "Wants (30%)",   target: householdStats.inc * 0.3, color: "#c084fc" },
                  { label: "Savings (20%)", target: householdStats.inc * 0.2, color: "#4ade80" },
                ].map(r => (
                  <div key={r.label} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: "#94a3b8" }}>{r.label}</span>
                      <span style={{ color: r.color }}>${r.target.toFixed(0)}/mo</span>
                    </div>
                    <div className="bar-bg">
                      <div className="bar-fill" style={{ width: "100%", background: r.color, opacity: .3 }} />
                    </div>
                  </div>
                )) : <div style={{ color: "#475569", fontSize: 12 }}>Add income transactions to see breakdown.</div>}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
