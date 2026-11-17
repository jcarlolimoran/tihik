// SQLite storage (Node's built-in node:sqlite). On Railway, put DB_PATH on a mounted volume.
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { today, monthOf } = require("./dates");

const db = new DatabaseSync(process.env.DB_PATH || "tihik.db");
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    psid TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'onboarding',   -- onboarding | active
    dash_token TEXT UNIQUE NOT NULL,
    last_msg_at TEXT,                            -- ISO time of the user's last message (24h window)
    last_reminder_on TEXT,                       -- YYYY-MM-DD of the last cron reminder
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS incomes (           -- monthly income, one row per user per month
    psid TEXT NOT NULL,
    month TEXT NOT NULL,                         -- YYYY-MM
    amount REAL NOT NULL,
    PRIMARY KEY (psid, month)
  );
  CREATE TABLE IF NOT EXISTS txns (              -- daily expenses and additional income
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    psid TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('expense','income')),
    amount REAL NOT NULL CHECK (amount > 0),
    category TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,                          -- YYYY-MM-DD
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_txns_user_date ON txns (psid, date);
`);

const q = {
  getUser: db.prepare(`SELECT * FROM users WHERE psid = ?`),
  getUserByToken: db.prepare(`SELECT * FROM users WHERE dash_token = ?`),
  insertUser: db.prepare(`INSERT INTO users (psid, dash_token) VALUES (?, ?)`),
  setState: db.prepare(`UPDATE users SET state = ? WHERE psid = ?`),
  touch: db.prepare(`UPDATE users SET last_msg_at = ? WHERE psid = ?`),
  setToken: db.prepare(`UPDATE users SET dash_token = ? WHERE psid = ?`),
  markReminded: db.prepare(`UPDATE users SET last_reminder_on = ? WHERE psid = ?`),
  activeUsers: db.prepare(`SELECT * FROM users WHERE state = 'active'`),
  getIncome: db.prepare(`SELECT amount FROM incomes WHERE psid = ? AND month = ?`),
  latestIncomeBefore: db.prepare(`SELECT amount FROM incomes WHERE psid = ? AND month < ? ORDER BY month DESC LIMIT 1`),
  upsertIncome: db.prepare(`INSERT INTO incomes (psid, month, amount) VALUES (?, ?, ?)
                            ON CONFLICT (psid, month) DO UPDATE SET amount = excluded.amount`),
  insertTxn: db.prepare(`INSERT INTO txns (psid, type, amount, category, note, date) VALUES (?, ?, ?, ?, ?, ?)`),
  lastTxn: db.prepare(`SELECT * FROM txns WHERE psid = ? ORDER BY id DESC LIMIT 1`),
  deleteTxn: db.prepare(`DELETE FROM txns WHERE id = ?`),
  txnsBetween: db.prepare(`SELECT * FROM txns WHERE psid = ? AND date BETWEEN ? AND ? ORDER BY date DESC, id DESC`),
  countOn: db.prepare(`SELECT COUNT(*) AS n FROM txns WHERE psid = ? AND date = ?`),
};

const newToken = () => crypto.randomBytes(18).toString("base64url");

module.exports = {
  db,
  getUser: (psid) => q.getUser.get(psid),
  getUserByToken: (t) => q.getUserByToken.get(t),
  createUser(psid) {
    q.insertUser.run(psid, newToken());
    return q.getUser.get(psid);
  },
  setState: (psid, s) => q.setState.run(s, psid),
  touch: (psid) => q.touch.run(new Date().toISOString(), psid),
  resetToken(psid) {
    const t = newToken();
    q.setToken.run(t, psid);
    return t;
  },
  markReminded: (psid, day) => q.markReminded.run(day, psid),
  activeUsers: () => q.activeUsers.all(),

  // Monthly income for a month. A new month inherits the most recent earlier amount.
  getMonthlyIncome(psid, month = monthOf(today())) {
    const row = q.getIncome.get(psid, month);
    if (row) return row.amount;
    const prev = q.latestIncomeBefore.get(psid, month);
    if (!prev) return 0;
    if (month <= monthOf(today())) q.upsertIncome.run(psid, month, prev.amount);
    return prev.amount;
  },
  setMonthlyIncome: (psid, amount, month = monthOf(today())) => q.upsertIncome.run(psid, month, amount),

  addTxn: (psid, t) => q.insertTxn.run(psid, t.type, t.amount, t.category, t.note || "", t.date),
  undoLast(psid) {
    const last = q.lastTxn.get(psid);
    if (last) q.deleteTxn.run(last.id);
    return last;
  },
  txnsBetween: (psid, from, to) => q.txnsBetween.all(psid, from, to),
  loggedOn: (psid, day) => q.countOn.get(psid, day).n > 0,
};
