// server.js

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
import crypto from 'crypto';
import { sendWelcomeEmail, sendPasswordResetEmail, sendNewMessageEmail } from './email-ses.js';
// 🔹 NEW: file ops + uploads
import fs from "fs";
import multer from "multer";
// 🔹 NEW: central subscription logic
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
  const payload = new SibApiV3Sdk.CreateContact();
  payload.email = email;
  payload.attributes = attributes;
  payload.listIds = [Number(listId)];
  payload.updateEnabled = true;
  try {
    await contactsApi.createContact(payload);
  } catch (e) {
    console.warn("Brevo contact upsert failed:", e?.response?.text || e.message);
  }
}

const { Pool } = pkg;
const app = express();
const SECRET_KEY = process.env.SECRET_KEY || "yoursecretkey";
const OPERATOR_KEY = process.env.OPERATOR_KEY || "";

// Prices
const GBP_TRIAL_PRICE_ID = process.env.STRIPE_TRIAL_PRICE_ID || "price_1S1vwtEJXIhiKzYGHB3ZIf9v";
const GBP_MONTHLY_PRICE_ID = process.env.STRIPE_MONTHLY_PRICE_ID || "price_1RsdzREJXIhiKzYG45b69nSl";

// 🔹 Uploads
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOAD_DIR));

// Static site
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Middleware
app.use(cors());
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// Database pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* --------------- STRIPE FIXED PART ----------------- */

// Create subscription with optional trial
app.post('/api/stripe/subscribe', authenticateToken, async (req, res) => {
  const { priceId, paymentMethodId, cardholderName } = req.body;
  try {
    const customerId = await getOrCreateStripeCustomer(req.user.id);

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Fix: 7 day trial for £5 and £20
    const TRIAL_ONE_WEEK_PRICE_IDS = new Set([
      "price_1Rsdy1EJXIhiKzYGOtzvwhUH", // £5
      "price_1RsdzREJXIhiKzYG45b69nSl" // £20
    ]);
    const trial_period_days = TRIAL_ONE_WEEK_PRICE_IDS.has(priceId) ? 7 : undefined;

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      ...(trial_period_days ? { trial_period_days } : {}),
      payment_behavior: 'default_incomplete',
      metadata: { userId: String(req.user.id), planPriceId: priceId },
      expand: ['latest_invoice.payment_intent'],
    });

    await upsertSubscription(pool, {
      userId: req.user.id,
      stripeCustomerId: customerId,
      stripeSubscription: subscription,
    });

    const latestInvoice = subscription.latest_invoice;
    let clientSecret = null;
    if (latestInvoice && latestInvoice.payment_intent && typeof latestInvoice.payment_intent !== 'string') {
      clientSecret = latestInvoice.payment_intent.client_secret;
    }

    res.json({ subscriptionId: subscription.id, status: subscription.status, clientSecret });
  } catch (e) {
    console.error('Subscription create error:', e);
    res.status(500).json({ error: 'subscription_create_failed' });
  }
});

/* --------------------------------------------------- */

// (Rest of your existing server.js stays the same)
/* --------------------------------------------------- */

// Send raw emails (Brevo)
app.post('/send-email', async (req, res) => {
  const { toEmail, subject, htmlContent } = req.body;
  const sender = { email: 'no-reply@charmr.xyz', name: 'Your App' };
  const receivers = [{ email: toEmail }];
  try {
    await transactionalEmailApi.sendTransacEmail({ sender, to: receivers, subject, htmlContent });
    upsertBrevoContact({ email: receivers[0].email, attributes: { SOURCE: 'contact' } });
    res.status(200).json({ message: 'Email sent successfully' });
  } catch (error) {
    console.error('❌ Error sending email:', error);
    res.status(500).json({ message: 'Failed to send email' });
  }
});

// Stripe session lookup (unchanged)
app.get("/api/get-stripe-session", async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: "Missing session_id" });
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

// ---------- DB bootstrap (unchanged DDL) ----------
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        gender TEXT,
        lookingfor TEXT,
        phone TEXT,
        credits INT DEFAULT 10,
        lifetime BOOLEAN DEFAULT false,
        reset_token TEXT,
        reset_token_expires TIMESTAMP
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

    // central subscriptions tables
    await ensureSubscriptionTables(pool);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gift_purchases (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        girl_id INT NOT NULL,
        gift_type TEXT NOT NULL,
        amount_cents INT NOT NULL,
        currency TEXT NOT NULL,
        stripe_payment_intent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log("✅ Tables are ready");
  } catch (err) {
    console.error("❌ Error creating tables:", err);
  }
})();

// ---------- OpenAI + static data (unchanged) ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const profiles = [
  { "id": 1, "name": "Amber Taylor", "city": "Oxford", "image": "https://notadatingsite.online/pics/1.png", "description": "a bit mental, a bit sweet 🤪🍭 depends how u treat me lol" },
  { "id": 2, "name": "Mia Smith", "city": "Bath", "image": "https://notadatingsite.online/pics/2.png", "description": "snap me if u cute 😜💌 got a soft spot 4 accents n cheeky grins" },
  { "id": 3, "name": "Chloe Moore", "city": "Aberdeen", "image": "https://notadatingsite.online/pics/3.png", "description": "wat u see is wat u get 😉 cheeky smile n even cheekier mind lol 😈" },
  { "id": 5, "name": "Ruby Davies", "city": "Leicester", "image": "https://notadatingsite.online/pics/5.png", "description": "just a norty gal lookin 4 sum fun 🥴🥂 dnt b shy luv 😏 holla innit 💋" },
  { "id": 6, "name": "Niamh Davies", "city": "Cardiff", "image": "https://notadatingsite.online/pics/6.png", "description": "just a norty gal lookin 4 sum fun 🥴🥂 dnt b shy luv 😏 holla innit 💋" },
  { "id": 7, "name": "Ruby Clarke", "city": "Newcastle", "image": "https://notadatingsite.online/pics/7.png", "description": "no filter. no drama. jus vibes 😎💃 sum1 show me a gud time pls x" },
  { "id": 8, "name": "Daisy Evans", "city": "Derby", "image": "https://notadatingsite.online/pics/8.png", "description": "wat u see is wat u get 😉 cheeky smile n even cheekier mind lol 😈" },
  { "id": 9, "name": "Chloe White", "city": "York", "image": "https://notadatingsite.online/pics/9.png", "description": "jus on here coz me mate told me 2 😂 bored af tbh... suprise me? 🙃" },
  { "id": 10, "name": "Lexi Turner", "city": "Bristol", "image": "https://notadatingsite.online/pics/10.png", "description": "bit of a madhead 🤪 love a giggle, takeaway n sum company 👀😆 slide in if u can keep up x" },
  { "id": 11, "name": "Millie Watson", "city": "Hull", "image": "https://notadatingsite.online/pics/11.png", "description": "picky but worth it 💅💋 here for da vibes n sum flirty chats 😘" },
  { "id": 12, "name": "Mia Reed", "city": "Reading", "image": "https://notadatingsite.online/pics/12.png", "description": "jus here 4 banter n belly laffs 😂💃 slide in if ur tall n not dull x" },
  { "id": 13, "name": "Mia Smith", "city": "Sheffield", "image": "https://notadatingsite.online/pics/13.png", "description": "just a norty gal lookin 4 sum fun 🥴🥂 dnt b shy luv 😏 holla innit 💋" }
];

const firstMessages = {
  1: "Hey", 2: "How are you?", 3: "Hi", 4: "Hey you", 5: "Hello", 6: "What’s up?", 7: "Hi there",
  8: "Hey stranger", 9: "Morning", 10: "Good morning", 11: "Good evening", 12: "Hi hi",
  13: "Hey cutie", 14: "Hey", 15: "Evening", 16: "Hola", 17: "Hey you", 18: "Hi", 19: "Hello",
  20: "Hey", 21: "Hey there", 22: "Hi", 23: "Hey you", 24: "Hi", 25: "Hello", 26: "Hey", 27: "Hi",
  28: "Hey you", 29: "Hello", 30: "Hey", 31: "Hi", 32: "Hello", 33: "Hey", 34: "Hi", 35: "Hey you",
  36: "Hey", 37: "Hi", 38: "Hello", 39: "Hey", 40: "Hi", 41: "Hello", 42: "Hey", 43: "Hi",
  44: "Hey you", 45: "Hi", 46: "Hey", 47: "Hello", 48: "Hey", 49: "Hi", 50: "Hey", 51: "Hello",
  52: "Hey", 53: "Hi", 54: "Hello", 55: "Hey", 56: "Hi", 57: "Hey you", 58: "Hi", 59: "Hello",
  60: "Hey", 61: "Hi", 62: "Hello", 63: "Hey", 64: "Hi", 65: "Hey", 66: "Hello", 67: "Hi",
  68: "Hey you", 69: "Hi", 70: "Hello", 71: "Hey", 72: "Hi", 73: "Hey", 74: "Hello", 75: "Hey",
  76: "Hi", 77: "Hey you", 78: "Hi", 79: "Hello", 80: "Hey", 81: "Hi", 82: "Hey", 83: "Hello",
  84: "Hey you", 85: "Hi", 86: "Hello", 87: "Hey", 88: "Hi", 89: "Hey", 90: "Hello", 91: "Hey",
  92: "Hi", 93: "Hey you", 94: "Hi", 95: "Hello", 96: "Hey", 97: "Hi", 98: "Hey", 99: "Hello", 100: "Hey you"
};

// ---------- auth helpers (unchanged) ----------
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

function authenticateOperator(req, res, next) {
  const key = req.header("X-Operator-Key");
  if (!OPERATOR_KEY || key !== OPERATOR_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// --- email notification helpers (unchanged) ---
const NOTIFY_COOLDOWN_MIN = 30;

async function shouldNotifyUser(userId, girlId) {
  const r = await pool.query(
    `SELECT created_at FROM messages
     WHERE user_id=$1 AND girl_id=$2 AND from_user=false
     ORDER BY created_at DESC LIMIT 1`,
    [userId, girlId]
  );
  if (r.rows.length === 0) return true;
  const last = new Date(r.rows[0].created_at).getTime();
  const mins = (Date.now() - last) / 60000;
  return mins > NOTIFY_COOLDOWN_MIN;
}

function getGirlName(girlId) {
  const p = profiles.find(p => Number(p.id) === Number(girlId));
  return p?.name || "New match";
}

async function notifyNewMessage(userId, girlId, senderName) {
  const ur = await pool.query("SELECT email FROM users WHERE id=$1", [userId]);
  if (!ur.rows.length) return;
  const toEmail = ur.rows[0].email;
  if (!(await shouldNotifyUser(userId, girlId))) return;
  const conversationUrl = `https://charmr.xyz/chat.html?id=${girlId}`;
  try {
    await sendNewMessageEmail({ toEmail, senderName, conversationUrl });
  } catch (e) {
    console.warn("New message email failed:", e?.message || e);
  }
}

// ---------- auth & profile routes (unchanged) ----------
app.post("/api/register", async (req, res) => {
  let { email, password, gender, lookingFor, phone } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  email = String(email).trim().toLowerCase();
  gender = (typeof gender === "string" ? gender.trim() : null) || null;
  lookingFor = (typeof lookingFor === "string" ? lookingFor.trim() : null) || null;

  if (typeof phone === "string") {
    const digits = phone.replace(/[^\d]/g, "");
    phone = digits || null;
  } else {
    phone = null;
  }

  try {
    const userCheck = await pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users (email, password, gender, lookingfor, phone)
       VALUES ($1, $2, $3, $4, $5)`,
      [email, hashedPassword, gender, lookingFor, phone]
    );

    (async () => {
      try { await sendWelcomeEmail(email); }
      catch (e) { console.warn("Welcome email failed (non-blocking):", e?.message || e); }
    })();

    const newUserResult = await pool.query("SELECT id, email FROM users WHERE email = $1", [email]);
    const newUser = newUserResult.rows[0];

    upsertBrevoContact({ email, attributes: { SOURCE: 'signup' } })
      .catch(e => console.warn("Brevo contact upsert failed:", e?.message || e));

    return res.status(201).json({ ok: true, redirect: "/login.html" });
  } catch (err) {
    if (err && (err.code === '23505' || /unique/i.test(err.message))) {
      return res.status(400).json({ error: "User already exists" });
    }
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
    const expires = new Date(Date.now() + 1000 * 60 * 30);
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
});

app.get("/api/profiles", (req, res) => {
  res.json(profiles);
});

// ---------- messages (unchanged) ----------
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
    }
    res.json(grouped);
  } catch (err) {
    console.error("Message fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

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

// ---------- operator takeover (unchanged) ----------
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

// ---------- uploads (unchanged) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const base = path.basename(file.originalname || "image", ext).replace(/\W+/g, "-").toLowerCase();
    cb(null, `${base}-${Date.now()}${ext || ".bin"}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /image\/(png|jpe?g|gif|webp|bmp|svg\+xml|heic|heif)/i.test(file.mimetype);
    if (!ok) return cb(new Error("Unsupported image type. Allowed: PNG, JPG, GIF, WEBP, BMP, SVG, HEIC, HEIF"));
    cb(null, true);
  }
});

// operator send text/image (unchanged)
app.post("/api/operator/send", authenticateOperator, async (req, res) => {
  try {
    const { userId, girlId, text } = req.body || {};
    if (!userId || !girlId || !text) {
      return res.status(400).json({ error: "userId, girlId and text are required" });
    }
    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1,$2,false,$3)`,
      [Number(userId), Number(girlId), text]
    );
    await notifyNewMessage(Number(userId), Number(girlId), getGirlName(girlId));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to send operator text" });
  }
});

app.post("/api/operator/send-image", authenticateOperator, upload.single("image"), async (req, res) => {
  try {
    const { userId, girlId, imageUrl } = req.body || {};
    if (!userId || !girlId) return res.status(400).json({ error: "userId and girlId are required" });
    let finalUrl = imageUrl;
    if (req.file) {
      finalUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    }
    if (!finalUrl) return res.status(400).json({ error: "Provide multipart 'image' or JSON 'imageUrl'" });
    const text = `IMAGE:${finalUrl}`;
    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1,$2,false,$3)`,
      [Number(userId), Number(girlId), text]
    );
    await notifyNewMessage(Number(userId), Number(girlId), getGirlName(girlId));
    res.json({ ok: true, url: finalUrl });
  } catch (e) {
    console.error("Operator image send error:", e);
    res.status(500).json({ error: "Failed to send operator image" });
  }
});

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

// presence/feed (first presence is public/unchanged; second feed is protected and unchanged)
app.get("/api/operator/feed", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || "100", 10), 1), 500);
    const since = req.query.since ? new Date(req.query.since) : null;
    let sql = `SELECT id, user_id, girl_id, from_user, text, created_at FROM messages `;
    const params = [];
    if (since && !isNaN(since.getTime())) {
      params.push(since.toISOString());
      sql += `WHERE created_at > $1 `;
    }
    sql += `ORDER BY created_at DESC LIMIT ${limit}`;
    const result = await pool.query(sql, params);

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

app.get("/api/operator/presence", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id, MAX(created_at) AS last_seen
       FROM messages WHERE from_user = true GROUP BY user_id`
    );
    const presence = {};
    for (const row of result.rows) presence[row.user_id] = row.last_seen;
    res.json({ presence, now: new Date().toISOString() });
  } catch (e) {
    console.error("Presence error:", e);
    res.status(500).json({ error: "Failed to fetch presence" });
  }
});

app.get("/api/operator/feed", authenticateOperator, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || "100", 10), 1), 500);
    const since = req.query.since ? new Date(req.query.since) : null;
    let sql = `SELECT id, user_id, girl_id, from_user, text, created_at FROM messages `;
    const params = [];
    if (since && !isNaN(since.getTime())) {
      params.push(since.toISOString());
      sql += `WHERE created_at > $1 `;
    }
    sql += `ORDER BY created_at DESC LIMIT ${limit}`;
    const result = await pool.query(sql, params);

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

// ===== AI auto-drip + chat endpoints continue in Part 3 =====
// ---------- AI auto-drip + chat endpoints ----------
async function generateAIResponse(prompt) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: "You are a flirty girl chatting casually." },
                 { role: "user", content: prompt }]
    });
    return completion.choices[0].message.content;
  } catch (err) {
    console.error("OpenAI error:", err);
    return "Hey 😉";
  }
}

app.post("/api/send-message", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { girlId, text } = req.body;
  if (!girlId || !text) return res.status(400).json({ error: "girlId and text required" });

  try {
    await pool.query(
      "INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1,$2,true,$3)",
      [userId, girlId, text]
    );

    // optional AI auto-reply
    const replyPrompt = `The user said: "${text}". Respond in a flirty casual style.`;
    const reply = await generateAIResponse(replyPrompt);
    await pool.query(
      "INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1,$2,false,$3)",
      [userId, girlId, reply]
    );
    await notifyNewMessage(userId, girlId, getGirlName(girlId));

    res.json({ ok: true, reply });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------- credits + gifts (unchanged) ----------
app.post("/api/gift", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { girlId, giftType } = req.body;
  if (!girlId || !giftType) return res.status(400).json({ error: "girlId and giftType required" });

  try {
    // deduct credits or log Stripe payment here
    await pool.query(
      `INSERT INTO gift_purchases (user_id, girl_id, gift_type, amount_cents, currency, stripe_payment_intent_id, status)
       VALUES ($1,$2,$3,500,'gbp','manual','succeeded')`,
      [userId, girlId, giftType]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Gift error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------- static + start server ----------
app.use(express.static(path.join(process.cwd(), "frontend")));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

