// Server-rendered personal dashboard: /d/<token>?m=YYYY-MM
const { monthStats, peso } = require("./stats");
const { today, monthOf, shiftMonth, monthLabel } = require("./dates");

// Brand mark (same artwork as brand/tihik-icon.png), drawn inline so it stays crisp at any size.
const MARK = `<svg viewBox="0 0 720 720" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="720" height="720" rx="160" fill="#207b50"/><path d="M193 500 C200 330 330 185 540 179 C540 400 420 515 218 527 Z" fill="#eaf4e4"/><path d="M456 258 L180 534" stroke="#207b50" stroke-width="26" stroke-linecap="round"/></svg>`;
const FAVICON = `data:image/svg+xml,${encodeURIComponent(MARK)}`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function dailyChart(s) {
  const W = 360, H = 170, padL = 30, padR = 4, padT = 18, padB = 20;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const max = Math.max(s.plannedDaily * 1.25, ...s.byDay, 1);
  const step = innerW / s.days;
  const barW = Math.max(3, step - 2); // 2px gap between bars
  const y = (v) => padT + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max].map((v) => Math.round(v / 100) * 100);
  const lastDay = s.isCurrent ? s.dayOfMonth : s.days;

  let bars = "";
  s.byDay.forEach((v, i) => {
    const x = padL + i * step + (step - barW) / 2;
    const day = i + 1;
    const future = day > lastDay;
    const label = `${monthLabel(s.month).split(" ")[0].slice(0, 3)} ${day}: ${future ? "—" : peso(v)}`;
    if (v > 0) {
      const h = Math.max(2, (v / max) * innerH), r = Math.min(4, barW / 2);
      const top = padT + innerH - h;
      // rounded data end, square at the baseline
      bars += `<path class="bar" d="M${x},${padT + innerH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${padT + innerH} Z"/>`;
    }
    // generous invisible hit target for the tooltip
    bars += `<rect class="hit" x="${padL + i * step}" y="${padT}" width="${step}" height="${innerH}" data-tip="${esc(label)}"/>`;
    if (day === 1 || day % 5 === 0) bars += `<text class="axis" x="${x + barW / 2}" y="${H - 6}" text-anchor="middle">${day}</text>`;
  });

  const grid = ticks.map((t) => `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${t >= 1000 ? (t / 1000).toFixed(t % 1000 ? 1 : 0) + "k" : t}</text>`).join("");
  const ref = s.total > 0
    ? `<line class="ref" x1="${padL}" x2="${W - padR}" y1="${y(s.plannedDaily)}" y2="${y(s.plannedDaily)}"/><text class="ref-label" x="${W - padR}" y="${y(s.plannedDaily) - 5}" text-anchor="end">Daily budget ${peso(s.plannedDaily)}</text>`
    : "";

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily spending for ${esc(monthLabel(s.month))}">${grid}${ref}${bars}</svg>`;
}

function render(user, monthParam) {
  const current = monthOf(today());
  const month = /^\d{4}-\d{2}$/.test(monthParam || "") && monthParam <= current ? monthParam : current;
  const s = monthStats(user.psid, month);
  const pctSpent = s.total > 0 ? Math.min(100, (s.spent / s.total) * 100) : 0;
  const prev = shiftMonth(month, -1), next = shiftMonth(month, 1);
  const base = `/d/${user.dash_token}`;
  const maxCat = s.byCategory[0]?.[1] || 1;

  const hello = user.name ? `<div class="hello">Hi, ${esc(user.name)} 👋</div>` : "";
  const hero = !s.hasBudget
    ? `${hello}<div class="hero-label">Nagasto ${s.isCurrent ? "karong adlawa" : `sa ${esc(monthLabel(month))}`}</div>
       <div class="hero">${peso(s.isCurrent ? s.spentToday : s.spent)}</div>
       <div class="hero-sub">${s.isCurrent ? `Karong bulana: ${peso(s.spent)} · ` : ""}I-chat ang imong sweldo o allowance (pananglitan "25k") para naay daily budget</div>`
    : s.isCurrent
    ? `${hello}<div class="hero-label">Pwede pa nimo magasto karong adlawa</div>
       <div class="hero ${s.leftToday < 0 ? "neg" : ""}">${peso(s.leftToday)}</div>
       <div class="hero-sub">${s.leftToday < 0 ? "⚠️ Nilapas na sa budget karong adlawa · " : ""}Daily budget ${peso(s.dailyAllowance)} · ${s.daysLeft} ka adlaw pa</div>`
    : `${hello}<div class="hero-label">Nahabilin sa ${esc(monthLabel(month))}</div>
       <div class="hero ${s.remaining < 0 ? "neg" : ""}">${peso(s.remaining)}</div>`;

  const cats = s.byCategory.length
    ? s.byCategory.map(([c, v]) => `
        <div class="cat" data-tip="${esc(c)}: ${peso(v)} (${Math.round((v / s.spent) * 100)}%)">
          <div class="cat-row"><span>${esc(c)}</span><span class="num">${peso(v)}</span></div>
          <div class="track"><div class="fill" style="width:${(v / maxCat) * 100}%"></div></div>
        </div>`).join("")
    : `<p class="empty">Wala pay gasto karong bulana.</p>`;

  let lastDate = "";
  const rowHtml = (list) => { lastDate = ""; return list.map((t) => {
    const head = t.date !== lastDate
      ? `<tr class="day"><th colspan="3">${new Date(t.date + "T00:00:00Z").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</th></tr>`
      : "";
    lastDate = t.date;
    return `${head}<tr><td>${esc(t.note || t.category)}</td><td class="muted">${esc(t.category)}</td><td class="num ${t.type}">${t.type === "income" ? "+" : "−"}${peso(t.amount)}</td></tr>`;
  }).join(""); };
  const SHOW = 15;
  const rows = rowHtml(s.txns.slice(0, SHOW));
  const more = s.txns.length > SHOW
    ? `<details><summary>Ipakita tanan (${s.txns.length - SHOW} pa)</summary><table>${rowHtml(s.txns.slice(SHOW))}</table></details>`
    : "";

  return `<!DOCTYPE html>
<html lang="ceb"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>tihik · ${esc(monthLabel(month))}</title>
<link rel="icon" href="${FAVICON}">
<link rel="apple-touch-icon" href="/icon.png">
<meta name="theme-color" content="#207b50">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    color-scheme: light;
    --bg: #f6f8f3; --surface: #fdfefc; --line: #e1e8de;
    --text: #13261c; --text-2: #4a5a50; --muted: #7d8a81;
    --brand: #207b50;
    --series: #207b50; --series-soft: #207b501f; --ref: #4a5a50;
    --good: #207b50; --critical: #c42d2c;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --bg: #0f1612; --surface: #16201a; --line: #26332b;
      --text: #eaf4e4; --text-2: #b9c8bd; --muted: #84948a;
      --brand: #eaf4e4;
      --series: #3fae78; --series-soft: #3fae7829; --ref: #b9c8bd;
      --good: #4fc287; --critical: #e66767;
    }
  }
  * { box-sizing: border-box; margin: 0; }
  body { font: 15px/1.45 Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); }
  main { max-width: 680px; margin: 0 auto; padding: 20px 16px 48px; display: grid; gap: 14px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .brand { display: flex; align-items: center; gap: 9px; font-weight: 800; font-size: 22px; letter-spacing: -0.02em; color: var(--text); }
  .brand svg { width: 30px; height: 30px; flex: none; }
  nav { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--text-2); }
  nav a, nav .off { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--line); color: var(--text); text-decoration: none; background: var(--surface); }
  nav .off { opacity: .35; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 18px; }
  h2 { font-size: 13px; font-weight: 600; color: var(--text-2); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 12px; }
  .hello { font-weight: 700; font-size: 16px; margin-bottom: 8px; }
  .hero-label { color: var(--text-2); font-size: 14px; }
  .hero { font-size: 44px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; margin: 4px 0; font-variant-numeric: tabular-nums; }
  .hero.neg { color: var(--critical); }
  .hero-sub { color: var(--muted); font-size: 13px; }
  .progress { margin-top: 16px; }
  .progress .track { height: 10px; }
  .progress-legend { display: flex; justify-content: space-between; font-size: 13px; color: var(--text-2); margin-top: 6px; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .stat { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
  .stat .k { font-size: 12px; color: var(--text-2); }
  .stat .v { font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .stat .s { font-size: 11px; color: var(--muted); }
  .track { background: var(--series-soft); border-radius: 999px; height: 8px; overflow: hidden; }
  .fill { background: var(--series); height: 100%; border-radius: 999px; }
  svg { width: 100%; height: auto; display: block; overflow: visible; }
  .bar { fill: var(--series); }
  .grid { stroke: var(--line); stroke-width: 1; }
  .axis { fill: var(--muted); font-size: 10px; }
  .ref { stroke: var(--ref); stroke-width: 1.5; stroke-dasharray: 4 4; }
  .ref-label { fill: var(--text-2); font-size: 10px; font-weight: 600; paint-order: stroke; stroke: var(--surface); stroke-width: 3px; }
  .hit { fill: transparent; cursor: default; }
  .hit:hover { fill: var(--series-soft); }
  .cats { display: grid; gap: 12px; }
  .cat-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 5px; }
  .num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  td { padding: 7px 0; border-bottom: 1px solid var(--line); }
  td.muted { color: var(--muted); font-size: 12px; padding: 0 8px; }
  tr.day th { text-align: left; font-size: 12px; font-weight: 600; color: var(--text-2); padding: 14px 0 4px; }
  tr.day:first-child th { padding-top: 0; }
  .income { color: var(--good); font-weight: 600; }
  details summary { cursor: pointer; color: var(--series); font-size: 14px; font-weight: 600; padding: 12px 0 4px; }
  details table { margin-top: 8px; }
  .empty { color: var(--muted); font-size: 14px; }
  .foot { text-align: center; color: var(--muted); font-size: 12px; line-height: 1.7; }
  .foot .tagline { color: var(--series); font-weight: 800; }
  #tip { position: fixed; pointer-events: none; background: var(--text); color: var(--surface); font-size: 12px; font-weight: 600; padding: 5px 8px; border-radius: 6px; opacity: 0; transition: opacity .1s; white-space: nowrap; z-index: 10; }
  @media (max-width: 420px) { .hero { font-size: 38px; } .stat .v { font-size: 16px; } }
</style>
</head>
<body>
<main>
  <header>
    <div class="brand">${MARK}<span>tihik</span></div>
    <nav>
      <a href="${base}?m=${prev}" aria-label="Previous month">‹</a>
      <strong>${esc(monthLabel(month))}</strong>
      ${next <= current ? `<a href="${base}?m=${next}" aria-label="Next month">›</a>` : `<span class="off">›</span>`}
    </nav>
  </header>

  <section class="card">
    ${hero}
    ${s.hasBudget ? `<div class="progress">
      <div class="track"><div class="fill" style="width:${pctSpent}%"></div></div>
      <div class="progress-legend"><span>Nagasto ${peso(s.spent)}</span><span>Nahabilin ${peso(s.remaining)} / ${peso(s.total)}</span></div>
    </div>` : ""}
  </section>

  <section class="stats">
    <div class="stat"><div class="k">Kwarta kada bulan</div><div class="v">${s.monthlyIncome ? peso(s.monthlyIncome) : "—"}</div><div class="s">${s.monthlyIncome ? "sweldo o allowance" : "wala pa na-set"}</div></div>
    <div class="stat"><div class="k">Dugang nga kita</div><div class="v">${peso(s.extraIncome)}</div><div class="s">sideline, bonus, regalo</div></div>
    <div class="stat"><div class="k">Nagasto</div><div class="v">${peso(s.spent)}</div><div class="s">${s.hasBudget ? `${Math.round(pctSpent)}% sa budget` : "karong bulana"}</div></div>
  </section>

  <section class="card">
    <h2>Gasto matag adlaw</h2>
    ${dailyChart(s)}
  </section>

  <section class="card">
    <h2>Asa napunta</h2>
    <div class="cats">${cats}</div>
  </section>

  <section class="card">
    <h2>Mga entry</h2>
    ${rows ? `<table>${rows}</table>${more}` : `<p class="empty">Wala pay entry. I-chat ang imong gasto kang Tihik sa Messenger.</p>`}
  </section>

  <p class="foot"><strong class="tagline">tihik</strong> · smart budgeting with pareng AI<br>Pribado kini nga link. Kung na-share nimo, i-chat ang "new link" aron maghimo og bag-o.</p>
</main>
<div id="tip" role="tooltip"></div>
<script>
  const tip = document.getElementById("tip");
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest("[data-tip]");
    if (!el) { tip.style.opacity = 0; return; }
    tip.textContent = el.dataset.tip;
    const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + "px"; tip.style.top = (e.clientY - 34) + "px"; tip.style.opacity = 1;
  });
  document.addEventListener("pointerleave", () => (tip.style.opacity = 0));
</script>
</body></html>`;
}

module.exports = { render };
