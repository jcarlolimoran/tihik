// Railway cron service entry point. Railway runs this on a schedule; it pings the web service,
// which owns the database volume, and exits.
require("./lib/env");
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");

(async () => {
  if (!APP_URL || !process.env.CRON_SECRET) {
    console.error("Set APP_URL and CRON_SECRET on the cron service.");
    process.exit(1);
  }
  const res = await fetch(`${APP_URL}/cron/daily`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  console.log(res.status, await res.text());
  process.exit(res.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
