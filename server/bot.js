// bot.js
const TelegramBot = require("node-telegram-bot-api");
const config = require("./config");
const {
  findByCredentials, createAccount, deleteAccount,
  listAccountsBy, listAllAccounts, canCreate, getAvailableRoles, getStats
} = require("./accounts");

const bot = new TelegramBot(config.tokens, { polling: true });
const sessions = {};

function isOwner(chatId) {
  const idStr = String(chatId);
  if (idStr === String(config.owner)) return true;
  if (config.ownerIds && config.ownerIds.includes(idStr)) return true;
  return false;
}
function requireLogin(chatId) {
  const s = sessions[chatId];
  if (!s) { bot.sendMessage(chatId, "❌ Login dulu: /login username password"); return null; }
  return s;
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const isOwn = isOwner(chatId);
  let text = `🤖 *${config.botName}*\n\n`;
  if (isOwn) text += `👑 Owner detected!\n\n`;
  text += `*Umum:*\n/login <username> <password>\n/me\n/logout\n/help\n\n`;
  text += `*Account:*\n/create <user> <pass> <role>\n/myaccounts\n/delete <user>\n/roles\n`;
  if (isOwn) text += `\n*Owner:*\n/stats\n/list\n`;
  bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
});

bot.onText(/\/login\s+(.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const args = match[1].split(/\s+/);
  if (args.length < 2) return bot.sendMessage(chatId, "Format: /login username password");
  const [username, password] = args;
  if (isOwner(chatId)) {
    sessions[chatId] = { username: "owner", role: "owner", tgOwner: true };
    return bot.sendMessage(chatId, "✅ Login sebagai Owner (via Telegram ID)");
  }
  const acc = findByCredentials(username, password);
  if (!acc) return bot.sendMessage(chatId, "❌ Username atau password salah");
  sessions[chatId] = { username: acc.username, role: acc.role };
  bot.sendMessage(chatId, `✅ Login!\n👤 ${acc.username}\n🎭 ${config.roleLabels[acc.role] || acc.role}`);
});

bot.onText(/\/me/, (msg) => {
  const chatId = msg.chat.id;
  const s = requireLogin(chatId); if (!s) return;
  bot.sendMessage(chatId, `👤 ${s.username}\n🎭 ${config.roleLabels[s.role] || s.role}\nTG ID: ${chatId}`);
});

bot.onText(/\/logout/, (msg) => { delete sessions[msg.chat.id]; bot.sendMessage(msg.chat.id, "👋 Logout"); });

bot.onText(/\/create\s+(.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const s = requireLogin(chatId); if (!s) return;
  const args = match[1].split(/\s+/);
  if (args.length < 3) return bot.sendMessage(chatId, "Format: /create <username> <password> <role>");
  const [username, password, role] = args;
  if (!canCreate(s.username, role)) {
    const avail = getAvailableRoles(s.username);
    return bot.sendMessage(chatId, `❌ Tidak bisa buat ${role}.\nBisa: ${avail.map(r => config.roleLabels[r]).join(", ") || "tidak ada"}`);
  }
  const result = createAccount({ username, password, role, createdBy: s.username });
  if (!result.success) return bot.sendMessage(chatId, `❌ ${result.error}`);
  bot.sendMessage(chatId, `✅ Akun dibuat!\n\n👤 ${username}\n🔑 ${password}\n🎭 ${config.roleLabels[role]}`);
});

bot.onText(/\/myaccounts/, (msg) => {
  const chatId = msg.chat.id;
  const s = requireLogin(chatId); if (!s) return;
  const list = s.role === "owner" ? listAllAccounts() : listAccountsBy(s.username);
  if (list.length === 0) return bot.sendMessage(chatId, "📭 Belum ada akun");
  let text = `📋 Akun (${list.length})\n\n`;
  list.slice(0, 30).forEach((a, i) => { text += `${i + 1}. ${a.username} — ${config.roleLabels[a.role] || a.role}\n`; });
  bot.sendMessage(chatId, text);
});

bot.onText(/\/delete\s+(.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const s = requireLogin(chatId); if (!s) return;
  const r = deleteAccount({ username: match[1].trim(), requestedBy: s.username });
  if (!r.success) return bot.sendMessage(chatId, `❌ ${r.error}`);
  bot.sendMessage(chatId, `🗑 Akun ${match[1].trim()} dihapus`);
});

bot.onText(/\/roles/, (msg) => {
  const chatId = msg.chat.id;
  const s = requireLogin(chatId); if (!s) return;
  const avail = getAvailableRoles(s.username);
  if (avail.length === 0) return bot.sendMessage(chatId, "❌ Tidak bisa buat akun");
  bot.sendMessage(chatId, `🎭 Bisa buat:\n${avail.map(r => `• ${config.roleLabels[r]}`).join("\n")}`);
});

bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  const s = sessions[chatId];
  if (!isOwner(chatId) && (!s || s.role !== "owner")) return bot.sendMessage(chatId, "❌ Owner only");
  const st = getStats();
  bot.sendMessage(chatId, `📊 Stats\n\nTotal: ${st.total}\n👑 ${st.byRole.owner}\n🛡️ ${st.byRole.admin}\n💎 ${st.byRole.reseller}\n⭐ ${st.byRole.premium}\n👤 ${st.byRole.user}`);
});

bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const s = sessions[chatId];
  if (!isOwner(chatId) && (!s || s.role !== "owner")) return bot.sendMessage(chatId, "❌ Owner only");
  const list = listAllAccounts();
  let text = `📋 Semua Akun (${list.length})\n\n`;
  list.slice(0, 50).forEach((a, i) => {
    text += `${i + 1}. ${a.username} — ${config.roleLabels[a.role] || a.role}`;
    if (a.createdBy) text += ` (by ${a.createdBy})`;
    text += `\n`;
  });
  bot.sendMessage(chatId, text);
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, "/start /login /me /logout /create /myaccounts /delete /roles /stats /list /help");
});

console.log(`🤖 ${config.botName} running...`);