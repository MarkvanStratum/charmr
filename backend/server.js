import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import Stripe from "stripe";
import multer from "multer";
import fetch from "node-fetch";
import { Pool } from "pg";
import SibApiV3Sdk from "sib-api-v3-sdk";

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(cors());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

// ---------- DB ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

// ---------- Email (Brevo / Sendinblue) ----------
const brevoApiKey = process.env.BREVO_API_KEY || "";
SibApiV3Sdk.ApiClient.instance.authentications["api-key"].apiKey = brevoApiKey;
const brevoTransactionalEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

// ---------- Stripe ----------
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16",
});

// ---------- Multer (file uploads for operator images) ----------
const upload = multer({ storage: multer.memoryStorage() });

// ---------- Helpers ----------
function ok(res, payload) {
  res.json(payload || { ok: true });
}
function bad(res, msg = "Bad Request", code = 400) {
  res.status(code).json({ error: msg });
}
function required(v) {
  return v !== undefined && v !== null && v !== "" && !(typeof v === "number" && Number.isNaN(v));
}
function toBool(x) {
  if (typeof x === "boolean") return x;
  if (typeof x === "string") return ["1", "true", "yes", "y"].includes(x.toLowerCase());
  if (typeof x === "number") return x !== 0;
  return false;
}

// ---------- Auth (User) ----------
function authenticateToken(req, res, next) {
  const auth = req.headers.authorization || "";
  const tok = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!tok) return res.status(401).json({ error: "No token" });
  try {
    const obj = jwt.verify(tok, JWT_SECRET);
    req.user = obj;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ---------- Auth (Operator) ----------
function authenticateOperator(req, res, next) {
  const key = (req.headers["x-operator-key"] || "").toString();
  if (!key) return res.status(401).json({ error: "Missing operator key" });
  if (key !== (process.env.OPERATOR_KEY || "")) return res.status(401).json({ error: "Invalid operator key" });
  req.operator = { ok: true };
  next();
}
function authenticateOperatorOrFail(req, res, next) {
  return authenticateOperator(req, res, next);
}

// ---------- Public / Authenticated Endpoints ----------

// Login (simplified demo)
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!required(email) || !required(password)) return bad(res, "Email and password required");

    const { rows } = await pool.query(
      `SELECT id, email, first_name, last_name FROM users WHERE email=$1 LIMIT 1`,
      [email]
    );
    let user = rows[0];
    if (!user) {
      const ins = await pool.query(
        `INSERT INTO users (email, first_name, last_name) VALUES ($1,$2,$3) RETURNING id, email, first_name, last_name`,
        [email, null, null]
      );
      user = ins.rows[0];
    }
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user });
  } catch (e) {
    console.error("login error", e);
    bad(res, "Login failed", 500);
  }
});

// Girls list (static/demo)
app.get("/api/girls", async (_req, res) => {
  const { rows } = await pool.query("SELECT id, name, image FROM girls ORDER BY id ASC");
  ok(res, rows);
});

// Fetch messages for a logged-in user + a girl
app.get("/api/messages/:girlId", authenticateToken, async (req, res) => {
  try {
    const girlId = Number(req.params.girlId);
    const userId = Number(req.user.id);
    if (!girlId || !userId) return bad(res, "Invalid ids");
    const { rows } = await pool.query(
      `SELECT id, user_id, girl_id, from_user, text, created_at
         FROM messages
        WHERE user_id=$1 AND girl_id=$2
        ORDER BY created_at ASC`,
      [userId, girlId]
    );
    ok(res, rows);
  } catch (e) {
    console.error("get messages error", e);
    bad(res, "Failed to load messages", 500);
  }
});

// Chat (user sends a message; server replies or queues)
app.post("/api/chat", authenticateToken, async (req, res) => {
  try {
    const { girlId, message } = req.body || {};
    const userId = Number(req.user.id);
    if (!required(girlId) || !required(message)) return bad(res, "girlId and message required");

    // deduct credits/plan check ...
    // store user message
    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1,$2,true,$3)`,
      [userId, Number(girlId), String(message)]
    );

    // create a fake/bot reply or hook into your responder here
    const reply = "Thanks for your message 💕";
    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1,$2,false,$3)`,
      [userId, Number(girlId), reply]
    );

    ok(res, { reply });
  } catch (e) {
    console.error("chat error", e);
    bad(res, "Chat failed", 500);
  }
});

// Credits / plan info (used by client to know IS_PREMIUM, etc.)
app.get("/api/credits", authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const { rows } = await pool.query(
      `SELECT lifetime, plan_price_id, trial_end FROM subscriptions WHERE user_id=$1 ORDER BY id DESC LIMIT 1`,
      [userId]
    );
    const sub = rows[0] || null;
    ok(res, sub || { lifetime: false });
  } catch (e) {
    console.error("credits error", e);
    bad(res, "Failed to load credits", 500);
  }
});

// ---------- Operator Endpoints ----------

// Operator: feed (newest “user replies” etc.)
app.get("/api/operator/feed", authenticateOperatorOrFail, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
    const since = req.query.since ? new Date(req.query.since) : null;

    // You may tune this query: we return recent rows used to build the sidebar
    const rowsRes = await pool.query(
      `
      SELECT id,
             user_id  AS "userId",
             girl_id  AS "girlId",
             from_user AS "from_user",
             text,
             created_at AS "createdAt"
        FROM messages
       WHERE ($1::timestamp IS NULL OR created_at > $1)
       ORDER BY created_at DESC
       LIMIT $2
      `,
      [since, limit]
    );

    ok(res, { now: new Date().toISOString(), rows: rowsRes.rows });
  } catch (e) {
    console.error("feed error", e);
    bad(res, "Failed to load feed", 500);
  }
});

// Operator: send plain text
app.post("/api/operator/send", authenticateOperatorOrFail, async (req, res) => {
  try {
    const { userId, girlId, text } = req.body || {};
    if (!required(userId) || !required(girlId) || !required(text)) return bad(res, "userId, girlId, text required");

    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1,$2,false,$3)`,
      [Number(userId), Number(girlId), String(text)]
    );
    ok(res);
  } catch (e) {
    console.error("operator send error", e);
    bad(res, "Failed to send", 500);
  }
});

// Operator: send image (either URL JSON or multipart upload)
app.post("/api/operator/send-image", authenticateOperatorOrFail, upload.single("image"), async (req, res) => {
  try {
    const userId = Number(req.body.userId || req.query.userId);
    const girlId = Number(req.body.girlId || req.query.girlId);
    if (!userId || !girlId) return bad(res, "userId and girlId required");

    const imageUrl = req.body.imageUrl;
    let finalUrl = imageUrl;

    if (!finalUrl && req.file) {
      // TODO: upload req.file.buffer to your storage (S3, Cloudinary, etc.) and get a URL
      // For demo we pretend we uploaded and produced a URL:
      finalUrl = `https://example.com/uploads/${Date.now()}-${encodeURIComponent(req.file.originalname)}`;
    }

    if (!finalUrl) return bad(res, "No image provided");

    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1,$2,false,$3)`,
      [userId, girlId, `IMAGE: ${finalUrl}`]
    );

    ok(res, { url: finalUrl });
  } catch (e) {
    console.error("operator send-image error", e);
    bad(res, "Failed to send image", 500);
  }
});

// Takeover: status
app.get("/api/takeover/status/:girlId", async (req, res) => {
  try {
    const girlId = Number(req.params.girlId);
    const userId = req.query.userId ? Number(req.query.userId) : null;

    const { rows } = await pool.query(
      `SELECT id, girl_id, user_id, operator_name, active
         FROM takeovers
        WHERE girl_id=$1
          AND ($2::int IS NULL OR user_id=$2)
        ORDER BY id DESC
        LIMIT 1`,
      [girlId, userId]
    );
    const row = rows[0] || null;
    ok(res, { takeover: !!(row && row.active), operatorName: row?.operator_name || null });
  } catch (e) {
    console.error("takeover status error", e);
    bad(res, "Failed", 500);
  }
});

// Takeover: start
app.post("/api/takeover/start", authenticateOperatorOrFail, async (req, res) => {
  try {
    const { userId, girlId, operatorName } = req.body || {};
    if (!required(userId) || !required(girlId)) return bad(res, "userId, girlId required");

    await pool.query(
      `INSERT INTO takeovers (user_id, girl_id, operator_name, active)
       VALUES ($1,$2,$3,true)`,
      [Number(userId), Number(girlId), operatorName || null]
    );
    ok(res);
  } catch (e) {
    console.error("takeover start error", e);
    bad(res, "Failed to start takeover", 500);
  }
});

// Takeover: stop
app.post("/api/takeover/stop", authenticateOperatorOrFail, async (req, res) => {
  try {
    const { userId, girlId } = req.body || {};
    if (!required(userId) || !required(girlId)) return bad(res, "userId, girlId required");

    await pool.query(
      `UPDATE takeovers SET active=false WHERE user_id=$1 AND girl_id=$2`,
      [Number(userId), Number(girlId)]
    );
    ok(res);
  } catch (e) {
    console.error("takeover stop error", e);
    bad(res, "Failed to stop takeover", 500);
  }
});

// ---------- Stripe subscription creation (your existing logic) ----------
// This block includes both immediate-charge flow and (if you decide to) trial flow
app.post("/api/stripe/create-subscription", authenticateToken, async (req, res) => {
  try {
    const { priceId, name } = req.body || {};
    const userId = Number(req.user.id);
    if (!required(priceId)) return bad(res, "priceId required");

    // Ensure Stripe Customer
    const custRow = await pool.query(`SELECT stripe_customer_id FROM users WHERE id=$1`, [userId]);
    let customerId = custRow.rows[0]?.stripe_customer_id || null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email || undefined,
        name: name || undefined,
        metadata: { userId: String(userId) },
      });
      customerId = customer.id;
      await pool.query(`UPDATE users SET stripe_customer_id=$1 WHERE id=$2`, [customerId, userId]);
    } else if (name) {
      try {
        await stripe.customers.update(customerId, { name });
      } catch (e) {
        console.warn("Couldn't set customer name:", e?.message || e);
      }
    }

    // Decide if any price should have a trial. Right now: none.
    const TRIAL_ELIGIBLE_PRICE_IDS = new Set([]);
    const wantsTrial = TRIAL_ELIGIBLE_PRICE_IDS.has(priceId);

    let subscription;

    if (wantsTrial) {
      // Trial flow (unused now)
      const trialSeconds = 24 * 60 * 60;
      subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        trial_period_days: Math.floor(trialSeconds / 86400), // example
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        metadata: { userId: String(userId), planPriceId: priceId },
        expand: ["latest_invoice.payment_intent"],
      });
    } else {
      // Immediate-charge flow (NO TRIAL)
      subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        trial_from_plan: false,
        trial_end: "now",
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        metadata: { userId: String(userId), planPriceId: priceId },
        expand: ["latest_invoice.payment_intent"],
      });
    }

    const latest = subscription.latest_invoice;
    const clientSecret = latest?.payment_intent?.client_secret || null;

    // Store sub (optional mirror)
    await pool.query(
      `INSERT INTO subscriptions (user_id, plan_price_id, stripe_subscription_id, lifetime)
       VALUES ($1,$2,$3,false)
       ON CONFLICT (stripe_subscription_id) DO NOTHING`,
      [userId, priceId, subscription.id]
    );

    ok(res, { subscriptionId: subscription.id, clientSecret });
  } catch (e) {
    console.error("create-subscription error", e);
    bad(res, "Failed to create subscription", 500);
  }
});

// Webhook endpoint (Stripe)
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("stripe webhook signature error", err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        const priceId = invoice.lines?.data?.[0]?.price?.id || null;
        if (subId) {
          await pool.query(
            `UPDATE subscriptions
                SET lifetime=false, plan_price_id=COALESCE($1, plan_price_id)
              WHERE stripe_subscription_id=$2`,
            [priceId, subId]
          );
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object;
        const userId = Number(sub.metadata?.userId || 0) || null;
        const priceId = sub.items?.data?.[0]?.price?.id || null;
        if (userId && sub.id) {
          await pool.query(
            `INSERT INTO subscriptions (user_id, plan_price_id, stripe_subscription_id, lifetime)
             VALUES ($1,$2,$3,false)
             ON CONFLICT (stripe_subscription_id) DO UPDATE
               SET plan_price_id=EXCLUDED.plan_price_id, lifetime=false`,
            [userId, priceId, sub.id]
          );
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await pool.query(
          `DELETE FROM subscriptions WHERE stripe_subscription_id=$1`,
          [sub.id]
        );
        break;
      }
      default:
        break;
    }

    res.json({ received: true });
  } catch (e) {
    console.error("stripe webhook error", e);
    res.status(500).json({ error: "Webhook handler error" });
  }
});

// -----------------------------------------------
// Operator: fetch messages for a user/girl thread
// GET /api/operator/messages?userId=123&girlId=7
// Auth: X-Operator-Key header (authenticateOperatorOrFail)
// Returns: [{ id, user_id, girl_id, from_user, text, created_at }, ... ]
// -----------------------------------------------
app.get("/api/operator/messages", authenticateOperatorOrFail, async (req, res) => {
  try {
    const userId = Number(req.query.userId);
    const girlId = Number(req.query.girlId);
    if (!userId || !girlId) {
      return res.status(400).json({ error: "userId and girlId are required" });
    }

    const { rows } = await pool.query(
      `SELECT id, user_id, girl_id, from_user, text, created_at
         FROM messages
        WHERE user_id = $1 AND girl_id = $2
        ORDER BY created_at ASC`,
      [userId, girlId]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET /api/operator/messages error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
