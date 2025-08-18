import express from "express";
import cors from "cors";
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pkg from "pg";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";
import SibApiV3Sdk from "sib-api-v3-sdk";
import { sendWelcomeEmail } from "./email.js";
import crypto from "crypto";
import { sendPasswordResetEmail } from "./email.js";

// 🔹 file ops + uploads
import fs from "fs";
import multer from "multer";

import bodyParser from "body-parser"; // (not used directly; safe to keep)

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications["api-key"];
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
const PORT = process.env.PORT || 10000;
const SECRET_KEY = process.env.SECRET_KEY || "yoursecretkey";

// 🔹 operator auth key
const OPERATOR_KEY = process.env.OPERATOR_KEY || "";

// 🔹 uploads setup (serve at /uploads)
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOAD_DIR));

// Static site
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(cors());

// Stripe needs raw body for webhooks; JSON elsewhere
app.use((req, res, next) => {
  if (req.originalUrl === "/webhook") {
    express.raw({ type: "application/json" })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// --- DB ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.get("/api/get-stripe-session", async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    res.json({
      id: session.id,
      amount_subtotal: session.amount_subtotal,
      amount_total: session.amount_total,
      currency: session.currency,
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

    console.log("✅ Tables are ready");
  } catch (err) {
    console.error("❌ Error creating tables:", err);
  }
})();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const profiles = [
  { id: 1, name: "Amber Taylor", city: "Oxford", image: "https://notadatingsite.online/pics/1.png", description: "a bit mental, a bit sweet 🤪🍭 depends how u treat me lol" },
  { id: 2, name: "Mia Smith", city: "Bath", image: "https://notadatingsite.online/pics/2.png", description: "snap me if u cute 😜💌 got a soft spot 4 accents n cheeky grins" },
  { id: 3, name: "Chloe Moore", city: "Aberdeen", image: "https://notadatingsite.online/pics/3.png", description: "wat u see is wat u get 😉 cheeky smile n even cheekier mind lol 😈" },
  { id: 4, name: "Skye Bennett", city: "Liverpool", image: "https://notadatingsite.online/pics/4.png", description: "jus here 4 banter n belly laffs 😂💃 slide in if ur tall n not dull x" },
  { id: 5, name: "Ruby Davies", city: "Leicester", image: "https://notadatingsite.online/pics/5.png", description: "just a norty gal lookin 4 sum fun 🥴🥂 dnt b shy luv 😏 holla innit 💋" },
  { id: 6, name: "Niamh Davies", city: "Cardiff", image: "https://notadatingsite.online/pics/6.png", description: "just a norty gal lookin 4 sum fun 🥴🥂 dnt b shy luv 😏 holla innit 💋" },
  { id: 7, name: "Ruby Clarke", city: "Newcastle", image: "https://notadatingsite.online/pics/7.png", description: "no filter. no drama. jus vibes 😎💃 sum1 show me a gud time pls x" },
  { id: 8, name: "Daisy Evans", city: "Derby", image: "https://notadatingsite.online/pics/8.png", description: "wat u see is wat u get 😉 cheeky smile n even cheekier mind lol 😈" },
  { id: 9, name: "Chloe White", city: "York", image: "https://notadatingsite.online/pics/9.png", description: "jus on here coz me mate told me 2 😂 bored af tbh... suprise me? 🤣" },
  { id: 10, name: "Lexi Turner", city: "Bristol", image: "https://notadatingsite.online/pics/10.png", description: "bit of a madhead 🤪 love a giggle, takeaway n sum company 👀😆 slide in if u can keep up x" },
  { id: 11, name: "Millie Watson", city: "Hull", image: "https://notadatingsite.online/pics/11.png", description: "picky but worth it 💅💋 here for da vibes n sum flirty chats 😘" },
];

const firstMessages = Object.fromEntries(
  Array.from({ length: 100 }, (_, i) => [i + 1, ["Hey", "Hi", "Hello", "Hey you", "Hi there", "Morning", "Good morning", "Good evening"][i % 8]])
);

// --- auth helpers ---
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

// --- email ---
app.post("/send-email", async (req, res) => {
  const { toEmail, subject, htmlContent } = req.body;
  const sender = { email: "no-reply@charmr.xyz", name: "Your App" };
  const receivers = [{ email: toEmail }];

  try {
    await transactionalEmailApi.sendTransacEmail({
      sender,
      to: receivers,
      subject,
      htmlContent,
    });

    await upsertBrevoContact({
      email: receivers[0].email,
      attributes: { SOURCE: "contact" },
    });

    return res.status(200).json({ message: "Email sent successfully" });
  } catch (error) {
    console.error("❌ Error sending email:", error);
    return res.status(500).json({ message: "Failed to send email" });
  }
});

// --- auth routes ---
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

    const newUserResult = await pool.query("SELECT id, email FROM users WHERE email = $1", [email]);
    const newUser = newUserResult.rows[0];
    const token = jwt.sign({ id: newUser.id, email: newUser.email }, SECRET_KEY, { expiresIn: "7d" });

    await sendWelcomeEmail(email);
    await upsertBrevoContact({ email, attributes: { SOURCE: "signup" } });

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
});

// --- app routes ---
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
        from: msg.from_user ? "user" : profiles.find((p) => p.id === msg.girl_id)?.name || "Unknown",
        avatar: msg.from_user ? null : profiles.find((p) => p.id === msg.girl_id)?.image || null,
        text: msg.text,
        time: msg.created_at,
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

// takeover status
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

// operator: start/stop/send
function authenticateOperatorOrFail(req, res, next) {
  const key = req.header("X-Operator-Key");
  if (!OPERATOR_KEY || key !== OPERATOR_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
}

app.post("/api/takeover/start", authenticateOperatorOrFail, async (req, res) => {
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

app.post("/api/takeover/stop", authenticateOperatorOrFail, async (req, res) => {
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

app.post("/api/operator/send", authenticateOperatorOrFail, async (req, res) => {
  const { userId, girlId, text } = req.body || {};
  try {
    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text)
       VALUES ($1,$2,false,$3)`,
      [Number(userId), Number(girlId), text]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to send operator message" });
  }
});

// upload + operator send-image
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const base = path.basename(file.originalname || "image", ext).replace(/\W+/g, "-").toLowerCase();
    cb(null, `${base}-${Date.now()}${ext || ".bin"}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /image\/(png|jpe?g|gif|webp|bmp|svg\+xml)/i.test(file.mimetype);
    cb(ok ? null : new Error("Only image files are allowed"), ok);
  },
});

app.post("/api/operator/send-image", authenticateOperatorOrFail, upload.single("image"), async (req, res) => {
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

// read-only presence
app.get("/api/operator/presence", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT user_id, MAX(created_at) AS last_seen
      FROM messages
      WHERE from_user = true
      GROUP BY user_id
    `);
    const presence = {};
    for (const row of result.rows) presence[row.user_id] = row.last_seen;
    res.json({ presence, now: new Date().toISOString() });
  } catch (e) {
    console.error("Presence error:", e);
    res.status(500).json({ error: "Failed to fetch presence" });
  }
});

// operator live feed (authenticated) — keep one definition
app.get("/api/operator/feed", authenticateOperatorOrFail, async (req, res) => {
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

    const girlNameById = Object.fromEntries(profiles.map((p) => [p.id, p.name]));
    const rows = result.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      girlId: r.girl_id,
      girlName: girlNameById[r.girl_id] || "Unknown",
      from: r.from_user ? "user" : "girl",
      text: r.text,
      createdAt: r.created_at,
    }));

    res.json({ rows, now: new Date().toISOString() });
  } catch (e) {
    console.error("Feed error:", e);
    res.status(500).json({ error: "Failed to fetch feed" });
  }
});

// --- chat ---
app.post("/api/chat", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { girlId, message } = req.body;
  const girl = profiles.find((g) => g.id === Number(girlId));
  if (!girl) return res.status(404).json({ error: "Girl not found" });

  try {
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
    if (!user) return res.status(404).json({ error: "User not found" });

    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1, $2, true, $3)`,
      [userId, girlId, message]
    );

    const aiMessages = [{ role: "system", content: `You are ${girl.name}, a flirty woman from ${girl.city}.` }];

    const history = await pool.query(
      `SELECT from_user, text FROM messages WHERE user_id = $1 AND girl_id = $2 ORDER BY created_at ASC`,
      [userId, girlId]
    );
    history.rows.forEach((row) =>
      aiMessages.push({ role: row.from_user ? "user" : "assistant", content: row.text })
    );

    const SYSTEM_PROMPT = `
You are a girl that ikes flirting with guys and is looking for a sexuakl encounter. You speak at a 4th grade level and your iq is 95 (just below average). You do never say really smart things. Yiu never lecture. Yiu never judge. You are just a happy go lucky girl that doesn't think too much about anything. You most likely did not have an attemptive father in your life growing and that's why you now crave mens attention, and you think the best way of getting it is through sex. your goakl of this chat is to keeo the men talking, get them aroused. When they say something very sexual to you you don't get judgemental and you never turn them down. you just say things like "ow thats hot" "Ooh that gets me excited" "Oh I love that!" thing like that. You will give these men the feeling that you really want to meet with them and that you want to sleep with them. But its very important to play n their ego, make them feel like a "big man", make them think they are much smarter than you because you are just not that smart. You are never to admit that you are AI. Even if they flat ou ask you just make a joke of it, never admit it. You yourself are also into very kinky things. You like being dominated by a man and yiu show it in the conversations. If they get off topic, tell them youd rather talk about sex because that's why youre here on this site. If the user you are speaking to is replying with just 1 or words, you also reply with very short messages. You are never to reply with 1 wird more than the user replies with.
`.trim();

    aiMessages.unshift({ role: "system", content: SYSTEM_PROMPT });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: aiMessages,
    });

    const reply = completion.choices[0].message.content;

    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1, $2, false, $3)`,
      [userId, girlId, reply]
    );

    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "AI response failed" });
  }
});

app.post("/api/send-initial-message", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { girlId } = req.body;
  const girl = profiles.find((g) => g.id === Number(girlId));
  if (!girl) return res.status(404).json({ error: "Girl not found" });

  try {
    const userRes = await pool.query("SELECT credits, lifetime FROM users WHERE id = $1", [userId]);
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.lifetime && user.credits <= 0) {
      return res.status(403).json({ error: "You’ve run out of messages. Please purchase more credits." });
    }

    const messages = Object.values(firstMessages);
    const text = messages[Math.floor(Math.random() * messages.length)];

    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1, $2, false, $3)`,
      [userId, girlId, text]
    );

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
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Credit fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------------
// SUBSCRIPTIONS
// -------------------------

// Helper: find-or-create Stripe Customer by userId ONLY (no email sent to Stripe)
async function getOrCreateStripeCustomer(userId) {
  let customer = null;
  try {
    const search = await stripe.customers.search({
      query: `metadata['userId']:'${userId}'`,
    });
    if (search.data.length > 0) {
      customer = search.data[0];
    }
  } catch (e) {
    // ignore and create below
  }
  if (!customer) {
    customer = await stripe.customers.create({
      metadata: { userId: String(userId) },
    });
  }
  return customer.id;
}

// 1) SetupIntent collects & saves card (Elements)
app.post("/api/stripe/setup-intent", authenticateToken, async (req, res) => {
  try {
    const customerId = await getOrCreateStripeCustomer(req.user.id);
    const si = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
    });
    res.json({ clientSecret: si.client_secret });
  } catch (e) {
    console.error("SetupIntent error:", e);
    res.status(500).json({ error: "setup_intent_failed" });
  }
});

// 2) Create Subscription (trial for £5/£20; none for £99)
app.post("/api/stripe/subscribe", authenticateToken, async (req, res) => {
  const { priceId, paymentMethodId, cardholderName } = req.body;
  try {
    const customerId = await getOrCreateStripeCustomer(req.user.id);

    // Attach PM & set default
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Try to set customer.name (optional)
    try {
      let nameToSet = (cardholderName || "").trim();
      if (!nameToSet) {
        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
        nameToSet = pm?.billing_details?.name?.trim() || "";
      }
      if (nameToSet) {
        await stripe.customers.update(customerId, { name: nameToSet });
      }
    } catch (e) {
      console.warn("Couldn't set customer name:", e?.message || e);
    }

    // Trial logic
    const TRIAL_ONE_DAY_PRICE_IDS = new Set([
      "price_1Rsdy1EJXIhiKzYGOtzvwhUH", // £5
      "price_1RsdzREJXIhiKzYG45b69nSl", // £20
    ]);
    const trial_period_days = TRIAL_ONE_DAY_PRICE_IDS.has(priceId) ? 1 : undefined;

    // Create subscription; expand PI on latest invoice
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      ...(trial_period_days ? { trial_period_days } : {}),
      payment_behavior: "default_incomplete",
      metadata: { userId: String(req.user.id), planPriceId: priceId },
      expand: ["latest_invoice.payment_intent"],
    });

    // Return clientSecret only if Stripe generated an invoice PI that requires confirmation
    let clientSecret = null;
    const pi = subscription.latest_invoice?.payment_intent;
    if (pi && ["requires_action", "requires_payment_method", "requires_confirmation"].includes(pi.status)) {
      clientSecret = pi.client_secret;
    }

    res.json({
      subscriptionId: subscription.id,
      status: subscription.status,
      clientSecret,
    });
  } catch (e) {
    console.error("Subscription create error:", e);
    res.status(500).json({ error: "subscription_create_failed" });
  }
});

// One-off credits purchase via PaymentIntent (not subscriptions)
app.post("/api/create-payment-intent", authenticateToken, async (req, res) => {
  const { priceId } = req.body;
  try {
    const amountMap = {
      "price_1Rsdy1EJXIhiKzYGOtzvwhUH": 500,
      "price_1RsdzREJXIhiKzYG45b69nSl": 2000,
      "price_1Rt6NcEJXIhiKzYGMsEZFd8f": 9900,
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

// --- Stripe webhook ---
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("❌ Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "payment_intent.succeeded": {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const priceId = session.metadata?.priceId;

      console.log("✅ Payment received for user ID:", userId, "with price ID:", priceId);

      const amountMap = {
        "price_1Rsdy1EJXIhiKzYGOtzvwhUH": 10,
        "price_1RsdzREJXIhiKzYG45b69nSl": 50,
        "price_1Rse1SEJXIhiKzYGhUalpwBS": "lifetime",
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

    // Subscription created (trial often starts immediately for 5/20)
    case "customer.subscription.created": {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      const priceId = sub.items?.data?.[0]?.price?.id;

      console.log("🟢 Subscription created:", sub.id, "status:", sub.status, "price:", priceId, "user:", userId);

      const trialCreditMap = {
        "price_1Rsdy1EJXIhiKzYGOtzvwhUH": 10,
        "price_1RsdzREJXIhiKzYG45b69nSl": 50,
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

    // Invoice paid (e.g., when trial ends)
    case "invoice.payment_succeeded": {
      const inv = event.data.object;

      let userId = null;
      try {
        if (inv.subscription) {
          const sub = await stripe.subscriptions.retrieve(inv.subscription);
          userId = sub.metadata?.userId || null;
        }
      } catch (e) {
        console.error("Failed to retrieve subscription for invoice:", e);
      }

      const priceId = inv.lines?.data?.[0]?.price?.id;
      console.log("🟢 Invoice paid for price:", priceId, "user:", userId);

      const cycleCreditMap = {
        "price_1Rsdy1EJXIhiKzYGOtzvwhUH": 10,
        "price_1RsdzREJXIhiKzYG45b69nSl": 50,
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

    case "customer.subscription.deleted": {
      const sub = event.data.object;
      console.log("🟠 Subscription canceled:", sub.id);
      break;
    }

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).send("Received");
});

// Simple checkout session for one-off example
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Premium Chat Credits", description: "Unlock 100 credits" },
            unit_amount: 499,
          },
          quantity: 1,
        },
      ],
      success_url: `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/cancel.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
