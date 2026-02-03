const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

// ====== STORAGE UPLOAD ======
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const allowedExt = new Set([
  ".pdf",
  ".csv",
  ".zip",
  ".doc",
  ".docx",
  ".jpeg",
  ".jpg",
  ".png",
]);
const allowedMime = new Set([
  "application/pdf",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeBase = path
      .basename(file.originalname, ext)
      .replace(/[^a-z0-9-_]/gi, "_")
      .slice(0, 60);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    cb(null, `${safeBase}-${stamp}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok = allowedExt.has(ext) && allowedMime.has(file.mimetype);
    if (!ok) {
      return cb(
        new Error(
          "File type not allowed. Allowed: pdf,csv,zip,doc,docx,jpeg,jpg,png",
        ),
      );
    }
    cb(null, true);
  },
});

// Serve file (opsional) biar bisa diakses via URL
app.use("/uploads", express.static(UPLOAD_DIR));

// ====== "DB" SEDERHANA (JSON FILE) ======
const DB_FILE = path.join(__dirname, "db.json");

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const init = {
      accounts: [
        { id: 1, name: "Kas Kecil", active: true },
        { id: 2, name: "Kas Besar", active: true },
        { id: 3, name: "FB Ads", active: true },
        { id: 4, name: "FB Ads White List", active: true },
        { id: 5, name: "Biaya Paper ID", active: true },
        { id: 6, name: "Wirahadi Teja 559", active: true },
      ],
      transfers: [],
      lastTransferId: 0,
      deposits: [],
      lastDepositId: 0,
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2), "utf-8");
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
}

// ====== HELPERS VALIDASI ======
function isValidDateYYYYMMDD(s) {
  // validasi basic: 2026-02-02
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function toInt(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

// ====== ENDPOINT 1: DROPDOWN OPTIONS ======
app.get("/api/accounts/options", (req, res) => {
  const db = loadDB();
  const accounts = db.accounts
    .filter((a) => a.active)
    .map((a) => ({ id: a.id, name: a.name }));
  res.json({ data: { accounts } });
});

// ====== ENDPOINT 2: SUBMIT FUND TRANSFER ======
// menerima multipart/form-data:
// transfer_from, transfer_to, amount, date, note, document(file)
app.post("/api/fund-transfers", upload.single("document"), (req, res) => {
  try {
    const db = loadDB();

    const transfer_from = toInt(req.body.transfer_from);
    const transfer_to = toInt(req.body.transfer_to);
    const amount = toInt(req.body.amount);
    const date = req.body.date;
    const note = req.body.note; // OPSIONAL: bisa undefined

    // ===== VALIDASI WAJIB =====
    if (transfer_from === null) {
      return res
        .status(400)
        .json({ error: "transfer_from is required and must be integer" });
    }
    if (transfer_to === null) {
      return res
        .status(400)
        .json({ error: "transfer_to is required and must be integer" });
    }
    if (transfer_from === transfer_to) {
      return res
        .status(400)
        .json({ error: "transfer_to must be different from transfer_from" });
    }

    const fromAcc = db.accounts.find((a) => a.id === transfer_from && a.active);
    const toAcc = db.accounts.find((a) => a.id === transfer_to && a.active);
    if (!fromAcc)
      return res.status(400).json({ error: "transfer_from not found/active" });
    if (!toAcc)
      return res.status(400).json({ error: "transfer_to not found/active" });

    if (amount === null || amount < 1) {
      return res
        .status(400)
        .json({ error: "amount is required and must be integer >= 1" });
    }

    // date WAJIB: beda pesan antara kosong vs salah format
    if (!date || String(date).trim() === "") {
      return res.status(400).json({ error: "date is required" });
    }
    if (!isValidDateYYYYMMDD(date)) {
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    }

    // ===== VALIDASI OPSIONAL =====
    // note boleh tidak ada; kalau ada harus string dan max 2000
    if (note !== undefined && typeof note !== "string") {
      return res.status(400).json({ error: "note must be string" });
    }
    if (typeof note === "string" && note.length > 2000) {
      return res.status(400).json({ error: "note max length 2000" });
    }

    // File optional (document)
    let document = null;
    if (req.file) {
      document = {
        originalName: req.file.originalname,
        storedName: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
        url: `/uploads/${req.file.filename}`,
      };
    }

    // Simpan transfer
    const newId = (db.lastTransferId || 0) + 1;
    db.lastTransferId = newId;

    const transfer = {
      id: newId,
      transfer_from,
      transfer_to,
      amount,
      date: String(date).trim(),
      note: note ?? "", // simpan kosong kalau tidak diisi
      document,
      created_at: new Date().toISOString(),
    };

    db.transfers.push(transfer);
    saveDB(db);

    return res.status(201).json({
      message: "Fund transfer created",
      data: transfer,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: err.message || "Internal server error" });
  }
});
// ====== ENDPOINT: SUBMIT DEPOSIT ======
// menerima multipart/form-data:
// deposit_to, deposit_from(optional), amount, date, note, document(file)
app.post("/api/deposits", upload.single("document"), (req, res) => {
  try {
    const db = loadDB();

    if (!Array.isArray(db.deposits)) db.deposits = [];
    if (typeof db.lastDepositId !== "number") db.lastDepositId = 0;

    const deposit_to = toInt(req.body.deposit_to);
    const deposit_from =
      req.body.deposit_from !== undefined &&
      String(req.body.deposit_from).trim() !== ""
        ? toInt(req.body.deposit_from)
        : null;

    const amount = toInt(req.body.amount);
    const date = req.body.date;
    const note = req.body.note;

    // ===== VALIDASI WAJIB =====
    if (deposit_to === null) {
      return res
        .status(400)
        .json({ error: "deposit_to is required and must be integer" });
    }

    const toAcc = db.accounts.find((a) => a.id === deposit_to && a.active);
    if (!toAcc)
      return res.status(400).json({ error: "deposit_to not found/active" });

    if (amount === null || amount < 1) {
      return res
        .status(400)
        .json({ error: "amount is required and must be integer >= 1" });
    }

    if (!date || String(date).trim() === "") {
      return res.status(400).json({ error: "date is required" });
    }
    if (!isValidDateYYYYMMDD(date)) {
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    }

    // ===== VALIDASI OPSIONAL =====
    if (deposit_from !== null) {
      if (deposit_from === null) {
        return res
          .status(400)
          .json({ error: "deposit_from must be integer if provided" });
      }

      const fromAcc = db.accounts.find(
        (a) => a.id === deposit_from && a.active,
      );
      if (!fromAcc)
        return res.status(400).json({ error: "deposit_from not found/active" });

      if (deposit_from === deposit_to) {
        return res.status(400).json({
          error: "deposit_from must be different from deposit_to",
        });
      }
    }

    if (note !== undefined && typeof note !== "string") {
      return res.status(400).json({ error: "note must be string" });
    }
    if (typeof note === "string" && note.length > 2000) {
      return res.status(400).json({ error: "note max length 2000" });
    }

    // ===== FILE OPTIONAL =====
    // let document = null;
    // if (req.file) {
    //   document = {
    //     originalName: req.file.originalname,
    //     storedName: req.file.filename,
    //     mimeType: req.file.mimetype,
    //     size: req.file.size,
    //     url: `/uploads/${req.file.filename}`,
    //   };
    // }

    // ===== SIMPAN =====
    const newId = db.lastDepositId + 1;
    db.lastDepositId = newId;

    const deposit = {
      id: newId,
      deposit_to,
      deposit_from,
      amount,
      date: String(date).trim(),
      note: note ?? "",
   
      created_at: new Date().toISOString(),
    };

    db.deposits.push(deposit);
    saveDB(db);

    return res.status(201).json({
      message: "Deposit created",
      data: deposit,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: err.message || "Internal server error" });
  }
});


// ====== EXTRA: LIST TRANSFERS (opsional) ======
app.get("/api/fund-transfers", (req, res) => {
  const db = loadDB();
  res.json({ data: db.transfers });
});

app.get("/api/deposits", (req, res) => {
  const db = loadDB();
  const deposits = Array.isArray(db.deposits) ? db.deposits : [];
  res.json({ data: deposits });
});


const PORT = process.env.PORT || 3205;
app.listen(PORT, () => {
  console.log(`Fund Transfer API running on http://localhost:${PORT}`);
});
