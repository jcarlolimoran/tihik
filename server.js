// Tihik — Messenger budgeting bot + personal dashboard. Run: node server.js
const http = require("node:http");
const store = require("./lib/db");
const { handleMessage, statusLine, dashMsg } = require("./lib/bot");
const messenger = require("./lib/messenger");
const dashboard = require("./lib/dashboard");
const { monthStats, peso } = require("./lib/stats");
const { today, monthOf, shiftMonth, monthLabel } = require("./lib/dates");

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Handle one user's messages in order, so two quick messages can't race each other.
const queues = new Map();
function enqueue(psid, job) {
  const next = (queues.get(psid) || Promise.resolve()).then(job).catch((e) => console.error(e));
  queues.set(psid, next);
  next.finally(() => queues.get(psid) === next && queues.delete(psid));
}

async function onMessengerEvent(ev) {
  const psid = ev.sender?.id;
  if (!psid || ev.message?.is_echo) return;
  const text = ev.message?.text ?? (ev.postback ? ev.postback.payload === "GET_STARTED" ? "get started" : ev.postback.title : null);
  if (!text) {
    if (ev.message?.attachments) enqueue(psid, () => messenger.send(psid, { text: "Text lang muna ang nababasa ko 🙏 I-type ang gastos, hal. \"lunch 150\"" }));
    return;
  }
  enqueue(psid, async () => {
    messenger.typing(psid);
    try {
      await messenger.sendAll(psid, await handleMessage(psid, text));
    } catch (e) {
      console.error(e);
      await messenger.send(psid, { text: "Nagka-error sa side ko, pakisubukan ulit mamaya 🙏" });
    }
  });
}

// Called once a day by the Railway cron service (see cron.js).
// Messenger only allows messages within 24h of the user's last message, so users outside that window are skipped.
async function runDailyCron() {
  const day = today();
  const isFirst = day.endsWith("-01");
  const result = { sent: 0, skipped_outside_window: 0, already_sent: 0 };

  for (const u of store.activeUsers()) {
    if (u.last_reminder_on === day) { result.already_sent++; continue; }
    const hoursSince = u.last_msg_at ? (Date.now() - Date.parse(u.last_msg_at)) / 36e5 : Infinity;
    if (hoursSince > 23.5) { result.skipped_outside_window++; continue; }

    const s = monthStats(u.psid);
    let text;
    if (isFirst) {
      const last = monthStats(u.psid, shiftMonth(monthOf(day), -1));
      text = `🗓️ Bagong buwan! Noong ${monthLabel(last.month)}: nagastos ${peso(last.spent)} sa ${peso(last.total)}, ` +
        `${last.remaining >= 0 ? `natira ${peso(last.remaining)} 🎉` : `lumampas ng ${peso(-last.remaining)}`}.\n\n` +
        `Ngayong ${monthLabel(s.month)}, monthly income mo ay ${peso(s.monthlyIncome)}. Kung nagbago, i-chat lang hal. "30k na sweldo ko".\n\n` +
        `Daily budget: ${peso(s.dailyAllowance)}`;
    } else if (!store.loggedOn(u.psid, day)) {
      text = `👋 Nag-log ka na ba ng gastos ngayong araw? I-chat lang hal. "lunch 150".\n\n${statusLine(s)}`;
    } else {
      text = `🌙 Recap ngayong araw: nagastos ka ng ${peso(s.spentToday)}.\n\n${statusLine(s)}`;
    }
    const ok = await messenger.send(u.psid, { text }, { type: "UPDATE" });
    if (ok) { store.markReminded(u.psid, day); result.sent++; }
  }
  return result;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => { size += c.length; if (size > 1e6) req.destroy(); else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    // Meta webhook verification
    if (req.method === "GET" && url.pathname === "/webhook") {
      const ok = VERIFY_TOKEN && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
      return res.writeHead(ok ? 200 : 403).end(ok ? url.searchParams.get("hub.challenge") : "Forbidden");
    }

    // Incoming Messenger events
    if (req.method === "POST" && url.pathname === "/webhook") {
      const raw = await readBody(req);
      if (!messenger.validSignature(raw, req.headers["x-hub-signature-256"])) return res.writeHead(403).end();
      res.writeHead(200).end("EVENT_RECEIVED"); // reply to Meta immediately, do the work after
      const body = JSON.parse(raw);
      if (body.object === "page") for (const e of body.entry || []) for (const ev of e.messaging || []) onMessengerEvent(ev);
      return;
    }

    // Personal dashboard
    const m = url.pathname.match(/^\/d\/([A-Za-z0-9_-]{20,})$/);
    if (req.method === "GET" && m) {
      const user = store.getUserByToken(m[1]);
      if (!user || user.state !== "active") return res.writeHead(404, { "content-type": "text/plain" }).end("Dashboard not found. Chat \"dashboard\" to Tihik for your link.");
      return res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      }).end(dashboard.render(user, url.searchParams.get("m")));
    }

    // Daily cron trigger
    if (req.method === "POST" && url.pathname === "/cron/daily") {
      if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.writeHead(401).end();
      const result = await runDailyCron();
      console.log("cron/daily", result);
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    }

    // Local testing only: simulate a chat without Facebook
    if (req.method === "POST" && url.pathname === "/dev/chat" && process.env.NODE_ENV !== "production") {
      const { psid = "dev-user", text } = JSON.parse(await readBody(req));
      const replies = await handleMessage(psid, text);
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(replies, null, 2));
    }

    // App icon (home-screen icon for the dashboard)
    if (req.method === "GET" && url.pathname === "/icon.png") {
      return res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" })
        .end(require("node:fs").readFileSync(require("node:path").join(__dirname, "brand", "tihik-icon.png")));
    }

    if (url.pathname === "/" || url.pathname === "/health") return res.writeHead(200).end("Tihik is running");
    res.writeHead(404).end("Not found");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500).end("Server error");
  }
});

if (require.main === module) server.listen(PORT, "::", () => console.log(`Tihik listening on :${PORT}`));
module.exports = { server, runDailyCron };
