import express from "express";
import cors from "cors";
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pkg from "pg";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 10000;
const SECRET_KEY = process.env.SECRET_KEY || "yoursecretkey";

// ✅ Stripe webhook must use raw body parser
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('✅ Payment received for:', session.customer_email);
      // TODO: Lookup user by email and update their credits/lifetime status
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).send('Received');
});

// ✅ Use raw parser only for /api/webhook
app.use((req, res, next) => {
  if (req.originalUrl === '/api/webhook') {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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
        credits INT DEFAULT 3,
        lifetime BOOLEAN DEFAULT false
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

    console.log("✅ Tables are ready");
  } catch (err) {
    console.error("❌ Error creating tables:", err);
  }
})();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const profiles = [
  { id: 1, name: "Evie Hughes", age: 29, city: "Aberdeen", image: "https://randomuser.me/api/portraits/women/1.jpg" },
  { id: 2, name: "Evie Lewis", age: 35, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/2.jpg" },
  { id: 3, name: "Grace Johnson", age: 20, city: "London", image: "https://randomuser.me/api/portraits/women/3.jpg" }
];

const firstMessages = {
  1: "what are you doing… or who? 😈",
  2: "you home... or somewhere u shouldn’t be? 😏",
  3: "is your phone in your hand or should i wait? 👀"
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
    res.json({ message: "User registered successfully" });
  } catch (err) {
    console.error("Register error:", err);
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

app.post("/api/chat", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { girlId, message } = req.body;
  const girl = profiles.find(g => g.id === Number(girlId));
  if (!girl) return res.status(404).json({ error: "Girl not found" });

  try {
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
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "AI response failed" });
  }
});

app.post("/api/send-initial-message", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { girlId } = req.body;
  const girl = profiles.find(g => g.id === Number(girlId));
  if (!girl) return res.status(404).json({ error: "Girl not found" });

  const messages = Object.values(firstMessages);
  const text = messages[Math.floor(Math.random() * messages.length)];

  try {
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

app.post("/api/create-checkout-session", authenticateToken, async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [
        {
          price: "price_1RsLy5CVovIV0BJMYTTwTnEr", // ✅ your real Stripe price ID
          quantity: 1,
        },
      ],
      success_url: "https://chatbait.co/success",
      cancel_url: "https://chatbait.co/cancel",
      metadata: { userId: req.user.id.toString() },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
