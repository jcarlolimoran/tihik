// Clean up environment variables pasted with stray quotes or spaces, e.g. TZ_NAME="Asia/Manila
// or ANTHROPIC_API_KEY="sk-ant-..." from Railway's Raw Editor. Required first by server.js and cron.js.
const KEYS = [
  "ANTHROPIC_API_KEY", "PAGE_ACCESS_TOKEN", "APP_SECRET", "VERIFY_TOKEN", "PUBLIC_URL", "APP_URL",
  "CRON_SECRET", "DB_PATH", "NODE_ENV", "TZ_NAME", "MODEL", "AI_MESSAGES_PER_DAY", "TIPS_PER_DAY", "MESSENGER_NAME_LOOKUP",
];

for (const key of KEYS) {
  const raw = process.env[key];
  if (raw === undefined) continue;
  const clean = raw.trim().replace(/^['"`]+|['"`]+$/g, "").trim();
  if (clean !== raw) {
    console.warn(`env: removed stray quotes/spaces from ${key}. Fix it in your Railway variables.`);
    process.env[key] = clean;
  }
}
