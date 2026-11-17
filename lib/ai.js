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
        enum: ["log", "set_monthly_income", "set_name", "summary", "tips", "dashboard", "undo", "help", "chat"],
        description:
          "log = record expenses and/or additional income (sideline, bonus, gift, refund); " +
          "set_monthly_income = user states or changes their regular income: salary, or a student's allowance (monthly, weekly or daily); " +
          "set_name = user wants to be called by a different name; " +
          "summary = user asks how much they spent, how much is left, or for a report; " +
          "tips = user asks for advice, tips or recommendations on saving or spending (e.g. 'tambag', 'unsaon nako pagtipig?'); " +
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
            note: { type: "string", description: "Short label in the user's words, e.g. 'jollibee', 'plete', 'bugas'." },
            date: { type: "string", description: "YYYY-MM-DD; today unless the user says otherwise (e.g. 'gahapon'/'kahapon' = yesterday, 'sa miaging Biyernes')." },
          },
          required: ["type", "amount", "category", "note", "date"],
        },
      },
      monthly_income: { type: "number", description: "For action=set_monthly_income: the amount exactly as stated, NOT converted (e.g. '1,500 kada semana' → 1500)." },
      income_period: { type: "string", enum: ["month", "week", "day"], description: "For action=set_monthly_income: how often that amount comes. Default month." },
      name: { type: "string", description: "For action=set_name: the name only, e.g. 'Carlo'." },
      reply: { type: "string", description: "For action=chat: short friendly reply in Bislish: mostly simple English mixed naturally with Cebuano/Bisaya words (e.g. 'Sige!', 'para nimo', 'gasto'). If the user writes only in Tagalog, reply in Taglish instead." },
    },
    required: ["action"],
  },
};

async function interpret(text) {
  const system =
    `You interpret messages sent to Tihik, a Facebook Messenger budgeting bot used in the Philippines. ` +
    `Most users are from Visayas and Mindanao and write Cebuano/Bisaya or Bislish shorthand, such as "jollibee 185", ` +
    `"plete 40 dayon load 99", "bugas 1,200 ug sud-an 150", "nag-sideline ko 2k", "grocery 2,350 gahapon", ` +
    `"30k na akong sweldo sugod karong bulana", "1,500 na akong allowance kada semana", "pila pa akong nahabilin?". ` +
    `Users include both workers and students. Some write Tagalog or English instead; ` +
    `understand those too. Bisaya hints: plete/pliti = fare (Transport), bugas = rice (Groceries), sud-an = viand (Food), ` +
    `gahapon = yesterday, ganina = earlier today, dayon/ug = and, nahabilin = remaining, gasto = expense. Currency is pesos. ` +
    `Today is ${today()} (${TZ}). Regular salary or allowance changes are set_monthly_income; one-off extra money (including "gihatagan ko og 500 ni Mama") is a log with ` +
    `type=income. Never invent amounts; if spending is mentioned without an amount, use chat and ask how much. ` +
    `Always answer by calling the interpret tool.`;

  const data = await callClaude({
    max_tokens: 800,
    system,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "interpret" },
    messages: [{ role: "user", content: text }],
  });
  return data.content.find((b) => b.type === "tool_use")?.input || { action: "chat" };
}

// Short, personal budgeting tips from the user's own numbers. `facts` is plain text built by the bot.
async function tips(facts) {
  const system =
    `You are Tihik, a friendly budgeting buddy on Facebook Messenger for Filipinos in Visayas and Mindanao ` +
    `(workers and students). Write in casual Bislish: mostly simple English mixed naturally with Cebuano/Bisaya words. Give 2 or 3 short, concrete tips based ONLY ` +
    `on the numbers given: point at the biggest categories, compare spending with the daily budget, and suggest a ` +
    `realistic peso amount to cut or save. Be encouraging, never preachy. Plain text for Messenger: one tip per line ` +
    `starting with an emoji, no headings, no markdown, under 500 characters in total. Budgeting habits only: never ` +
    `recommend investments, loans, apps, stocks or crypto. If there is very little data, give one tip and encourage ` +
    `them to keep logging.`;
  const data = await callClaude({ max_tokens: 400, system, messages: [{ role: "user", content: facts }] });
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

async function callClaude(body) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, ...body }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  return res.json();
}

module.exports = { interpret, tips, CATEGORIES };
