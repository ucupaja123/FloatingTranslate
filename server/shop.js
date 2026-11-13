// ============================================================
//      TOKO: harga, pesanan beli bonus lagu / upgrade role
//      Pembayaran manual. Pesanan disetujui owner setelah bayar.
// ============================================================
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");
const quota = require("./listen-quota");
const { findByUsername, setAccountRole } = require("./account");

const DATA_DIR = path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "orders.json");
const SHOP = config.shop || { limitPacks: [], roleItems: [], maxPendingOrders: 3, paymentInfo: "" };

// Urutan level role: dipakai agar tidak menjual role yang lebih rendah atau sama
const RANK = { user: 0, premium: 1, reseller: 2, admin: 3, owner: 4 };

function load() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const raw = fs.readFileSync(FILE, "utf8");
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function save(arr) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
    fs.renameSync(tmp, FILE);
    return true;
  } catch (e) { console.error("orders save error:", e.message); return false; }
}

function findItem(itemId) {
  const pack = (SHOP.limitPacks || []).find(p => p.id === itemId);
  if (pack) return { kind: "listen", id: pack.id, label: pack.label, amount: pack.amount, price: pack.price };
  const role = (SHOP.roleItems || []).find(r => r.id === itemId);
  if (role) return { kind: "role", id: role.id, label: role.label, role: role.role, price: role.price };
  return null;
}

// Daftar yang bisa dibeli akun ini (role item hanya kalau naik level)
function catalogFor(acc) {
  const myRank = RANK[acc.role] ?? 0;
  return {
    limitPacks: (SHOP.limitPacks || []).map(p => ({ ...p, available: acc.role !== "owner" })),
    roleItems: (SHOP.roleItems || []).map(r => ({ ...r, available: (RANK[r.role] ?? 0) > myRank }))
  };
}

function createOrder(acc, itemId) {
  const item = findItem(itemId);
  if (!item) return { success: false, error: "Item tidak ada" };
  if (item.kind === "listen" && acc.role === "owner") return { success: false, error: "Owner sudah dengerin tanpa batas" };
  if (item.kind === "role" && (RANK[item.role] ?? 0) <= (RANK[acc.role] ?? 0)) {
    return { success: false, error: "Role kamu sudah sama atau lebih tinggi dari ini" };
  }
  const orders = load();
  const pending = orders.filter(o => o.username === acc.username && o.status === "pending").length;
  if (pending >= (SHOP.maxPendingOrders || 3)) {
    return { success: false, error: `Maksimal ${SHOP.maxPendingOrders || 3} pesanan menunggu. Tunggu dulu sampai disetujui owner.` };
  }
  const order = {
    id: crypto.randomBytes(6).toString("hex"),
    code: crypto.randomBytes(3).toString("hex").toUpperCase(),
    username: acc.username,
    kind: item.kind,
    itemId: item.id,
    label: item.label,
    amount: item.amount || 0,
    role: item.role || null,
    price: item.price,
    status: "pending",
    createdAt: Date.now(),
    decidedAt: null,
    decidedBy: null
  };
  orders.push(order);
  if (!save(orders)) return { success: false, error: "Gagal simpan pesanan" };
  return { success: true, data: order };
}

function listOrders(acc, all) {
  const orders = load();
  const visible = acc.role === "owner" && all ? orders : orders.filter(o => o.username === acc.username);
  return visible.sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
}

function decideOrder(orderId, owner, approve) {
  const orders = load();
  const order = orders.find(o => o.id === orderId);
  if (!order) return { success: false, error: "Pesanan tidak ditemukan" };
  if (order.status !== "pending") return { success: false, error: "Pesanan sudah diproses" };

  if (approve) {
    if (order.kind === "listen") {
      quota.addBonus(order.username, order.amount);
    } else if (order.kind === "role") {
      const target = findByUsername(order.username);
      if (!target) return { success: false, error: "Akun pembeli sudah tidak ada" };
      if ((RANK[target.role] ?? 0) >= (RANK[order.role] ?? 0)) {
        return { success: false, error: "Role pembeli sudah setara/lebih tinggi. Tolak pesanan ini." };
      }
      const r = setAccountRole({ username: order.username, role: order.role, requestedBy: owner.username });
      if (!r.success) return { success: false, error: r.error || "Gagal ubah role" };
    }
  }

  order.status = approve ? "approved" : "rejected";
  order.decidedAt = Date.now();
  order.decidedBy = owner.username;
  if (!save(orders)) return { success: false, error: "Gagal simpan keputusan" };
  return { success: true, data: order };
}

module.exports = function registerShop(app, { requireAccount, requireRoles }) {
  // Daftar harga + info pembayaran + limit per role
  app.get("/api/shop", requireAccount, (req, res) => {
    const acc = req.account;
    const limits = {};
    for (const [role, lim] of Object.entries(quota.LISTEN_LIMITS)) {
      limits[role] = { limit: lim === Infinity ? null : lim, period: quota.periodOf(role) };
    }
    res.json({
      success: true,
      data: {
        paymentInfo: SHOP.paymentInfo || "",
        ...catalogFor(acc),
        limits,
        me: { username: acc.username, role: acc.role, rank: RANK[acc.role] ?? 0 },
        quota: quota.status(acc.username, acc.role)
      }
    });
  });

  app.post("/api/shop/order", requireAccount, (req, res) => {
    const r = createOrder(req.account, String((req.body || {}).itemId || ""));
    if (!r.success) return res.status(400).json(r);
    res.json(r);
  });

  // Pesanan sendiri. Owner bisa lihat semua dengan ?all=1
  app.get("/api/shop/orders", requireAccount, (req, res) => {
    const all = req.query.all === "1";
    res.json({ success: true, data: listOrders(req.account, all) });
  });

  app.post("/api/shop/orders/:id/approve", requireAccount, requireRoles("owner"), (req, res) => {
    const r = decideOrder(req.params.id, req.account, true);
    if (!r.success) return res.status(400).json(r);
    res.json(r);
  });

  app.post("/api/shop/orders/:id/reject", requireAccount, requireRoles("owner"), (req, res) => {
    const r = decideOrder(req.params.id, req.account, false);
    if (!r.success) return res.status(400).json(r);
    res.json(r);
  });
};

module.exports.RANK = RANK;
