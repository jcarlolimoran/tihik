// Conversation logic. Returns a list of outgoing messages: { text } or { text, button: { title, url } }.
const store = require("./db");
const ai = require("./ai");
const { CATEGORIES } = ai;
const { monthStats, peso } = require("./stats");
const { today, monthOf, monthLabel, daysInMonth, shiftMonth } = require("./dates");

// Claude limits per user per day. Past the parse limit, simple messages like "lunch 150" still work offline.
const AI_MESSAGES_PER_DAY = Number(process.env.AI_MESSAGES_PER_DAY || 40);
const TIPS_PER_DAY = Number(process.env.TIPS_PER_DAY || 2);

const dashUrl = (user) => `${(process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "")}/d/${user.dash_token}`;
const dashMsg = (user, text = "Ania ang imong dashboard 📊") => ({ text, button: { title: "Ablihi ang dashboard", url: dashUrl(user) } });
const withName = (user, sep = ", ") => (user?.name ? `${sep}${user.name}` : "");

// "25000", "25,000", "25k", "₱25.5k", "1.2m"
function parseAmount(text) {
  const m = text.replace(/[₱,]/g, "").match(/(\d+(?:\.\d+)?)\s*(k|m)?\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]) * ({ k: 1e3, m: 1e6 }[(m[2] || "").toLowerCase()] || 1);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}

// Students often get a weekly or daily allowance. "1500 kada semana", "200 a day" → per month.
function periodOf(text) {
  if (/semana|week|linggo/i.test(text)) return "week";
  if (/adlaw|daily|\bday\b|araw/i.test(text)) return "day";
  return "month";
}
function toMonthly(amount, period) {
  if (period === "week") return Math.round((amount * 52) / 12);
  if (period === "day") return Math.round(amount * daysInMonth(monthOf(today())));
  return amount;
}
const perLabel = { week: "kada semana", day: "kada adlaw" };
const convertedNote = (amount, period) =>
  period === "month" ? "" : ` (${peso(amount)} ${perLabel[period]})`;

// "Carlo", "ako si Carlo", "Carlo akong pangalan", "call me JC" → "Carlo" / "JC"
function cleanName(text) {
  let t = text.trim()
    .replace(/^(hi|hello|hey)[,!. ]+/i, "")
    .replace(/^(ako\s+(si|c|kay)|ako|i'?m|i\s+am|my\s+name\s+is|name\s+ko|pangalan\s+ko|call\s+me|tawga\s+ko(g)?|si)\s+/i, "")
    .replace(/\s+(akong\s+pangalan|ang\s+pangalan\s+ko|pangalan\s+ko|po|lang|pud|here)\s*$/i, "")
    .replace(/[^\p{L}\s'.-]/gu, "")
    .replace(/\s+/g, " ").trim();
  if (!t) return null;
  t = t.split(" ").slice(0, 2).join(" ").slice(0, 30);
  return t.replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

const SKIP = /^(skip|laktaw|lakti|wala|wala pa|sunod na lang|sunod nalang|later|dili sa|ayaw sa|next|pass)\b/i;

const HELP =
  "Mao ni ang paggamit ni Tihik 🧮\n\n" +
  "I-chat lang ang imong gasto:\n• \"jollibee 185\"\n• \"plete 40 dayon load 99\"\n• \"grocery 2,350 gahapon\"\n\n" +
  "Dugang nga kita:\n• \"sideline 2k\"\n• \"bonus 5000\"\n\n" +
  "Uban pa:\n• \"pila pa akong nahabilin?\"\n• \"tips\" (personal nga tambag gikan sa AI)\n• \"dashboard\"\n" +
  "• \"undo\" (papason ang katapusang entry)\n" +
  "• \"30k na akong sweldo\" o \"1,500 akong allowance kada semana\" (usbon ang kwarta kada bulan)\n" +
  "• \"tawga ko og JC\" (usbon ang imong pangalan)";

function statusLine(s) {
  if (!s.hasBudget) {
    return `Nagasto karong adlawa: ${peso(s.spentToday)}\nNagasto karong bulana: ${peso(s.spent)}`;
  }
  return `Nahabilin karong bulana: ${peso(s.remaining)} / ${peso(s.total)}\n` +
    (s.leftToday >= 0
      ? `Pwede pa nimo magasto karong adlawa: ${peso(s.leftToday)}`
      : `⚠️ Nilapas ka og ${peso(-s.leftToday)} sa imong budget karong adlawa`);
}

// New users: ask name → ask income or allowance (optional) → active.
function onboarding(user, text, isNew) {
  if (isNew) {
    return [{
      text:
        "Hi! Ako si Tihik 🧮 — tabangan tika sa pag-budget sa imong kwarta diri mismo sa Messenger.\n\n" +
        "Una sa tanan: unsa akong itawag nimo? 🙂",
    }];
  }

  if (user.state === "ask_name") {
    const skipped = SKIP.test(text);
    const name = skipped ? null : cleanName(text);
    if (!name && !skipped) return [{ text: "Unsa man imong pangalan o nickname? 🙂 (o i-type ang \"skip\")" }];
    if (name) store.setName(user.psid, name);
    store.setState(user.psid, "ask_income");
    return [{
      text:
        (name ? `Nice to meet you, ${name}! 🙌\n\n` : "Okay ra! 👍\n\n") +
        "Pila ang imong kwarta kada bulan? Sweldo man o allowance, pwede ra.\n" +
        "(pananglitan \"25k\", o \"1,500 kada semana\" kung weekly ang allowance)\n\n" +
        "Kung dili pa nimo gusto i-share, i-type lang \"skip\". Pwede ra nimo i-add puhon.",
    }];
  }

  // ask_income (and 'onboarding' from older versions)
  if (SKIP.test(text)) {
    store.setState(user.psid, "active");
    return [
      {
        text:
          `Sige${withName(user)}, walay problema! 👍\n\n` +
          "I-chat lang ang matag gasto, pananglitan \"lunch 150\", ug ako ang mo-track sa tanan.\n\n" +
          "Kung gusto nimo og daily budget puhon, i-chat lang ang imong sweldo o allowance, pananglitan \"25k akong sweldo\".",
      },
      dashMsg(user, "Mao ni ang imong personal dashboard. I-bookmark aron dali ra balikan:"),
    ];
  }
  const amount = parseAmount(text);
  if (!amount) return [{ text: "Palihug i-type isip numero, pananglitan \"25k\" o \"1,500 kada semana\" 🙂\nO i-type ang \"skip\" kung dili pa karon." }];

  const period = periodOf(text);
  const monthly = toMonthly(amount, period);
  store.setMonthlyIncome(user.psid, monthly);
  store.setState(user.psid, "active");
  const s = monthStats(user.psid);
  return [
    {
      text:
        `✅ Na-set na: ${peso(monthly)} kada bulan${convertedNote(amount, period)}.\n\n` +
        `Naa pay ${s.daysLeft} ka adlaw karong ${monthLabel(s.month)}, mao nga ang imong daily budget kay mga ${peso(s.dailyAllowance)}.\n\n` +
        `I-chat lang ang matag gasto, pananglitan "lunch 150". Ako na'y bahala sa kwenta${withName(user)}.`,
    },
    dashMsg(user, "Mao ni ang imong personal dashboard. I-bookmark aron dali ra balikan:"),
  ];
}

function logTxns(user, txns, prefix = "") {
  const valid = (txns || []).filter((t) => t.amount > 0);
  if (!valid.length) return [{ text: prefix + "Wala koy nakit-an nga amount. Sulayi: \"lunch 150\"" }];
  const lines = [];
  for (const t of valid) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(t.date || "") && t.date <= today() ? t.date : today();
    const category = CATEGORIES.includes(t.category) ? t.category : "Other";
    store.addTxn(user.psid, { ...t, category, date });
    lines.push(`${t.type === "income" ? "➕" : "➖"} ${peso(t.amount)} · ${t.note || category}${date !== today() ? ` (${date})` : ""}`);
  }
  return [{ text: prefix + ["✅ Natala na!", ...lines, "", statusLine(monthStats(user.psid))].join("\n") }];
}

function summary(user) {
  const s = monthStats(user.psid);
  const top = s.byCategory.slice(0, 3).map(([c, v]) => `• ${c}: ${peso(v)}`);
  return [
    {
      text: [
        `📊 ${monthLabel(s.month)}`,
        s.monthlyIncome
          ? `Kwarta kada bulan: ${peso(s.monthlyIncome)}${s.extraIncome ? ` + ${peso(s.extraIncome)} extra` : ""}`
          : s.extraIncome ? `Dugang nga kita: ${peso(s.extraIncome)}` : `Wala pay sweldo o allowance nga naka-set.`,
        statusLine(s),
        ...(top.length ? ["", "Pinakadako nga gasto:", ...top] : []),
      ].join("\n"),
    },
    dashMsg(user, "Tibuok detalye sa dashboard:"),
  ];
}

// The user's numbers as plain text for the tips prompt. No Facebook IDs or links.
function tipFacts(user) {
  const s = monthStats(user.psid);
  const last = monthStats(user.psid, shiftMonth(s.month, -1));
  const notes = {};
  for (const t of s.txns) if (t.type === "expense") {
    const k = (t.note || t.category).toLowerCase();
    notes[k] = notes[k] || { n: 0, sum: 0 };
    notes[k].n++; notes[k].sum += t.amount;
  }
  const topNotes = Object.entries(notes).sort((a, b) => b[1].sum - a[1].sum).slice(0, 6)
    .map(([k, v]) => `${k}: ${peso(v.sum)} (${v.n}x)`);
  return [
    `Name: ${user.name || "(unknown)"}`,
    `Month: ${monthLabel(s.month)}, day ${s.dayOfMonth} of ${s.days} (${s.daysLeft} days left including today)`,
    s.monthlyIncome ? `Regular monthly money (salary or allowance): ${peso(s.monthlyIncome)}` : `No salary or allowance set (only tracking spending)`,
    `Extra income this month: ${peso(s.extraIncome)}`,
    `Spent this month: ${peso(s.spent)}; spent today: ${peso(s.spentToday)}`,
    s.hasBudget ? `Remaining this month: ${peso(s.remaining)}; daily budget now: ${peso(s.dailyAllowance)}; planned daily: ${peso(s.plannedDaily)}` : "",
    `By category: ${s.byCategory.map(([c, v]) => `${c} ${peso(v)} (${Math.round((v / s.spent) * 100)}%)`).join(", ") || "none"}`,
    `Biggest items: ${topNotes.join(", ") || "none"}`,
    last.spent ? `Last month: spent ${peso(last.spent)}${last.total ? ` of ${peso(last.total)}` : ""}` : "",
  ].filter(Boolean).join("\n");
}

async function giveTips(user) {
  const used = store.usageToday(user.psid, "tip");
  if (used >= TIPS_PER_DAY) {
    return [{ text: `Nakadawat na ka og ${used} ka tambag karong adlawa${withName(user)} 😊 Balik ugma para sa bag-o!` }];
  }
  const s = monthStats(user.psid);
  const expenses = s.txns.filter((t) => t.type === "expense").length;
  if (expenses < 3) {
    return [{ text: "I-log una ang imong mga gasto sulod sa pipila ka adlaw, dayon hatagan tika og tambag base sa imong tinuod nga gasto 🙂" }];
  }
  try {
    const text = await ai.tips(tipFacts(user));
    store.addUsage(user.psid, "tip");
    return [{ text: `💡 Tambag para nimo${withName(user)}:\n\n${text}` }];
  } catch (e) {
    console.error(e);
    return [{ text: "Wala ko kahatag og tambag karon, palihug sulayi og balik unya 🙏" }];
  }
}

// Offline fallback once the daily AI limit is reached: "lunch 150 plete 40" → expenses with a keyword category.
const KEYWORDS = [
  [/jollibee|mcdo|lunch|dinner|breakfast|kape|coffee|sud-?an|merienda|snack|kaon|food|pagkaon|milk ?tea|resto/i, "Food"],
  [/bugas|grocery|groceries|palengke|market|sari/i, "Groceries"],
  [/plete|pliti|pamasahe|fare|jeep|grab|taxi|angkas|bus|gas|tricycle|habal/i, "Transport"],
  [/\bload\b|\bdata\b|wifi|internet|globe|smart|gomo/i, "Load/Internet"],
  [/kuryente|meralco|veco|tubig|water|rent|abang|bill/i, "Bills"],
  [/tambal|medicine|doctor|hospital|check-?up/i, "Health"],
  [/school|tuition|libro|book|project|print/i, "Education"],
  [/shopee|lazada|sapatos|shoes|bisti|clothes|shirt/i, "Shopping"],
  [/sine|movie|netflix|spotify|game/i, "Entertainment"],
];
function simpleParse(text) {
  const out = [];
  const re = /([\p{L}][\p{L}' -]{0,30}?)\s*₱?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?(?!\d)/giu;
  for (const m of text.matchAll(re)) {
    const note = m[1].trim().replace(/^(ug|dayon|tapos|and|og)\s+/i, "");
    const amount = parseFloat(m[2].replace(/,/g, "")) * (m[3] ? 1000 : 1);
    if (!(amount > 0)) continue;
    const category = (KEYWORDS.find(([re]) => re.test(note)) || [, "Other"])[1];
    out.push({ type: "expense", amount, category, note, date: today() });
  }
  return out;
}

async function handleMessage(psid, rawText) {
  const text = (rawText || "").trim();
  let user = store.getUser(psid);
  const isNew = !user;
  if (isNew) user = store.createUser(psid);
  store.touch(psid);

  if (user.state !== "active") return onboarding(user, text, isNew);

  // Fast paths that don't need Claude
  const lower = text.toLowerCase();
  if (/^(undo|papas|papasa|bura|burahin)$/.test(lower)) {
    const last = store.undoLast(psid);
    if (!last) return [{ text: "Wala pay entry nga mapapas." }];
    return [{ text: `↩️ Gipapas: ${peso(last.amount)} · ${last.note || last.category}\n\n${statusLine(monthStats(psid))}` }];
  }
  if (/^(dashboard|dash|link)$/.test(lower)) return [dashMsg(user)];
  if (/^(new link|reset link|bag-ong link|bagong link)$/.test(lower)) {
    user = { ...user, dash_token: store.resetToken(psid) };
    return [dashMsg(user, "🔒 Naghimo ko og bag-ong link. Dili na mugana ang daan.")];
  }
  if (/^(help|tabang|tulong|menu)$/.test(lower)) return [{ text: HELP }];
  if (/^(tips?|tambag|payo|advice)$/.test(lower)) return giveTips(user);
  if (/^(hi|hello|hey|get started|maayong (buntag|udto|hapon|gabii))$/.test(lower)) {
    return [{ text: `Hi usab${withName(user)}! 👋\n\n${statusLine(monthStats(psid))}` }];
  }

  // Daily AI limit reached: keep logging working without Claude.
  if (store.usageToday(psid, "parse") >= AI_MESSAGES_PER_DAY) {
    const note = "(Naabot na nimo ang AI limit karong adlawa, mao nga simple ra akong pagbasa hangtod ugma 🙂)\n\n";
    const txns = simpleParse(text);
    if (!txns.length) return [{ text: note + "Pwede pa gihapon ka mo-log: i-type ang gasto ug amount, pananglitan \"lunch 150\"." }];
    return logTxns(user, txns, note);
  }

  store.addUsage(psid, "parse");
  const intent = await ai.interpret(text);
  switch (intent.action) {
    case "log": return logTxns(user, intent.transactions);
    case "set_monthly_income": {
      if (!(intent.monthly_income > 0)) return [{ text: "Pila ang imong bag-ong sweldo o allowance?" }];
      const period = ["week", "day"].includes(intent.income_period) ? intent.income_period : "month";
      const monthly = toMonthly(intent.monthly_income, period);
      store.setMonthlyIncome(psid, monthly);
      return [{ text: `✅ Kwarta kada bulan para sa ${monthLabel(monthOf(today()))}: ${peso(monthly)}${convertedNote(intent.monthly_income, period)}\n\n${statusLine(monthStats(psid))}` }];
    }
    case "set_name": {
      const name = cleanName(intent.name || "");
      if (!name) return [{ text: "Unsa man ang gusto nimong itawag nako nimo? 🙂" }];
      store.setName(psid, name);
      return [{ text: `Sige, ${name} na ang itawag nako nimo! 🙌` }];
    }
    case "summary": return summary(user);
    case "tips": return giveTips(user);
    case "dashboard": return [dashMsg(user)];
    case "undo": return handleMessage(psid, "undo");
    case "help": return [{ text: HELP }];
    default: return [{ text: intent.reply || HELP }];
  }
}

module.exports = { handleMessage, parseAmount, cleanName, simpleParse, statusLine, dashMsg, withName };
