const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  comments: path.join(DATA_DIR, "comments.json"),
  plays: path.join(DATA_DIR, "plays.json"),
  follows: path.join(DATA_DIR, "follows.json"),
  weekly: path.join(DATA_DIR, "weekly.json"),
  chat: path.join(DATA_DIR, "chat.json"),
  users: path.join(DATA_DIR, "users.json")
};

const ADMIN_KEY = process.env.ADMIN_KEY || "";

function load(file) {
  try {
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

function save(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  catch (e) { console.error("DB save error:", e.message); }
}

function getUsers() { return load(FILES.users); }

function getUser(userId) { return load(FILES.users)[userId] || null; }

function registerUser(userId, name) {
  const db = load(FILES.users);
  if (!db[userId]) {
    db[userId] = {
      userId, name: name || "User", role: "user",
      banned: false, ts: Date.now(), lastSeen: Date.now()
    };
  } else {
    if (name) db[userId].name = name;
    db[userId].lastSeen = Date.now();
  }
  save(FILES.users, db);
  return db[userId];
}

function setRole(userId, role) {
  const db = load(FILES.users);
  if (!db[userId]) return false;
  db[userId].role = role;
  save(FILES.users, db);
  return true;
}

function banUser(userId, banned = true) {
  const db = load(FILES.users);
  if (!db[userId]) return false;
  db[userId].banned = banned;
  save(FILES.users, db);
  return true;
}

function isOwner(userId) { return getUser(userId)?.role === "owner"; }
function isAdmin(userId) {
  const u = getUser(userId);
  return u?.role === "admin" || u?.role === "owner";
}
function isBanned(userId) { return getUser(userId)?.banned === true; }

function getComments(videoId) { return load(FILES.comments)[videoId] || []; }

function addComment(videoId, { userId, name, text }) {
  if (isBanned(userId)) return { error: "banned" };
  const db = load(FILES.comments);
  if (!db[videoId]) db[videoId] = [];
  const user = getUser(userId);
  const comment = {
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    userId, name: name || user?.name || "Anonim",
    role: user?.role || "user",
    text: text.substring(0, 500), ts: Date.now()
  };
  db[videoId].push(comment);
  if (db[videoId].length > 200) db[videoId] = db[videoId].slice(-200);
  save(FILES.comments, db);
  return comment;
}

function deleteComment(videoId, commentId, requesterId) {
  const db = load(FILES.comments);
  if (!db[videoId]) return { ok: false };
  const target = db[videoId].find(c => c.id === commentId);
  if (!target) return { ok: false };
  const canDelete = target.userId === requesterId || isAdmin(requesterId);
  if (!canDelete) return { ok: false, error: "no-permission" };
  db[videoId] = db[videoId].filter(c => c.id !== commentId);
  save(FILES.comments, db);
  return { ok: true };
}

function trackPlay(videoId, song, userId) {
  const db = load(FILES.plays);
  if (!db[videoId]) {
    db[videoId] = {
      videoId, title: song.title || "", artist: song.artist || "",
      thumbnail: song.thumbnail || "", count: 0, listeners: {}, lastPlayed: 0
    };
  }
  db[videoId].count += 1;
  db[videoId].lastPlayed = Date.now();
  if (song.title) db[videoId].title = song.title;
  if (song.artist) db[videoId].artist = song.artist;
  if (song.thumbnail) db[videoId].thumbnail = song.thumbnail;
  if (userId) {
    if (!db[videoId].listeners[userId]) db[videoId].listeners[userId] = 0;
    db[videoId].listeners[userId] += 1;
  }
  save(FILES.plays, db);
  return db[videoId];
}

function getTopSongs(limit = 20) {
  return Object.values(load(FILES.plays)).sort((a, b) => b.count - a.count).slice(0, limit);
}

function getTopListeners(limit = 20) {
  const db = load(FILES.plays);
  const userMap = {};
  for (const song of Object.values(db)) {
    for (const [userId, count] of Object.entries(song.listeners || {})) {
      if (!userMap[userId]) userMap[userId] = { userId, count: 0, songs: new Set() };
      userMap[userId].count += count;
      userMap[userId].songs.add(song.videoId);
    }
  }
  return Object.values(userMap)
    .map(u => ({ userId: u.userId, count: u.count, uniqueSongs: u.songs.size }))
    .sort((a, b) => b.count - a.count).slice(0, limit);
}

function follow(userId, artistName) {
  const db = load(FILES.follows);
  if (!db[userId]) db[userId] = [];
  const name = artistName.trim();
  if (!name || db[userId].includes(name)) return false;
  db[userId].push(name);
  save(FILES.follows, db);
  return true;
}

function unfollow(userId, artistName) {
  const db = load(FILES.follows);
  if (!db[userId]) return false;
  const before = db[userId].length;
  db[userId] = db[userId].filter(a => a !== artistName);
  save(FILES.follows, db);
  return db[userId].length < before;
}

function getFollows(userId) { return load(FILES.follows)[userId] || []; }

function saveWeekly(userId, playlist) {
  const db = load(FILES.weekly);
  db[userId] = { playlist, ts: Date.now() };
  save(FILES.weekly, db);
}

function getWeekly(userId) { return load(FILES.weekly)[userId] || null; }

function getChat(roomId, limit = 100) {
  return (load(FILES.chat)[roomId] || []).slice(-limit);
}

function addChat(roomId, { userId, name, text }) {
  if (isBanned(userId)) return { error: "banned" };
  const db = load(FILES.chat);
  if (!db[roomId]) db[roomId] = [];
  const user = getUser(userId);
  const msg = {
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    userId, name: name || user?.name || "Anonim",
    role: user?.role || "user",
    text: text.substring(0, 300), ts: Date.now()
  };
  db[roomId].push(msg);
  if (db[roomId].length > 300) db[roomId] = db[roomId].slice(-300);
  save(FILES.chat, db);
  return msg;
}

function initOwner() {
  const db = load(FILES.users);
  const hasOwner = Object.values(db).some(u => u.role === "owner");
  if (!hasOwner) {
    db["u_owner_primo"] = {
      userId: "u_owner_primo", name: "Primo", role: "owner",
      banned: false, ts: Date.now(), lastSeen: Date.now()
    };
    save(FILES.users, db);
    console.log("👑 Owner 'Primo' siap (login via tombol Owner di halaman login)");
  }
}

initOwner();

module.exports = {
  getComments, addComment, deleteComment,
  trackPlay, getTopSongs, getTopListeners,
  follow, unfollow, getFollows,
  saveWeekly, getWeekly,
  getChat, addChat,
  getUsers, getUser, registerUser, setRole, banUser,
  isOwner, isAdmin, isBanned,
  ADMIN_KEY
};