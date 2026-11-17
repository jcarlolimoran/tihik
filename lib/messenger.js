// Facebook Messenger Send API + webhook signature check.
const crypto = require("node:crypto");

const GRAPH = "https://graph.facebook.com/v21.0";

// type: "RESPONSE" for replies, "UPDATE" for messages we start (cron), still only inside the 24h window.
async function send(psid, msg, { type = "RESPONSE" } = {}) {
  const message = msg.button
    ? {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: msg.text.slice(0, 640),
            buttons: [{ type: "web_url", url: msg.button.url, title: msg.button.title.slice(0, 20), webview_height_ratio: "full" }],
          },
        },
      }
    : { text: msg.text.slice(0, 2000) };

  const body = { recipient: { id: psid }, messaging_type: type, message };

  const res = await fetch(`${GRAPH}/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("Send API error", res.status, err);
    return false;
  }
  return true;
}

async function sendAll(psid, msgs) {
  for (const m of msgs) await send(psid, m);
}

async function typing(psid) {
  await fetch(`${GRAPH}/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: psid }, sender_action: "typing_on" }),
  }).catch(() => {});
}

function validSignature(raw, header) {
  const secret = process.env.APP_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // never skip the check in production
  if (!header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

module.exports = { send, sendAll, typing, validSignature };
