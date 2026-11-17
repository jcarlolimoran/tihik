// Conversation logic. Returns a list of outgoing messages: { text } or { text, button: { title, url } }.
const store = require("./db");
const { interpret, CATEGORIES } = require("./ai");
const { monthStats, peso } = require("./stats");
const { today, monthOf, monthLabel } = require("./dates");

const dashUrl = (user) => `${(process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "")}/d/${user.dash_token}`;
const dashMsg = (user, text = "Heto ang dashboard mo 📊") => ({ text, button: { title: "Buksan ang dashboard", url: dashUrl(user) } });

// "25000", "25,000", "25k", "₱25.5k", "1.2m"
function parseAmount(text) {
  const m = text.replace(/[₱,]/g, "").match(/(\d+(?:\.\d+)?)\s*(k|m)?\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]) * ({ k: 1e3, m: 1e6 }[(m[2] || "").toLowerCase()] || 1);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}

const HELP =
  "Ganito gamitin si Tihik 🧮\n\n" +
  "I-chat lang ang gastos:\n• \"jollibee 185\"\n• \"pamasahe 40 tapos load 99\"\n• \"grocery 2,350 kahapon\"\n\n" +
  "Dagdag na kita:\n• \"sideline 2k\"\n• \"bonus 5000\"\n\n" +
  "Iba pa:\n• \"magkano pa natitira?\"\n• \"dashboard\"\n• \"undo\" (burahin ang huling entry)\n" +
  "• \"30k na sweldo ko\" (palitan ang monthly income)";

function statusLine(s) {
  return `Natitira ngayong buwan: ${peso(s.remaining)} / ${peso(s.total)}\n` +
    (s.leftToday >= 0
      ? `Pwede mo pang gastusin ngayong araw: ${peso(s.leftToday)}`
      : `⚠️ Lampas ka ng ${peso(-s.leftToday)} sa budget mo ngayong araw`);
}

async function onboarding(user, text, isNew) {
  if (isNew) {
    return [{
      text:
        "Hi! Ako si Tihik 🧮 — tutulungan kitang i-budget ang pera mo dito mismo sa Messenger.\n\n" +
        "Para makapagsimula: magkano ang monthly income mo? (hal. 25000 o 25k)",
    }];
  }
  const amount = parseAmount(text);
  if (!amount) return [{ text: "Paki-type lang ang monthly income mo bilang numero, hal. 25000 o 25k 🙂" }];

  store.setMonthlyIncome(user.psid, amount);
  store.setState(user.psid, "active");
  const s = monthStats(user.psid);
  return [
    {
      text:
        `✅ Naka-set na: ${peso(amount)} kada buwan.\n\n` +
        `May ${s.daysLeft} araw pa ngayong ${monthLabel(s.month)}, kaya ang daily budget mo ay mga ${peso(s.dailyAllowance)}.\n\n` +
        `I-chat mo lang ang bawat gastos, hal. "lunch 150". Ako na ang bahala sa computation.`,
    },
    dashMsg(user, "Ito ang personal dashboard mo. I-bookmark mo para madaling balikan:"),
  ];
}

function logTxns(user, txns) {
  const valid = (txns || []).filter((t) => t.amount > 0);
  if (!valid.length) return [{ text: "Wala akong nakitang amount. Subukan: \"lunch 150\"" }];
  const lines = [];
  for (const t of valid) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(t.date || "") && t.date <= today() ? t.date : today();
    const category = CATEGORIES.includes(t.category) ? t.category : "Other";
    store.addTxn(user.psid, { ...t, category, date });
    lines.push(`${t.type === "income" ? "➕" : "➖"} ${peso(t.amount)} · ${t.note || category}${date !== today() ? ` (${date})` : ""}`);
  }
  return [{ text: ["✅ Naitala!", ...lines, "", statusLine(monthStats(user.psid))].join("\n") }];
}

function summary(user) {
  const s = monthStats(user.psid);
  const top = s.byCategory.slice(0, 3).map(([c, v]) => `• ${c}: ${peso(v)}`);
  return [
    {
      text: [
        `📊 ${monthLabel(s.month)}`,
        `Income: ${peso(s.monthlyIncome)}${s.extraIncome ? ` + ${peso(s.extraIncome)} extra` : ""}`,
        `Nagastos: ${peso(s.spent)}`,
        statusLine(s),
        ...(top.length ? ["", "Pinakamalaking gastos:", ...top] : []),
      ].join("\n"),
    },
    dashMsg(user, "Buong detalye sa dashboard:"),
  ];
}

async function handleMessage(psid, rawText) {
  const text = (rawText || "").trim();
  let user = store.getUser(psid);
  const isNew = !user;
  if (isNew) user = store.createUser(psid);
  store.touch(psid);

  if (user.state === "onboarding") return onboarding(user, text, isNew);

  // Fast paths that don't need Claude
  const lower = text.toLowerCase();
  if (/^(undo|bura|burahin)$/.test(lower)) {
    const last = store.undoLast(psid);
    if (!last) return [{ text: "Wala pang entry na pwedeng burahin." }];
    return [{ text: `↩️ Binura: ${peso(last.amount)} · ${last.note || last.category}\n\n${statusLine(monthStats(psid))}` }];
  }
  if (/^(dashboard|dash|link)$/.test(lower)) return [dashMsg(user)];
  if (/^(new link|reset link|bagong link)$/.test(lower)) {
    user = { ...user, dash_token: store.resetToken(psid) };
    return [dashMsg(user, "🔒 Gumawa ako ng bagong link. Hindi na gagana ang luma.")];
  }
  if (/^(help|tulong|menu)$/.test(lower)) return [{ text: HELP }];
  if (/^(hi|hello|hey|get started)$/.test(lower)) return [{ text: `Hi ulit! 👋\n\n${statusLine(monthStats(psid))}` }];

  const intent = await interpret(text);
  switch (intent.action) {
    case "log": return logTxns(user, intent.transactions);
    case "set_monthly_income": {
      if (!(intent.monthly_income > 0)) return [{ text: "Magkano ang bagong monthly income mo?" }];
      store.setMonthlyIncome(psid, intent.monthly_income);
      return [{ text: `✅ Monthly income para sa ${monthLabel(monthOf(today()))}: ${peso(intent.monthly_income)}\n\n${statusLine(monthStats(psid))}` }];
    }
    case "summary": return summary(user);
    case "dashboard": return [dashMsg(user)];
    case "undo": return handleMessage(psid, "undo");
    case "help": return [{ text: HELP }];
    default: return [{ text: intent.reply || HELP }];
  }
}

module.exports = { handleMessage, parseAmount, statusLine, dashMsg };
