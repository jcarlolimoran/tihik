// Claude reads a free-form chat message and returns a structured intent.
const { today, TZ } = require("./dates");

const MODEL = process.env.MODEL || "claude-haiku-5-5";

const CATEGORIES = [
  "Food", "Groceries", "Transport", "Bills", "Load/Internet", "Shopping", "Health",
  "Family", "Education", "Personal", "Entertainment", "Savings", "Sideline", "Bonus", "Other",
];

const TOOL = {
  name: "interpret",
  description: "Interpret one message sent to Tihik, a budgeting chatbot.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["log", "set_monthly_income", "summary", "dashboard", "undo", "help", "chat"],
        description:
          "log = record expenses and/or additional income (sideline, bonus, gift, refund); " +
          "set_monthly_income = user states or changes their regular MONTHLY income/salary; " +
          "summary = user asks how much they spent, how much is left, or for a report; " +
          "dashboard = user asks for their dashboard/link/chart; undo = delete last entry; " +
          "help = what can you do; chat = anything else.",
      },
      transactions: {
        type: "array",
        description: "For action=log. One item per amount mentioned.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["expense", "income"] },
            amount: { type: "number", description: "Pesos, positive. '1.5k' = 1500." },
            category: { type: "string", enum: CATEGORIES },
            note: { type: "string", description: "Short label in the user's words, e.g. 'jollibee', 'pamasahe'." },
            date: { type: "string", description: "YYYY-MM-DD; today unless the user says otherwise (e.g. 'kahapon')." },
          },
          required: ["type", "amount", "category", "note", "date"],
        },
      },
      monthly_income: { type: "number", description: "For action=set_monthly_income." },
      reply: { type: "string", description: "For action=chat: short friendly reply in the user's language (Taglish ok)." },
    },
    required: ["action"],
  },
};

async function interpret(text) {
  const system =
    `You interpret messages sent to Tihik, a Facebook Messenger budgeting bot used in the Philippines. ` +
    `Users write English, Tagalog, Bisaya or Taglish shorthand such as "jollibee 185", "pamasahe 40 tapos load 99", ` +
    `"may sideline ako 2k", "grocery 2,350 kahapon", "30k na sweldo ko starting this month". Currency is pesos. ` +
    `Today is ${today()} (${TZ}). Regular salary changes are set_monthly_income; one-off extra money is a log with ` +
    `type=income. Never invent amounts; if spending is mentioned without an amount, use chat and ask how much. ` +
    `Always answer by calling the interpret tool.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      system,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "interpret" },
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.find((b) => b.type === "tool_use")?.input || { action: "chat" };
}

module.exports = { interpret, CATEGORIES };
