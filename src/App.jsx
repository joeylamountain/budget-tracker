import { useState, useEffect, useRef } from "react";

const CATEGORIES = [
  { name: "Housing", icon: "🏠", color: "#4ade80", budget: 0 },
  { name: "Food & Dining", icon: "🍽️", color: "#fb923c", budget: 0 },
  { name: "Groceries", icon: "🛒", color: "#facc15", budget: 0 },
  { name: "Transport", icon: "🚗", color: "#60a5fa", budget: 0 },
  { name: "Subscriptions", icon: "📱", color: "#c084fc", budget: 0 },
  { name: "Shopping", icon: "🛍️", color: "#f472b6", budget: 0 },
  { name: "Health", icon: "💊", color: "#34d399", budget: 0 },
  { name: "Entertainment", icon: "🎬", color: "#f87171", budget: 0 },
  { name: "Utilities", icon: "⚡", color: "#38bdf8", budget: 0 },
  { name: "Savings", icon: "💰", color: "#a3e635", budget: 0 },
  { name: "Income", icon: "💵", color: "#4ade80", budget: 0 },
  { name: "Other", icon: "📦", color: "#94a3b8", budget: 0 },
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseTransactions(raw) {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const transactions = [];
  for (const line of lines) {
    // Try various delimiters: tab, comma, pipe, multiple spaces
    const parts = line.split(/\t|,|\|{2,}|\s{2,}/).map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    // Find amount (look for number with optional $ or - sign)
    let amount = null, amountIdx = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      const cleaned = parts[i].replace(/[$,()]/g, "");
      if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
        amount = parseFloat(cleaned);
        // Parentheses mean negative
        if (parts[i].includes("(")) amount = -Math.abs(amount);
        amountIdx = i;
        break;
      }
    }
    if (amount === null) continue;
    // Find date
    let date = "", dateIdx = -1;
    for (let i = 0; i < parts.length; i++) {
      if (/\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?/.test(parts[i]) || /\d{4}-\d{2}-\d{2}/.test(parts[i])) {
        date = parts[i];
        dateIdx = i;
        break;
      }
    }
    // Description is everything that isn't date or amount
    const descParts = parts.filter((_, i) => i !== amountIdx && i !== dateIdx);
    const description = descParts.join(" ").replace(/\s+/g, " ").trim();
    if (!description && !date) continue;
    transactions.push({ id: Math.random().toString(36).slice(2), date, description, amount, category: "Other", account: "" });
  }
  return transactions;
}

function guessCategory(description) {
  const d = description.toLowerCase();
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
  if (/transfer to savings|savings|investment|vanguard|fidelity|robinhood|schwab/.test(d)) return "Savings";
  return "Other";
}

// AI categorization via Claude API
async function aiCategorizeTransactions(transactions, apiKey) {
  const toClassify = transactions.filter(t => t.category === "Other" || !t.category).slice(0, 50);
  if (toClassify.length === 0) return transactions;
  const list = toClassify.map((t, i) => `${i}. "${t.description}" amount:${t.amount}`).join("\n");
  const prompt = `Categorize these bank transactions. Reply ONLY with a JSON array of objects like: [{"index":0,"category":"Food & Dining"},...].
Categories: Housing, Food & Dining, Groceries, Transport, Subscriptions, Shopping, Health, Entertainment, Utilities, Savings, Income, Other.

Transactions:
${list}`;
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const text = data.content?.find(b => b.type === "text")?.text || "[]";
    const clean = text.replace(/```json|```/g, "").trim();
    const results = JSON.parse(clean);
    const updated = [...transactions];
    for (const r of results) {
      const tx = toClassify[r.index];
      if (tx) {
        const idx = updated.findIndex(t => t.id === tx.id);
        if (idx !== -1 && CATEGORIES.find(c => c.name === r.category)) {
          updated[idx] = { ...updated[idx], category: r.category };
        }
      }
    }
    return updated;
  } catch (e) {
    throw e;
  }
}

async function aiInsights(transactions, budgets, apiKey) {
  const summary = CATEGORIES.filter(c => c.name !== "Income").map(c => {
    const spent = transactions.filter(t => t.category === c.name && t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    return `${c.name}: spent $${spent.toFixed(2)}, budget $${budgets[c.name] || 0}`;
  }).join("\n");
  const income = transactions.filter(t => t.category === "Income").reduce((s, t) => s + t.amount, 0);
  const prompt = `You are a tough-love financial advisor helping someone save aggressively. Given this monthly spending summary:
Income: $${income.toFixed(2)}
${summary}

Give 4 sharp, specific, actionable insights to maximize savings. Be direct and specific. Format as JSON array: [{"title":"...","detail":"...","severity":"high|medium|low"}]`;
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const text = data.content?.find(b => b.type === "text")?.text || "[]";
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    throw e;
  }
}

export default function BudgetTracker() {
  const [tab, setTab] = useState("dashboard");
  const [accounts, setAccounts] = useState([{ id: "a1", name: "Chase Credit", raw: "", color: "#60a5fa" }, { id: "a2", name: "Bank Debit", raw: "", color: "#4ade80" }]);
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState({});
  const [savingsGoal, setSavingsGoal] = useState(1000);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [editingTx, setEditingTx] = useState(null);
  const [newAccName, setNewAccName] = useState("");
  const [showAddAcc, setShowAddAcc] = useState(false);
  const [filterCat, setFilterCat] = useState("All");
  const [sortField, setSortField] = useState("date");
  const [apiKey, setApiKey] = useState(() => { try { return localStorage.getItem("budget_anthropic_key") || ""; } catch { return ""; } });
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiError, setApiError] = useState("");
  const [showApiPanel, setShowApiPanel] = useState(false);
  const isExternalDeploy = (() => { try { return !window.location.hostname.includes("claude.ai") && !window.location.hostname.includes("anthropic.com"); } catch { return false; } })();

  const income = transactions.filter(t => t.category === "Income" && t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalSpent = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const net = income - totalSpent;
  const savingsRate = income > 0 ? ((net / income) * 100).toFixed(1) : 0;

  const spendByCategory = CATEGORIES.map(c => ({
    ...c,
    spent: transactions.filter(t => t.category === c.name && t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
    budgetAmt: budgets[c.name] || 0,
  })).filter(c => c.name !== "Income");

  const effectiveApiKey = isExternalDeploy ? apiKey : "";

  function saveApiKey() {
    const k = apiKeyInput.trim();
    setApiKey(k);
    try { localStorage.setItem("budget_anthropic_key", k); } catch {}
    setApiKeyInput("");
    setShowApiPanel(false);
    setApiError("");
  }

  function clearApiKey() {
    setApiKey("");
    try { localStorage.removeItem("budget_anthropic_key"); } catch {}
    setShowApiPanel(false);
  }

  async function handleParse(accId) {
    const acc = accounts.find(a => a.id === accId);
    if (!acc?.raw.trim()) return;
    if (isExternalDeploy && !apiKey) { setApiError("Please set your Anthropic API key first (click the key icon in the header)."); setShowApiPanel(true); return; }
    setApiError("");
    setLoading(true);
    try {
      let parsed = parseTransactions(acc.raw);
      parsed = parsed.map(t => ({ ...t, account: acc.name, category: guessCategory(t.description) }));
      parsed = await aiCategorizeTransactions(parsed, effectiveApiKey);
      setTransactions(prev => {
        const others = prev.filter(t => t.account !== acc.name);
        return [...others, ...parsed];
      });
    } catch(e) {
      setApiError("AI categorization failed: " + (e.message || "Check your API key."));
    }
    setLoading(false);
  }

  async function fetchInsights() {
    if (isExternalDeploy && !apiKey) { setApiError("Please set your Anthropic API key first."); setShowApiPanel(true); return; }
    setApiError("");
    setInsightsLoading(true);
    try {
      const ins = await aiInsights(transactions, budgets, effectiveApiKey);
      setInsights(ins);
    } catch(e) {
      setApiError("Insights failed: " + (e.message || "Check your API key."));
    }
    setInsightsLoading(false);
  }

  function updateTxCategory(id, cat) {
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, category: cat } : t));
  }

  const filteredTx = transactions
    .filter(t => filterCat === "All" || t.category === filterCat)
    .sort((a, b) => {
      if (sortField === "amount") return a.amount - b.amount;
      if (sortField === "category") return a.category.localeCompare(b.category);
      return a.date.localeCompare(b.date) || a.description.localeCompare(b.description);
    });

  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: "◈" },
    { id: "statements", label: "Statements", icon: "⊞" },
    { id: "transactions", label: "Transactions", icon: "≡" },
    { id: "budgets", label: "Budgets", icon: "◎" },
    { id: "savings", label: "Savings Plan", icon: "◆" },
  ];

  return (
    <div style={{ fontFamily: "'DM Mono', 'Fira Code', monospace", background: "#0a0a0f", minHeight: "100vh", color: "#e2e8f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,400&family=Syne:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #111; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        input, textarea, select { background: #13131a; border: 1px solid #2a2a3a; color: #e2e8f0; border-radius: 6px; padding: 8px 12px; font-family: inherit; font-size: 13px; outline: none; transition: border-color 0.2s; }
        input:focus, textarea:focus, select:focus { border-color: #4ade80; }
        button { cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .tab-btn { background: none; border: none; color: #64748b; padding: 10px 18px; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; border-bottom: 2px solid transparent; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
        .tab-btn:hover { color: #94a3b8; }
        .tab-btn.active { color: #4ade80; border-bottom-color: #4ade80; }
        .card { background: #13131a; border: 1px solid #1e1e2e; border-radius: 12px; padding: 20px; }
        .pill { display: inline-block; padding: 2px 10px; border-radius: 99px; font-size: 11px; font-weight: 500; }
        .metric-val { font-family: 'Syne', sans-serif; font-size: 28px; font-weight: 800; }
        .metric-label { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #475569; margin-top: 2px; }
        .bar-bg { background: #1e1e2e; border-radius: 4px; height: 8px; overflow: hidden; }
        .bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
        .tx-row { display: grid; grid-template-columns: 80px 1fr 130px 90px 30px; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 8px; border-bottom: 1px solid #1a1a28; font-size: 12px; }
        .tx-row:hover { background: #16161f; }
        .btn-primary { background: #4ade80; color: #0a0a0f; border: none; padding: 8px 18px; border-radius: 6px; font-size: 12px; font-weight: 600; letter-spacing: 0.05em; }
        .btn-primary:hover { background: #86efac; }
        .btn-ghost { background: none; border: 1px solid #2a2a3a; color: #94a3b8; padding: 7px 14px; border-radius: 6px; font-size: 12px; }
        .btn-ghost:hover { border-color: #4ade80; color: #4ade80; }
        .insight-card { border-radius: 10px; padding: 16px; margin-bottom: 10px; border-left: 3px solid; }
        .badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 99px; font-size: 11px; border: 1px solid; }
        select option { background: #13131a; }
        .glow { box-shadow: 0 0 20px rgba(74,222,128,0.15); }
      `}</style>

      {/* Header */}
      <div style={{ background: "#0d0d14", borderBottom: "1px solid #1e1e2e", padding: "0 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 20, paddingBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: "#4ade80" }}>BUDGET</span>
              <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 300, color: "#475569" }}>TRACKER</span>
              <span style={{ width: 6, height: 6, background: "#4ade80", borderRadius: "50%", display: "inline-block", marginLeft: 4, animation: "pulse 2s infinite" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "#475569" }}>
              <span>{transactions.length} transactions</span>
              <select value={selectedMonth} onChange={e => setSelectedMonth(+e.target.value)} style={{ fontSize: 11, padding: "4px 8px" }}>
                {MONTHS.map((m, i) => <option key={m} value={i}>{m} 2026</option>)}
              </select>
              {isExternalDeploy && (
                <button onClick={() => setShowApiPanel(p => !p)} title="API Key Settings" style={{ background: apiKey ? "#0a1a0a" : "#1a0a0a", border: `1px solid ${apiKey ? "#4ade80" : "#f87171"}`, color: apiKey ? "#4ade80" : "#f87171", borderRadius: 6, padding: "5px 10px", fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
                  🔑 {apiKey ? "API Key ✓" : "Set API Key"}
                </button>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
            {tabs.map(t => (
              <button key={t.id} className={`tab-btn${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
                <span>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* API Key Panel */}
      {showApiPanel && isExternalDeploy && (
        <div style={{ background: "#0d0d14", borderBottom: "1px solid #1e1e2e" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 24px" }}>
            <div style={{ background: "#13131a", border: "1px solid #2a2a3a", borderRadius: 10, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 6 }}>🔑 Anthropic API Key</div>
              <div style={{ fontSize: 12, color: "#475569", marginBottom: 14, lineHeight: 1.6 }}>
                Required when running outside Claude.ai. Get your key at <span style={{ color: "#60a5fa" }}>console.anthropic.com</span> → API Keys. Your key is stored only in your browser's localStorage and never sent anywhere except the Anthropic API.
              </div>
              {apiKey && (
                <div style={{ fontSize: 12, color: "#4ade80", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  ✓ Key saved: <span style={{ color: "#64748b", fontFamily: "monospace" }}>sk-ant-...{apiKey.slice(-6)}</span>
                  <button onClick={clearApiKey} style={{ background: "none", border: "1px solid #5a1111", color: "#f87171", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>Remove</button>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <input
                    type={showApiKey ? "text" : "password"}
                    placeholder="sk-ant-api03-..."
                    value={apiKeyInput}
                    onChange={e => setApiKeyInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && saveApiKey()}
                    style={{ width: "100%", paddingRight: 36 }}
                  />
                  <button onClick={() => setShowApiKey(p => !p)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#475569", fontSize: 14 }}>{showApiKey ? "🙈" : "👁"}</button>
                </div>
                <button className="btn-primary" onClick={saveApiKey} disabled={!apiKeyInput.trim()}>Save Key</button>
                <button className="btn-ghost" onClick={() => setShowApiPanel(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 24px" }}>

        {/* Error banner */}
        {apiError && (
          <div style={{ background: "#1a0808", border: "1px solid #5a1111", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "#f87171", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>⚠ {apiError}</span>
            <button onClick={() => setApiError("")} style={{ background: "none", border: "none", color: "#f87171", fontSize: 16 }}>×</button>
          </div>
        )}

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div>
            {/* Top metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Monthly Income", val: `$${income.toLocaleString("en", { minimumFractionDigits: 2 })}`, color: "#4ade80", sub: "total inflows" },
                { label: "Total Spent", val: `$${totalSpent.toLocaleString("en", { minimumFractionDigits: 2 })}`, color: "#f87171", sub: "total outflows" },
                { label: "Net Remaining", val: `$${net.toLocaleString("en", { minimumFractionDigits: 2 })}`, color: net >= 0 ? "#4ade80" : "#f87171", sub: "after expenses" },
                { label: "Savings Rate", val: `${savingsRate}%`, color: +savingsRate >= 20 ? "#4ade80" : +savingsRate >= 10 ? "#facc15" : "#f87171", sub: +savingsRate >= 20 ? "🎯 great" : "⚠ needs work" },
              ].map(m => (
                <div key={m.label} className="card" style={{ position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: m.color, opacity: 0.7 }} />
                  <div className="metric-label">{m.label}</div>
                  <div className="metric-val" style={{ color: m.color, marginTop: 8 }}>{m.val}</div>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{m.sub}</div>
                </div>
              ))}
            </div>

            {/* Savings goal progress */}
            <div className="card glow" style={{ marginBottom: 20, borderColor: "#1a2a1a" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#4ade80", letterSpacing: "0.05em" }}>◆ SAVINGS GOAL PROGRESS</div>
                <div style={{ fontSize: 12, color: "#475569" }}>Goal: <span style={{ color: "#e2e8f0" }}>${savingsGoal.toLocaleString()}/mo</span></div>
              </div>
              <div className="bar-bg" style={{ height: 14 }}>
                <div className="bar-fill" style={{ width: `${Math.min(100, (net / savingsGoal) * 100)}%`, background: "linear-gradient(90deg, #16a34a, #4ade80)" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "#475569" }}>
                <span>${Math.max(0, net).toFixed(0)} saved</span>
                <span>{savingsGoal > 0 ? `${Math.min(100, ((net / savingsGoal) * 100)).toFixed(0)}%` : "—"}</span>
                <span>${savingsGoal} goal</span>
              </div>
            </div>

            {/* Category breakdown */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="card">
                <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#475569", marginBottom: 14, textTransform: "uppercase" }}>Spending by Category</div>
                {spendByCategory.filter(c => c.spent > 0).sort((a, b) => b.spent - a.spent).map(c => (
                  <div key={c.name} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span>{c.icon} {c.name}</span>
                      <span style={{ color: c.budgetAmt > 0 && c.spent > c.budgetAmt ? "#f87171" : "#94a3b8" }}>
                        ${c.spent.toFixed(2)}{c.budgetAmt > 0 ? ` / $${c.budgetAmt}` : ""}
                      </span>
                    </div>
                    <div className="bar-bg">
                      <div className="bar-fill" style={{
                        width: c.budgetAmt > 0 ? `${Math.min(100, (c.spent / c.budgetAmt) * 100)}%` : "0%",
                        background: c.budgetAmt > 0 && c.spent > c.budgetAmt ? "#f87171" : c.color,
                      }} />
                    </div>
                  </div>
                ))}
                {spendByCategory.filter(c => c.spent > 0).length === 0 && (
                  <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: "20px 0" }}>No transactions yet — paste statements in the Statements tab</div>
                )}
              </div>

              {/* AI Insights */}
              <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#475569", textTransform: "uppercase" }}>AI Savings Insights</div>
                  <button className="btn-ghost" style={{ fontSize: 10, padding: "4px 10px" }} onClick={fetchInsights} disabled={insightsLoading || transactions.length === 0}>
                    {insightsLoading ? "Analyzing..." : "✦ Analyze"}
                  </button>
                </div>
                {insights.length === 0 && !insightsLoading && (
                  <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: "20px 0" }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>🤖</div>
                    Add transactions, then click Analyze for personalized savings advice
                  </div>
                )}
                {insightsLoading && (
                  <div style={{ color: "#4ade80", fontSize: 12, textAlign: "center", padding: "20px 0" }}>Consulting your finances...</div>
                )}
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

        {/* STATEMENTS */}
        {tab === "statements" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "#475569" }}>Paste your statement text below. Supports CSV, tab-delimited, and most exported formats.</div>
              <button className="btn-ghost" onClick={() => setShowAddAcc(!showAddAcc)}>+ Add Account</button>
            </div>
            {showAddAcc && (
              <div className="card" style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
                <input placeholder="Account name (e.g. Citi Rewards)" value={newAccName} onChange={e => setNewAccName(e.target.value)} style={{ flex: 1 }} />
                <button className="btn-primary" onClick={() => {
                  if (!newAccName.trim()) return;
                  setAccounts(prev => [...prev, { id: Math.random().toString(36).slice(2), name: newAccName.trim(), raw: "", color: "#c084fc" }]);
                  setNewAccName(""); setShowAddAcc(false);
                }}>Add</button>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: accounts.length === 1 ? "1fr" : "1fr 1fr", gap: 16 }}>
              {accounts.map(acc => (
                <div key={acc.id} className="card" style={{ borderTop: `2px solid ${acc.color}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: acc.color }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{acc.name}</span>
                      <span style={{ fontSize: 11, color: "#475569" }}>{transactions.filter(t => t.account === acc.name).length} txns</span>
                    </div>
                    {accounts.length > 1 && (
                      <button style={{ background: "none", border: "none", color: "#475569", fontSize: 16 }} onClick={() => {
                        setAccounts(prev => prev.filter(a => a.id !== acc.id));
                        setTransactions(prev => prev.filter(t => t.account !== acc.name));
                      }}>×</button>
                    )}
                  </div>
                  <textarea
                    placeholder={`Paste your ${acc.name} statement here...\n\nExample formats:\n01/15  Starbucks  -4.75\n2026-01-16\tNetflix\t-15.99\n1/17, Amazon Prime, -14.99`}
                    value={acc.raw}
                    onChange={e => setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, raw: e.target.value } : a))}
                    style={{ width: "100%", height: 200, resize: "vertical", lineHeight: 1.5 }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="btn-primary" onClick={() => handleParse(acc.id)} disabled={loading || !acc.raw.trim()}>
                      {loading ? "Parsing..." : "✦ Parse & Categorize"}
                    </button>
                    <button className="btn-ghost" onClick={() => setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, raw: "" } : a))}>Clear</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="card" style={{ marginTop: 16, background: "#0d1117", borderColor: "#1e2a1e" }}>
              <div style={{ fontSize: 11, color: "#4ade80", marginBottom: 8, letterSpacing: "0.05em" }}>💡 HOW TO EXPORT YOUR STATEMENT</div>
              <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.8 }}>
                <strong style={{ color: "#64748b" }}>Chase / Bank of America / Wells Fargo:</strong> Log in → Activity → Download → CSV<br />
                <strong style={{ color: "#64748b" }}>Capital One:</strong> Transactions → Download Account Activity → CSV<br />
                <strong style={{ color: "#64748b" }}>Citi:</strong> View Transactions → Download<br />
                <strong style={{ color: "#64748b" }}>Any bank:</strong> Copy-paste directly from your browser — most table formats work automatically
              </div>
            </div>
          </div>
        )}

        {/* TRANSACTIONS */}
        {tab === "transactions" && (
          <div>
            <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
              <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ fontSize: 12 }}>
                <option>All</option>
                {CATEGORIES.map(c => <option key={c.name}>{c.name}</option>)}
              </select>
              <select value={sortField} onChange={e => setSortField(e.target.value)} style={{ fontSize: 12 }}>
                <option value="date">Sort: Date</option>
                <option value="amount">Sort: Amount</option>
                <option value="category">Sort: Category</option>
              </select>
              <span style={{ fontSize: 11, color: "#475569", marginLeft: "auto" }}>{filteredTx.length} transactions</span>
            </div>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="tx-row" style={{ borderBottom: "1px solid #1e1e2e", fontSize: 10, color: "#475569", letterSpacing: "0.1em", textTransform: "uppercase", background: "#0f0f18" }}>
                <span>Date</span><span>Description</span><span>Category</span><span style={{ textAlign: "right" }}>Amount</span><span />
              </div>
              <div style={{ maxHeight: 480, overflowY: "auto" }}>
                {filteredTx.length === 0 && (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "#475569", fontSize: 12 }}>No transactions. Paste a statement in the Statements tab.</div>
                )}
                {filteredTx.map(tx => {
                  const cat = CATEGORIES.find(c => c.name === tx.category) || CATEGORIES[CATEGORIES.length - 1];
                  return (
                    <div key={tx.id} className="tx-row">
                      <span style={{ color: "#475569", fontSize: 11 }}>{tx.date}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#cbd5e1" }}>{tx.description}</span>
                      <select value={tx.category} onChange={e => updateTxCategory(tx.id, e.target.value)} style={{ fontSize: 11, padding: "3px 6px", width: "100%" }}>
                        {CATEGORIES.map(c => <option key={c.name}>{c.name}</option>)}
                      </select>
                      <span style={{ textAlign: "right", color: tx.amount < 0 ? "#f87171" : "#4ade80", fontWeight: 600 }}>
                        {tx.amount < 0 ? "-" : "+"}${Math.abs(tx.amount).toFixed(2)}
                      </span>
                      <button onClick={() => setTransactions(prev => prev.filter(t => t.id !== tx.id))} style={{ background: "none", border: "none", color: "#334155", fontSize: 14 }}>×</button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* BUDGETS */}
        {tab === "budgets" && (
          <div>
            <div style={{ fontSize: 13, color: "#475569", marginBottom: 16 }}>Set monthly budget limits per category. Red = over budget.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {spendByCategory.map(c => {
                const pct = c.budgetAmt > 0 ? Math.min(100, (c.spent / c.budgetAmt) * 100) : 0;
                const over = c.budgetAmt > 0 && c.spent > c.budgetAmt;
                return (
                  <div key={c.name} className="card" style={{ borderLeft: `3px solid ${over ? "#f87171" : c.color}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 13 }}>{c.icon} <strong>{c.name}</strong></span>
                      {over && <span className="pill" style={{ background: "#2a1111", color: "#f87171", border: "1px solid #5a1111" }}>OVER BUDGET</span>}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 11, color: "#475569" }}>$</span>
                      <input type="number" placeholder="Monthly budget" value={budgets[c.name] || ""} onChange={e => setBudgets(prev => ({ ...prev, [c.name]: +e.target.value }))} style={{ flex: 1 }} />
                    </div>
                    <div className="bar-bg">
                      <div className="bar-fill" style={{ width: `${pct}%`, background: over ? "#f87171" : c.color }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "#475569" }}>
                      <span>Spent: <span style={{ color: over ? "#f87171" : "#94a3b8" }}>${c.spent.toFixed(2)}</span></span>
                      <span>{c.budgetAmt > 0 ? `${pct.toFixed(0)}%` : "—"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* SAVINGS PLAN */}
        {tab === "savings" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div className="card glow" style={{ marginBottom: 16, borderColor: "#1a2a1a" }}>
                <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#4ade80", marginBottom: 16, textTransform: "uppercase" }}>◆ Monthly Savings Goal</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
                  <span style={{ fontSize: 18, color: "#475569" }}>$</span>
                  <input type="number" value={savingsGoal} onChange={e => setSavingsGoal(+e.target.value)} style={{ fontSize: 24, fontFamily: "'Syne', sans-serif", fontWeight: 800, padding: "8px 12px", width: "100%" }} />
                </div>
                <div style={{ background: "#0a1a0a", borderRadius: 8, padding: 14 }}>
                  {[
                    { label: "Current Net", val: `$${net.toFixed(2)}`, color: net >= 0 ? "#4ade80" : "#f87171" },
                    { label: "Savings Rate", val: `${savingsRate}%`, color: +savingsRate >= 20 ? "#4ade80" : "#facc15" },
                    { label: "Gap to Goal", val: `$${Math.max(0, savingsGoal - net).toFixed(2)}`, color: net >= savingsGoal ? "#4ade80" : "#f87171" },
                    { label: "Annual Projection", val: `$${(Math.max(0, net) * 12).toLocaleString()}`, color: "#94a3b8" },
                  ].map(r => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1a2a1a", fontSize: 13 }}>
                      <span style={{ color: "#475569" }}>{r.label}</span>
                      <span style={{ color: r.color, fontWeight: 600 }}>{r.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 50/30/20 rule */}
              <div className="card">
                <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#475569", marginBottom: 12, textTransform: "uppercase" }}>50/30/20 Rule vs Your Spending</div>
                {income > 0 ? [
                  { label: "Needs (50%)", target: income * 0.5, color: "#60a5fa" },
                  { label: "Wants (30%)", target: income * 0.3, color: "#c084fc" },
                  { label: "Savings (20%)", target: income * 0.2, color: "#4ade80" },
                ].map(r => (
                  <div key={r.label} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: "#94a3b8" }}>{r.label}</span>
                      <span style={{ color: r.color }}>${r.target.toFixed(0)}/mo</span>
                    </div>
                    <div className="bar-bg">
                      <div className="bar-fill" style={{ width: "100%", background: r.color, opacity: 0.3 }} />
                    </div>
                  </div>
                )) : <div style={{ color: "#475569", fontSize: 12 }}>Add income transactions to see your 50/30/20 breakdown.</div>}
              </div>
            </div>

            <div>
              {/* Savings scenarios */}
              <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#475569", marginBottom: 14, textTransform: "uppercase" }}>Aggressive Savings Scenarios</div>
                {income === 0 ? (
                  <div style={{ color: "#475569", fontSize: 12 }}>Add income transactions to see scenarios.</div>
                ) : [
                  { label: "Conservative (10%)", pct: 0.10, color: "#60a5fa" },
                  { label: "Moderate (20%)", pct: 0.20, color: "#facc15" },
                  { label: "Aggressive (30%)", pct: 0.30, color: "#fb923c" },
                  { label: "Extreme (50%)", pct: 0.50, color: "#f87171" },
                ].map(s => {
                  const monthly = income * s.pct;
                  return (
                    <div key={s.label} style={{ background: "#0f0f18", borderRadius: 8, padding: 12, marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
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

              {/* Cut recommendations */}
              <div className="card">
                <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#475569", marginBottom: 12, textTransform: "uppercase" }}>⚡ Quick Cut Opportunities</div>
                {spendByCategory.filter(c => c.budgetAmt > 0 && c.spent > c.budgetAmt).length > 0 ? (
                  spendByCategory.filter(c => c.budgetAmt > 0 && c.spent > c.budgetAmt).map(c => (
                    <div key={c.name} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1a1a28", fontSize: 12 }}>
                      <span>{c.icon} {c.name} is over budget</span>
                      <span style={{ color: "#f87171" }}>-${(c.spent - c.budgetAmt).toFixed(2)}</span>
                    </div>
                  ))
                ) : (
                  <div>
                    <div style={{ color: "#475569", fontSize: 12, marginBottom: 12 }}>
                      {transactions.length === 0 ? "Add transactions and set budgets to see cut opportunities." : "Set category budgets to track over-spending."}
                    </div>
                    {spendByCategory.filter(c => c.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 3).map(c => (
                      <div key={c.name} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1a1a28", fontSize: 12 }}>
                        <span style={{ color: "#64748b" }}>{c.icon} Biggest: {c.name}</span>
                        <span style={{ color: "#94a3b8" }}>${c.spent.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  );
}
