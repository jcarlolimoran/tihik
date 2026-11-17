// One user id per person, routed to the right chat app:
//   Messenger users: the Page-scoped id (PSID), as before
//   WhatsApp users:  "wa:" + their WhatsApp id (phone number)
const messenger = require("./messenger");
const whatsapp = require("./whatsapp");

const WA = "wa:";
const isWhatsApp = (userId) => String(userId).startsWith(WA);
const waUserId = (waId) => WA + waId;
const channelName = (userId) => (isWhatsApp(userId) ? "WhatsApp" : "Messenger");

// opts.type: Messenger messaging_type ("RESPONSE" | "UPDATE"); ignored on WhatsApp.
function send(userId, msg, opts) {
  return isWhatsApp(userId) ? whatsapp.send(userId.slice(WA.length), msg) : messenger.send(userId, msg, opts);
}

async function sendAll(userId, msgs) {
  for (const m of msgs) await send(userId, m);
}

module.exports = { send, sendAll, isWhatsApp, waUserId, channelName };
