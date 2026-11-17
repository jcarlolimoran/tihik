// Budget math shared by the bot replies, the dashboard and the cron job.
const store = require("./db");
const { today, monthOf, daysInMonth } = require("./dates");

const peso = (n) =>
  (n < 0 ? "-₱" : "₱") + Math.abs(Number(n)).toLocaleString("en-PH", { maximumFractionDigits: 0 });

function monthStats(psid, month = monthOf(today())) {
  const days = daysInMonth(month);
  const from = `${month}-01`;
  const to = `${month}-${String(days).padStart(2, "0")}`;
  const txns = store.txnsBetween(psid, from, to);

  const monthlyIncome = store.getMonthlyIncome(psid, month);
  let extraIncome = 0, spent = 0;
  const byCategory = {};
  const byDay = Array(days).fill(0);
  for (const t of txns) {
    if (t.type === "income") { extraIncome += t.amount; continue; }
    spent += t.amount;
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    byDay[Number(t.date.slice(8)) - 1] += t.amount;
  }
  const total = monthlyIncome + extraIncome;
  const s = {
    month, days, txns, monthlyIncome, extraIncome, total, spent,
    remaining: total - spent,
    byDay,
    byCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1]),
    plannedDaily: total / days,
    isCurrent: month === monthOf(today()),
  };

  if (s.isCurrent) {
    const d = Number(today().slice(8));
    const spentToday = byDay[d - 1];
    const spentBefore = spent - spentToday;
    s.dayOfMonth = d;
    s.daysLeft = days - d + 1; // including today
    s.spentToday = spentToday;
    // Whatever is left, spread evenly over the days remaining (today included).
    s.dailyAllowance = Math.max(0, (total - spentBefore) / s.daysLeft);
    s.leftToday = s.dailyAllowance - spentToday;
  }
  return s;
}

module.exports = { monthStats, peso };
