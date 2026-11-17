// WhatsApp Cloud API: send replies and parse incoming webhooks.
// Env: WHATSAPP_TOKEN (system-user or temporary access token), WHATSAPP_PHONE_NUMBER_ID.
const GRAPH = "https://graph.facebook.com/v21.0";

// Like Messenger, WhatsApp only allows free-form messages within 24h of the user's last message.
// Our cron already skips users outside that window, so no message templates are needed.
async function call(body) {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id || !process.env.WHATSAPP_TOKEN) {
    console.error("WhatsApp not configured: set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID");
    return false;
  }
  const res = await fetch(`${GRAPH}/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  if (!res.ok) {
    console.error("WhatsApp API error", res.status, await res.text());
    return false;
  }
  return true;
}

// msg: { text } or { text, button: { title, url } } (same shape the bot returns for Messenger)
function send(waId, msg) {
  if (msg.button) {
    return call({
      to: waId,
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: msg.text.slice(0, 1024) },
        action: { name: "cta_url", parameters: { display_text: msg.button.title.slice(0, 20), url: msg.button.url } },
      },
    });
  }
  return call({ to: waId, type: "text", text: { body: msg.text.slice(0, 4096), preview_url: false } });
}

// Blue ticks + "typing…" while we work on the reply. Best effort.
function typing(messageId) {
  if (!messageId) return;
  call({ status: "read", message_id: messageId, typing_indicator: { type: "text" } }).catch(() => {});
}

// Webhook body (object: "whatsapp_business_account") → [{ waId, name, text, messageId, unsupported }]
function parseWebhook(body) {
  const out = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        const text =
          m.type === "text" ? m.text?.body :
          m.type === "button" ? m.button?.text :
          m.type === "interactive" ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title) :
          null;
        out.push({ waId: m.from, name: names[m.from] || null, text: text ?? null, messageId: m.id, unsupported: text == null });
      }
    }
  }
  return out;
}

module.exports = { send, typing, parseWebhook };
