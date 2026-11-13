// config.js
// Semua rahasia dibaca dari environment variable (diatur di Render/Railway).
const env = (name) => process.env[name] || "";
// Akun awal hanya dibuat kalau password-nya diisi lewat env SEED_*_PASS.
const seed = (username, role, passEnv) => {
  const password = env(passEnv);
  return password ? [{ username, password, role, createdBy: "system" }] : [];
};

module.exports = {
  // ===== BOT TELEGRAM =====
  tokens: env("BOT_TOKEN"),
  owner: env("BOT_OWNER_ID"),

  // ===== BOT INFO =====
  botName: "PRIMSIC BOT",
  botUsername: "@XCrashBot",

  // ===== OWNER IDS (tambahan) =====
  ownerIds: [env("BOT_OWNER_ID"), "u_owner_primo", "owner"].filter(Boolean),

  // ===== KEYS =====
  ownerKey: env("OWNER_KEY"),
  adminKey: env("ADMIN_KEY"),
  resellerKey: env("RESELLER_KEY"),
  premiumKey: env("PREMIUM_KEY"),

  // ===== ACCOUNT SYSTEM =====
  // Sesi login (token) disimpan di data/sessions.json
  sessionDays: 30,
  accountFile: "./data/accounts.json",
  maxAccountsPerUser: 50,
  maxAccountsPerBot: 500,
  minUsernameLength: 2,
  minPasswordLength: 6,
  usernamePattern: /^[A-Za-z0-9_.-]{2,20}$/,

  roleHierarchy: {
    owner:    ["owner", "user", "premium", "admin", "reseller"],
    admin:    ["premium", "reseller"],
    reseller: ["premium"],
    premium:  [],
    user:     []
  },

  roleLabels: {
    owner: "👑 Owner", admin: "🛡️ Admin", reseller: "💎 Reseller",
    premium: "⭐ Premium", user: "👤 User"
  },

  // ===== TOKO (harga & beli limit) =====
  // Harga di bawah ini CONTOH. Ganti sesuai harga kamu (angka dalam Rupiah).
  // Pembayaran belum otomatis: pembeli kirim pesanan, owner cek pembayaran
  // lalu menyetujui di tab "Harga & Limit".
  shop: {
    paymentInfo: "Bayar sesuai nominal ke rekening/QRIS owner (atur teks ini di config.js → shop.paymentInfo). Tulis kode pesanan di berita transfer, lalu tunggu owner menyetujui.",
    maxPendingOrders: 3,
    limitPacks: [
      { id: "pack10",  label: "Tambah 10 lagu",  amount: 10,  price: 5000 },
      { id: "pack30",  label: "Tambah 30 lagu",  amount: 30,  price: 12000 },
      { id: "pack100", label: "Tambah 100 lagu", amount: 100, price: 35000 }
    ],
    roleItems: [
      { id: "role_premium",  role: "premium",  label: "Upgrade ke Premium",  price: 20000 },
      { id: "role_reseller", role: "reseller", label: "Upgrade ke Reseller", price: 75000 },
      { id: "role_admin",    role: "admin",    label: "Upgrade ke Admin",    price: 150000 }
    ]
  },

  seedAccounts: [
    ...seed("owner", "owner", "SEED_OWNER_PASS"),
    ...seed("admin", "admin", "SEED_ADMIN_PASS"),
    ...seed("reseller", "reseller", "SEED_RESELLER_PASS"),
    ...seed("premium", "premium", "SEED_PREMIUM_PASS")
  ]
};