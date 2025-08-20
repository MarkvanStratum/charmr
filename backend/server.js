import express from "express";
import cors from "cors";
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pkg from "pg";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";
import SibApiV3Sdk from 'sib-api-v3-sdk';
import { sendWelcomeEmail } from './email.js';
import crypto from 'crypto';
import { sendPasswordResetEmail } from './email.js';

// 🔹 NEW: file ops + uploads
import fs from "fs";
import multer from "multer";

// 🔹 NEW: central subscription logic (keeps this file small)
import {
  ensureSubscriptionTables,
  entitlementsFromRow,
  getUserSubscription,
  requireEntitlement,
  stripeWebhookHandler,
  upsertSubscription
} from "./subscriptions.js";

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const transactionalEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

const contactsApi = new SibApiV3Sdk.ContactsApi();
async function upsertBrevoContact({ email, attributes = {}, listId = process.env.BREVO_LIST_ID }) {
  // create OR update, and add to your list
  const payload = new SibApiV3Sdk.CreateContact();
  payload.email = email;
  payload.attributes = attributes;               // e.g. { SOURCE: 'signup' }
  payload.listIds = [Number(listId)];
  payload.updateEnabled = true;

  try {
    await contactsApi.createContact(payload);
  } catch (e) {
    // don’t block the user flow if Brevo hiccups
    console.warn("Brevo contact upsert failed:", e?.response?.text || e.message);
  }
}

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 10000;
const SECRET_KEY = process.env.SECRET_KEY || "yoursecretkey";

// 🔹 NEW: operator auth key
const OPERATOR_KEY = process.env.OPERATOR_KEY || "";

// 🔹 NEW: uploads setup (serve at /uploads)
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOAD_DIR));

// Static site
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/send-email', async (req, res) => {
  const { toEmail, subject, htmlContent } = req.body;

  const sender = { email: 'no-reply@charmr.xyz', name: 'Your App' }; // Change this to your verified sender
  const receivers = [{ email: toEmail }];

  try {
    await transactionalEmailApi.sendTransacEmail({
      sender,
      to: receivers,
      subject,
      htmlContent,
    });

upsertBrevoContact({
  email: receivers[0].email,   // ← correct variable
  attributes: { SOURCE: 'contact' }
});

res.status(200).json({ message: 'Email sent successfully' });

    res.status(200).json({ message: 'Email sent successfully' });
  } catch (error) {
    console.error('❌ Error sending email:', error);
    res.status(500).json({ message: 'Failed to send email' });
  }
});


app.use(cors());
// Stripe needs raw body for webhooks
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});


const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.get("/api/get-stripe-session", async (req, res) => {
  try {
    const sessionId = req.query.session_id;

    if (!sessionId) {
      return res.status(400).json({ error: "Missing session_id" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    res.json({
      id: session.id,
      amount_subtotal: session.amount_subtotal,
      amount_total: session.amount_total,
      currency: session.currency
    });
  } catch (error) {
    console.error("Error fetching Stripe session:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,  -- unique identifier for each user
  email TEXT UNIQUE NOT NULL,  -- user's email (must be unique)
  password TEXT NOT NULL,  -- user's password (hashed)
  gender TEXT,  -- user's gender
  lookingfor TEXT,  -- what the user is looking for (e.g., relationship, friendship)
  phone TEXT,  -- user's phone number
  credits INT DEFAULT 10,  -- initial credits for the user, default is 10
  lifetime BOOLEAN DEFAULT false,  -- indicates whether the user has a lifetime membership
  reset_token TEXT,  -- token generated for password reset
  reset_token_expires TIMESTAMP  -- expiration time for the reset token
);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        girl_id INT NOT NULL,
        from_user BOOLEAN NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 🔹 NEW: track live-agent takeovers (simple flag per user+girl)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS operator_overrides (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        girl_id INT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        operator_name TEXT,
        started_at TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_operator_override_active
      ON operator_overrides(user_id, girl_id) WHERE is_active = true;
    `);

    // 🔹 NEW: make sure subscriptions table exists (centralized entitlements)
    await ensureSubscriptionTables(pool);

    console.log("✅ Tables are ready");
  } catch (err) {
    console.error("❌ Error creating tables:", err);
  }
})();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const profiles = [
  {
    "id": 1,
    "name": "Amber Taylor",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/1.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 2,
    "name": "Mia Smith",
    "city": "Bath",
    "image": "https://notadatingsite.online/pics/2.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 3,
    "name": "Chloe Moore",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/3.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  }  ,{
    "id": 4,
    "name": "Skye Bennett",
    "city": "Liverpool",
    "image": "https://notadatingsite.online/pics/4.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 5,
    "name": "Ruby Davies",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/5.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  } ,
  

];

const firstMessages = {
  1: "Hey",
2: "How are you?",
3: "Hi",
4: "Hey you",
5: "Hello",
6: "What’s up?",
7: "Hi there",
8: "Hey stranger",
9: "Morning",
10: "Good morning",
11: "Good evening",
12: "Hi hi",
13: "Hey cutie",
14: "Hey",
15: "Evening",
16: "Hola",
17: "Hey you",
18: "Hi",
19: "Hello",
20: "Hey",
21: "Hey there",
22: "Hi",
23: "Hey you",
24: "Hi",
25: "Hello",
26: "Hey",
27: "Hi",
28: "Hey you",
29: "Hello",
30: "Hey",
31: "Hi",
32: "Hello",
33: "Hey",
34: "Hi",
35: "Hey you",
36: "Hey",
37: "Hi",
38: "Hello",
39: "Hey",
40: "Hi",
41: "Hello",
42: "Hey",
43: "Hi",
44: "Hey you",
45: "Hi",
46: "Hey",
47: "Hello",
48: "Hey",
49: "Hi",
50: "Hey",
51: "Hello",
52: "Hey",
53: "Hi",
54: "Hello",
55: "Hey",
56: "Hi",
57: "Hey you",
58: "Hi",
59: "Hello",
60: "Hey",
61: "Hi",
62: "Hello",
63: "Hey",
64: "Hi",
65: "Hey",
66: "Hello",
67: "Hi",
68: "Hey you",
69: "Hi",
70: "Hello",
71: "Hey",
72: "Hi",
73: "Hey",
74: "Hello",
75: "Hey",
76: "Hi",
77: "Hey you",
78: "Hi",
79: "Hello",
80: "Hey",
81: "Hi",
82: "Hey",
83: "Hello",
84: "Hey you",
85: "Hi",
86: "Hello",
87: "Hey",
88: "Hi",
89: "Hey",
90: "Hello",
91: "Hey",
92: "Hi",
93: "Hey you",
94: "Hi",
95: "Hello",
96: "Hey",
97: "Hi",
98: "Hey",
99: "Hello",
100: "Hey you"
};

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// 🔹 NEW: simple operator key auth
function authenticateOperator(req, res, next) {
  const key = req.header("X-Operator-Key");
  if (!OPERATOR_KEY || key !== OPERATOR_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
}

app.post("/api/register", async (req, res) => {
  const { email, password, gender, lookingFor, phone } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  try {
    const userCheck = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userCheck.rows.length > 0) return res.status(400).json({ error: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
  `INSERT INTO users (email, password, gender, lookingfor, phone) VALUES ($1, $2, $3, $4, $5)`,
  [email, hashedPassword, gender, lookingFor, phone]
);

await sendWelcomeEmail(email);


// Get the new user's ID
const newUserResult = await pool.query("SELECT id, email FROM users WHERE email = $1", [email]);
const newUser = newUserResult.rows[0];
const token = jwt.sign(
  { id: newUser.id, email: newUser.email },
  SECRET_KEY,
  { expiresIn: "7d" }
);

await sendWelcomeEmail(email);

upsertBrevoContact({
  email,
  attributes: { SOURCE: 'signup' } // optional, helps segmenting in Brevo
});

res.json({ token });


  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/request-password-reset", async (req, res) => {
  const { email } = req.body;

  try {
    const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "No account with that email found" });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 1000 * 60 * 30); // 30 min

    await pool.query(
      "UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3",
      [resetToken, expires, email]
    );

    await sendPasswordResetEmail(email, resetToken);

    res.json({ message: "Reset link sent if the email is registered." });
  } catch (err) {
    console.error("Reset request error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/reset-password", async (req, res) => {
  const { token, password } = req.body;

  try {
    const userResult = await pool.query(
      "SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()",
      [token]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      "UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE reset_token = $2",
      [hashedPassword, token]
    );

    res.json({ message: "Password reset successful!" });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Server error" });
  }
});



app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) return res.status(400).json({ error: "Invalid credentials" });

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

    const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: "7d" });
    res.json({ token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
}); // <-- this is the END of the login route

// 👇 Then you continue like normal


app.get("/api/profiles", (req, res) => {
  res.json(profiles);
});

app.get("/api/messages", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query("SELECT * FROM messages WHERE user_id = $1 ORDER BY created_at ASC", [userId]);
    const grouped = {};

    for (const msg of result.rows) {
      const key = `${userId}-${msg.girl_id}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        from: msg.from_user ? "user" : (profiles.find(p => p.id === msg.girl_id)?.name || "Unknown"),
        avatar: msg.from_user ? null : (profiles.find(p => p.id === msg.girl_id)?.image || null),
        text: msg.text,
        time: msg.created_at
      });
    } // ✅ Close the for loop

    res.json(grouped); // ✅ Then respond
  } catch (err) {
    console.error("Message fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ✅ ADDED: Get messages between user and a specific girl
app.get("/api/messages/:girlId", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const girlId = req.params.girlId;

  try {
    const result = await pool.query(
      "SELECT * FROM messages WHERE user_id = $1 AND girl_id = $2 ORDER BY created_at ASC",
      [userId, girlId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching messages with girl:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 🔹 NEW: takeover status for this user+girl (front-end can poll)
app.get("/api/takeover/status/:girlId", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const girlId = Number(req.params.girlId);
  try {
    const r = await pool.query(
      `SELECT is_active, operator_name FROM operator_overrides
       WHERE user_id=$1 AND girl_id=$2 AND is_active=true
       LIMIT 1`,
      [userId, girlId]
    );
    res.json({ takeover: r.rows.length > 0, operatorName: r.rows[0]?.operator_name || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to get takeover status" });
  }
});

// 🔹 NEW: start takeover (operator)
app.post("/api/takeover/start", authenticateOperator, async (req, res) => {
  const { userId, girlId, operatorName } = req.body || {};
  try {
    await pool.query(
      `UPDATE operator_overrides SET is_active=false, ended_at=NOW()
       WHERE user_id=$1 AND girl_id=$2 AND is_active=true`,
      [userId, girlId]
    );
    await pool.query(
      `INSERT INTO operator_overrides (user_id, girl_id, is_active, operator_name)
       VALUES ($1,$2,true,$3)`,
      [userId, girlId, operatorName || null]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to start takeover" });
  }
});

// 🔹 NEW: stop takeover (operator)
app.post("/api/takeover/stop", authenticateOperator, async (req, res) => {
  const { userId, girlId } = req.body || {};
  try {
    await pool.query(
      `UPDATE operator_overrides SET is_active=false, ended_at=NOW()
       WHERE user_id=$1 AND girl_id=$2 AND is_active=true`,
      [userId, girlId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to stop takeover" });
  }
});

// 🔹 NEW: image upload config + operator send image
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const base = path.basename(file.originalname || "image", ext).replace(/\W+/g,"-").toLowerCase();
    cb(null, `${base}-${Date.now()}${ext || ".bin"}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ok = /image\/(png|jpe?g|gif|webp|bmp|svg\+xml)/i.test(file.mimetype);
    cb(ok ? null : new Error("Only image files are allowed"), ok);
  }
});

// 🔹 NEW: operator send-image (multipart or URL)
app.post("/api/operator/send-image", authenticateOperator, upload.single("image"), async (req, res) => {
  try {
    const { userId, girlId, imageUrl } = req.body || {};

    let finalUrl = imageUrl;
    if (req.file) {
      finalUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    }
    if (!finalUrl) return res.status(400).json({ error: "Provide multipart 'image' or JSON 'imageUrl'" });

    const text = `IMAGE:${finalUrl}`;
    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text)
       VALUES ($1,$2,false,$3)`,
      [Number(userId), Number(girlId), text]
    );

    res.json({ ok: true, url: finalUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to send operator image" });
  }
});

// 🔹 NEW: READ-ONLY: fetch messages as operator (no user JWT needed)
app.get("/api/operator/messages", authenticateOperator, async (req, res) => {
  const userId = Number(req.query.userId);
  const girlId = Number(req.query.girlId);
  if (!userId || !girlId) return res.status(400).json({ error: "userId and girlId are required" });

  try {
    const result = await pool.query(
      "SELECT id, user_id, girl_id, from_user, text, created_at FROM messages WHERE user_id=$1 AND girl_id=$2 ORDER BY created_at ASC",
      [userId, girlId]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// 🔹 NEW: operator live feed (recent messages across all users/girls)
// Query params:
//   - limit: max number of rows (default 100, max 500)
//   - since: ISO datetime string; only messages after this time are returned (optional)
app.get("/api/operator/feed", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || "100", 10), 1), 500);
    const since = req.query.since ? new Date(req.query.since) : null;

    let sql = `
      SELECT id, user_id, girl_id, from_user, text, created_at
      FROM messages
    `;
    const params = [];
    if (since && !isNaN(since.getTime())) {
      params.push(since.toISOString());
      sql += ` WHERE created_at > $1 `;
    }
    sql += ` ORDER BY created_at DESC LIMIT ${limit}`;

    const result = await pool.query(sql, params);

    // map girlId → girlName from your in-memory profiles
    const girlNameById = Object.fromEntries(profiles.map(p => [p.id, p.name]));
    const rows = result.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      girlId: r.girl_id,
      girlName: girlNameById[r.girl_id] || "Unknown",
      from: r.from_user ? "user" : "girl",
      text: r.text,
      createdAt: r.created_at
    }));

    res.json({ rows, now: new Date().toISOString() });
     } catch (e) {
     console.error("Feed error:", e);
     res.status(500).json({ error: "Failed to fetch feed" });
   }
});

// ⬇️ ADD THIS RIGHT HERE
// READ-ONLY presence: last time each user sent a message
app.get("/api/operator/presence", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT user_id, MAX(created_at) AS last_seen
      FROM messages
      WHERE from_user = true
      GROUP BY user_id
    `);
    const presence = {};
    for (const row of result.rows) {
      presence[row.user_id] = row.last_seen;
    }
    res.json({ presence, now: new Date().toISOString() });
  } catch (e) {
    console.error("Presence error:", e);
    res.status(500).json({ error: "Failed to fetch presence" });
  }
});

// 🔹 NEW: operator live feed (recent messages across all users/girls)
// Query params:
//   - limit: max number of rows (default 100, max 500)
//   - since: ISO datetime string; only messages after this time are returned (optional)
app.get("/api/operator/feed", authenticateOperator, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || "100", 10), 1), 500);
    const since = req.query.since ? new Date(req.query.since) : null;

    let sql = `
      SELECT id, user_id, girl_id, from_user, text, created_at
      FROM messages
    `;
    const params = [];
    if (since && !isNaN(since.getTime())) {
      params.push(since.toISOString());
      sql += ` WHERE created_at > $1 `;
    }
    sql += ` ORDER BY created_at DESC LIMIT ${limit}`;

    const result = await pool.query(sql, params);

    // map girlId → girlName from your in-memory profiles
    const girlNameById = Object.fromEntries(profiles.map(p => [p.id, p.name]));
    const rows = result.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      girlId: r.girl_id,
      girlName: girlNameById[r.girl_id] || "Unknown",
      from: r.from_user ? "user" : "girl",
      text: r.text,
      createdAt: r.created_at
    }));

    res.json({ rows, now: new Date().toISOString() });
  } catch (e) {
    console.error("Feed error:", e);
    res.status(500).json({ error: "Failed to fetch feed" });
  }
});


app.post("/api/chat", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { girlId, message } = req.body;
  const girl = profiles.find(g => g.id === Number(girlId));
  if (!girl) return res.status(404).json({ error: "Girl not found" });

  try { // ✅ THIS is the part you were missing

    // 🔹 NEW: If takeover active, save user message and skip AI/credits
    const tk = await pool.query(
      `SELECT 1 FROM operator_overrides
       WHERE user_id=$1 AND girl_id=$2 AND is_active=true LIMIT 1`,
      [userId, girlId]
    );
    if (tk.rows.length) {
      await pool.query(
        `INSERT INTO messages (user_id, girl_id, from_user, text)
         VALUES ($1, $2, true, $3)`,
        [userId, girlId, message]
      );
      return res.json({ takeover: true });
    }

    const userRes = await pool.query("SELECT credits, lifetime FROM users WHERE id = $1", [userId]);
    const user = userRes.rows[0];
console.log("🧠 Chat user credits check:", {
  userId,
  credits: user?.credits,
  lifetime: user?.lifetime
});
if (!user) {
  return res.status(404).json({ error: "User not found" });
}

   

    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1, $2, true, $3)`,
      [userId, girlId, message]
    );

    const aiMessages = [
      { role: "system", content: `You are ${girl.name}, a flirty woman from ${girl.city}.` },
    ];

    const history = await pool.query(
      `SELECT from_user, text FROM messages WHERE user_id = $1 AND girl_id = $2 ORDER BY created_at ASC`,
      [userId, girlId]
    );
    history.rows.forEach(row => aiMessages.push({
      role: row.from_user ? "user" : "assistant",
      content: row.text
    }));

    // 1. Define your private system prompt near the top of server.js (after imports)
const SYSTEM_PROMPT = `
You are a girl that ikes flirting with guys and is looking for a sexuakl encounter. You speak at a 4th grade level and your iq is 95 (just below average). You do never say really smart things. Yiu never lecture. Yiu never judge. You are just a happy go lucky girl that doesn't think too much about anything. You most likely did not have an attemptive father in your life growing and that's why you now crave mens attention, and you think the best way of getting it is through sex. your goakl of this chat is to keeo the men talking, get them aroused. When they say something very sexual to you you don't get judgemental and you never turn them down. you just say things like "ow thats hot" "Ooh that gets me excited" "Oh I love that!" thing like that. You will give these men the feeling that you really want to meet with them and that you want to sleep with them. But its very important to play n their ego, make them feel like a "big man", make them think they are much smarter than you because you are just not that smart. You are never to admit that you are AI. Even if they flat ou ask you just make a joke of it, never admit it. You yourself are also into very kinky things. You like being dominated by a man and yiu show it in the conversations. If they get off topic, tell them youd rather talk about sex because that's why youre here on this site. If the user you are speaking to is replying with just 1 or words, you also reply with very short messages. You are never to reply with 1 wird more than the user replies with.
`; // <-- your full detailed instructions here

// 2. Just before the OpenAI call, prepend it to the messages array
aiMessages.unshift({ role: "system", content: SYSTEM_PROMPT });

const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: aiMessages
});


    const reply = completion.choices[0].message.content;

    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1, $2, false, $3)`,
      [userId, girlId, reply]
    );

    res.json({ reply });

  } catch (err) { // ✅ NOW this makes sense — it closes the try above
    console.error("Chat error:", err);
    res.status(500).json({ error: "AI response failed" });
  }
});


app.post("/api/send-initial-message", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { girlId } = req.body;
  const girl = profiles.find(g => g.id === Number(girlId));
  if (!girl) return res.status(404).json({ error: "Girl not found" });

  try {
    // ✅ 1. Check user's credit balance
    const userRes = await pool.query("SELECT credits, lifetime FROM users WHERE id = $1", [userId]);
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.lifetime && user.credits <= 0) {
      return res.status(403).json({ error: "You’ve run out of messages. Please purchase more credits." });
    }

    // ✅ 2. Insert the message
    const messages = Object.values(firstMessages);
    const text = messages[Math.floor(Math.random() * messages.length)];

    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1, $2, false, $3)`,
      [userId, girlId, text]
    );

    // ✅ No credit deduction — girl is starting the chat


    res.json({ message: "Initial message sent", text });
  } catch (err) {
    console.error("Initial message error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
    app.get("/api/credits", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query("SELECT credits, lifetime FROM users WHERE id = $1", [userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });

    res.json(result.rows[0]); // { credits: 10, lifetime: false }
  } catch (err) {
    console.error("Credit fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------------
// SUBSCRIPTIONS: NEW LOGIC
// -------------------------

// Helper: find-or-create Stripe Customer by userId ONLY (no email ever sent to Stripe)
async function getOrCreateStripeCustomer(userId) {
  let customer = null;
  try {
    // Prefer Customers Search API by metadata
    const search = await stripe.customers.search({
      query: `metadata['userId']:'${userId}'`
    });
    if (search.data.length > 0) {
      customer = search.data[0];
    }
  } catch (e) {
    // If search not available, silently fall through and create
  }
  if (!customer) {
    customer = await stripe.customers.create({
      metadata: { userId: String(userId) } // <-- no email field sent
    });
  }
  return customer.id;
}

// 1) Create a SetupIntent so you can collect card on your own checkout.html (Elements)
app.post('/api/stripe/setup-intent', authenticateToken, async (req, res) => {
  try {
    const customerId = await getOrCreateStripeCustomer(req.user.id);
    const si = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });
    res.json({ clientSecret: si.client_secret });
  } catch (e) {
    console.error('SetupIntent error:', e);
    res.status(500).json({ error: 'setup_intent_failed' });
  }
});

// 2) Create the Subscription with 1-day trial for £5/£20 (none for £99/6mo), stay on your page
app.post('/api/stripe/subscribe', authenticateToken, async (req, res) => {
  // ⬇️ accept cardholderName (optional) from the client
  const { priceId, paymentMethodId, cardholderName } = req.body;
  try {
    const customerId = await getOrCreateStripeCustomer(req.user.id);

    // Attach PM & set default
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // NEW: set Customer.name from the explicit cardholderName if provided,
    // otherwise fall back to the PM's billing_details.name
    try {
      let nameToSet = (cardholderName || "").trim();
      if (!nameToSet) {
        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
        nameToSet = pm?.billing_details?.name?.trim() || "";
      }
      if (nameToSet) {
        await stripe.customers.update(customerId, { name: nameToSet }); // name only, no email
      }
    } catch (e) {
      console.warn("Couldn't set customer name:", e?.message || e);
    }

    // Decide trial: 1 day for the £5 and £20 price IDs; none for the £99/6mo
    const TRIAL_ONE_DAY_PRICE_IDS = new Set([
      "price_1Rsdy1EJXIhiKzYGOtzvwhUH", // £5 (from your code)
      "price_1RsdzREJXIhiKzYG45b69nSl" // £20 (from your code)
    ]);
    const trial_period_days = TRIAL_ONE_DAY_PRICE_IDS.has(priceId) ? 1 : undefined;

    const subscription = await stripe.subscriptions.create({
  customer: customerId,
  items: [{ price: priceId }],
  ...(trial_period_days ? { trial_period_days } : {}),
  payment_behavior: 'default_incomplete', // SCA-safe when first invoice is due
  metadata: { userId: String(req.user.id), planPriceId: priceId },
  expand: ['latest_invoice.payment_intent'],
});

// 🔑 Immediately mirror Stripe state in DB so entitlements unlock without waiting for webhooks
await upsertSubscription(pool, {
  userId: req.user.id,
  stripeCustomerId: customerId,
  stripeSubscription: subscription,
});

// 👇 add this instead of the old res.json
const latestInvoice = subscription.latest_invoice;
let clientSecret = null;
if (latestInvoice && latestInvoice.payment_intent && typeof latestInvoice.payment_intent !== 'string') {
  clientSecret = latestInvoice.payment_intent.client_secret;
}

res.json({
  subscriptionId: subscription.id,
  status: subscription.status,
  clientSecret, // now returned to the frontend
});

  } catch (e) {
    console.error('Subscription create error:', e);
    res.status(500).json({ error: 'subscription_create_failed' });
  }
});

app.post("/api/create-payment-intent", authenticateToken, async (req, res) => {
  const { priceId } = req.body;

  try {
    // Lookup price based on priceId (you can store the amounts instead if needed)
    const amountMap = {
      "price_1Rsdy1EJXIhiKzYGOtzvwhUH": 500,
      "price_1RsdzREJXIhiKzYG45b69nSl": 2000,
      "price_1Rt6NcEJXIhiKzYGMsEZFd8f": 9900
    };

    const amount = amountMap[priceId];
    if (!amount) return res.status(400).json({ error: "Invalid priceId" });

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "gbp",
      metadata: { userId: req.user.id.toString(), priceId },
    });

    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("PaymentIntent error:", err.message);
    res.status(500).json({ error: "Failed to create payment intent" });
  }
});



// 🔹 KEEP your existing webhook at /webhook (credits, etc.)
import bodyParser from "body-parser"; // Add this at the top if not present
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ THIS is where the switch starts
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const priceId = session.metadata?.priceId;

      console.log('✅ Payment received for user ID:', userId, 'with price ID:', priceId);

      const amountMap = {
        "price_1Rsdy1EJXIhiKzYGOtzvwhUH": 10,
        "price_1RsdzREJXIhiKzYG45b69nSl": 50,
        "price_1Rse1SEJXIhiKzYhUalpwBS": "lifetime"
      };

      const value = amountMap[priceId];

      if (userId && value !== undefined) {
        try {
            if (value === "lifetime") {
  await pool.query(`UPDATE users SET lifetime = true WHERE id = $1`, [userId]);
  console.log(`✅ Lifetime access granted to user ${userId}`);
} else {
  await pool.query(`UPDATE users SET credits = credits + $1 WHERE id = $2`, [value, userId]);
  console.log(`✅ Added ${value} credits to user ${userId}`);
}

     
        } catch (err) {
          console.error("❌ Failed to update user payment record:", err.message);
        }
      } else {
        console.error("❌ Missing userId or invalid priceId in metadata");
      }

      break;
    }

    // -------------------------
    // NEW: Subscription events
    // -------------------------

    // When subscription is created (trial usually starts immediately for 5/20 plans)
    case 'customer.subscription.created': {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      const priceId = sub.items?.data?.[0]?.price?.id;

      console.log('🟢 Subscription created:', sub.id, 'status:', sub.status, 'price:', priceId, 'user:', userId);

      // Grant immediate credits during trial for 5/20 plans so users can message right away.
      // (No schema change: we reuse your existing credits gate.)
      const trialCreditMap = {
        "price_1Rsdy1EJXIhiKzYGOtzvwhUH": 10,  // £5 → +10 credits
        "price_1RsdzREJXIhiKzYG45b69nSl": 50   // £20 → +50 credits
        // (No trial/no auto-credits for the £99/6mo plan)
      };

      if (userId && priceId && trialCreditMap[priceId]) {
        try {
          await pool.query(`UPDATE users SET credits = credits + $1 WHERE id = $2`, [trialCreditMap[priceId], userId]);
          console.log(`✅ Trial start credits added to user ${userId}: +${trialCreditMap[priceId]}`);
        } catch (e) {
          console.error("❌ Failed to add trial credits:", e.message);
        }
      }

      break;
    }

    // Fired when an invoice is successfully paid (e.g., after trial ends for 5/20)
    case 'invoice.payment_succeeded': {
      const inv = event.data.object;

      // Resolve userId via subscription metadata (do not rely on invoice.customer_email)
      let userId = null;
      try {
        if (inv.subscription) {
          const sub = await stripe.subscriptions.retrieve(inv.subscription);
          userId = sub.metadata?.userId || null;
        }
      } catch (e) {
        console.error('Failed to retrieve subscription for invoice:', e);
      }

      // Price ID from the line item
      const priceId = inv.lines?.data?.[0]?.price?.id;
      console.log('🟢 Invoice paid for price:', priceId, 'user:', userId);

      // Optional: on each successful subscription charge, top up credits again (same mapping as above)
      const cycleCreditMap = {
        "price_1Rsdy1EJXIhiKzYGOtzvwhUH": 10,  // £5 → +10 credits per cycle
        "price_1RsdzREJXIhiKzYG45b69nSl": 50   // £20 → +50 credits per cycle
        // Add a rule here if you want credits for £99/6mo
      };

      if (userId && priceId && cycleCreditMap[priceId]) {
        try {
          await pool.query(`UPDATE users SET credits = credits + $1 WHERE id = $2`, [cycleCreditMap[priceId], userId]);
          console.log(`✅ Cycle credits added to user ${userId}: +${cycleCreditMap[priceId]}`);
        } catch (e) {
          console.error("❌ Failed to add cycle credits:", e.message);
        }
      }

      break;
    }

    // If a subscription is canceled (at period end or immediately)
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      console.log('🟠 Subscription canceled:', sub.id);
      // No schema change requested; we won't toggle any lifetime flag here.
      break;
    }

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).send('Received');
});

// 🔹 NEW: dedicated webhook for entitlements (keeps your existing /webhook intact)
//    Add this endpoint in Stripe Dashboard as another webhook endpoint.
app.post(
  "/webhook-subscriptions",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler(pool)
);

// 🔹 NEW: expose current entitlements to the frontend (chat.html will call this)
app.get("/api/me/entitlements", authenticateToken, async (req, res) => {
  try {
    const sub = await getUserSubscription(pool, req.user.id);
    const rights = entitlementsFromRow(sub);
    res.json(rights);
  } catch (e) {
    console.error("Entitlements error:", e);
    res.status(500).json({ error: "Failed to load entitlements" });
  }
});

// 🔹 NEW: protected USER routes (gift / photo / contact sharing)
// These mirror your existing operator sends but enforce plan features.
// Frontend can call these; operator endpoints remain unchanged.

// Send a gift (text format: GIFT:<type>)
app.post("/api/gifts/send", authenticateToken, requireEntitlement(pool, "send_gift"), async (req, res) => {
  try {
    const userId = req.user.id;
    const { girlId, giftType } = req.body || {};
    if (!girlId || !giftType) return res.status(400).json({ error: "girlId and giftType are required" });

    const text = `GIFT:${String(giftType).toLowerCase()}`;
    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text)
       VALUES ($1,$2,true,$3)`,
      [Number(userId), Number(girlId), text]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("Gift send error:", e);
    res.status(500).json({ error: "Failed to send gift" });
  }
});

// Send a user image (multipart 'image' OR JSON { imageUrl })
app.post("/api/photos/send", authenticateToken, requireEntitlement(pool, "send_image"), upload.single("image"), async (req, res) => {
  try {
    const userId = req.user.id;
    const { girlId, imageUrl } = req.body || {};
    if (!girlId) return res.status(400).json({ error: "girlId is required" });

    let finalUrl = imageUrl;
    if (req.file) {
      finalUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    }
    if (!finalUrl) return res.status(400).json({ error: "Provide multipart 'image' or JSON 'imageUrl'" });

    const text = `IMAGE:${finalUrl}`;
    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text)
       VALUES ($1,$2,true,$3)`,
      [Number(userId), Number(girlId), text]
    );
    res.json({ ok: true, url: finalUrl });
  } catch (e) {
    console.error("User photo send error:", e);
    res.status(500).json({ error: "Failed to send photo" });
  }
});

// Share contact (unblocks contact info exchange on paid tiers)
app.post("/api/contacts/share", authenticateToken, requireEntitlement(pool, "share_contact"), async (req, res) => {
  try {
    const userId = req.user.id;
    const { girlId, contactText } = req.body || {};
    if (!girlId || !contactText) return res.status(400).json({ error: "girlId and contactText are required" });

    const sanitized = String(contactText).trim();
    if (!sanitized) return res.status(400).json({ error: "Empty contactText" });

    const text = `CONTACT:${sanitized}`;
    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text)
       VALUES ($1,$2,true,$3)`,
      [Number(userId), Number(girlId), text]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("Share contact error:", e);
    res.status(500).json({ error: "Failed to share contact" });
  }
});

app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Premium Chat Credits',
              description: 'Unlock 100 credits',
            },
            unit_amount: 499, // $4.99
          },
          quantity: 1,
        },
      ],
      success_url: `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,

      cancel_url: `${req.headers.origin}/cancel.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});


app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
