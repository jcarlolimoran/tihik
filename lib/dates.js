// All "today" logic runs in the users' timezone, not the server's (Railway servers run in UTC).
// An invalid TZ_NAME would crash every date lookup, so check it once and fall back to Manila.
const TZ = (() => {
  const tz = (process.env.TZ_NAME || "").trim() || "Asia/Manila";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    console.warn(`TZ_NAME "${tz}" is not a valid time zone; using Asia/Manila. Fix it in your Railway variables.`);
    return "Asia/Manila";
  }
})();

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
const monthOf = (ymd) => ymd.slice(0, 7);
const daysInMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const addDays = (ymd, n) => {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const shiftMonth = (month, n) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const monthLabel = (month) =>
  new Date(month + "-01T00:00:00Z").toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });

module.exports = { TZ, today, monthOf, daysInMonth, addDays, shiftMonth, monthLabel };
