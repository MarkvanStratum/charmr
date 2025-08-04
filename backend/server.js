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

app.use(cors());
app.use(express.json());

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
  { id: 3, name: "Grace Johnson", age: 20, city: "London", image: "https://randomuser.me/api/portraits/women/3.jpg" },
  { id: 4, name: "Amelia Davies", age: 27, city: "Swansea", image: "https://randomuser.me/api/portraits/women/4.jpg" },
  { id: 5, name: "Charlotte Hall", age: 37, city: "Glasgow", image: "https://randomuser.me/api/portraits/women/5.jpg" },
  { id: 6, name: "Evie White", age: 25, city: "Exeter", image: "https://randomuser.me/api/portraits/women/6.jpg" },
  { id: 7, name: "Sophie Evans", age: 23, city: "Bristol", image: "https://randomuser.me/api/portraits/women/7.jpg" },
  { id: 8, name: "Isla Wilson", age: 40, city: "Belfast", image: "https://randomuser.me/api/portraits/women/8.jpg" },
  { id: 9, name: "Amelia Lewis", age: 22, city: "Norwich", image: "https://randomuser.me/api/portraits/women/9.jpg" },
  { id: 10, name: "Freya Evans", age: 37, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/10.jpg" },
  { id: 11, name: "Sophie Williams", age: 36, city: "Cambridge", image: "https://randomuser.me/api/portraits/women/11.jpg" },
  { id: 12, name: "Scarlett Thomas", age: 21, city: "Bristol", image: "https://randomuser.me/api/portraits/women/12.jpg" },
  { id: 13, name: "Daisy White", age: 37, city: "Basingstoke", image: "https://randomuser.me/api/portraits/women/13.jpg" },
  { id: 14, name: "Freya Wright", age: 23, city: "Wolverhampton", image: "https://randomuser.me/api/portraits/women/14.jpg" },
  { id: 15, name: "Freya Jones", age: 36, city: "London", image: "https://randomuser.me/api/portraits/women/15.jpg" },
  { id: 16, name: "Sophie White", age: 40, city: "Swindon", image: "https://randomuser.me/api/portraits/women/16.jpg" },
  { id: 17, name: "Olivia Brown", age: 27, city: "Leicester", image: "https://randomuser.me/api/portraits/women/17.jpg" },
  { id: 18, name: "Olivia Evans", age: 37, city: "Worcester", image: "https://randomuser.me/api/portraits/women/18.jpg" },
  { id: 19, name: "Evie Wilson", age: 19, city: "Coventry", image: "https://randomuser.me/api/portraits/women/19.jpg" },
  { id: 20, name: "Sophie Thompson", age: 26, city: "Cambridge", image: "https://randomuser.me/api/portraits/women/20.jpg" },
  { id: 21, name: "Sophia Hall", age: 31, city: "Dundee", image: "https://randomuser.me/api/portraits/women/21.jpg" },
  { id: 22, name: "Ella Hughes", age: 20, city: "York", image: "https://randomuser.me/api/portraits/women/22.jpg" },
  { id: 23, name: "Amelia Wright", age: 18, city: "Cardiff", image: "https://randomuser.me/api/portraits/women/23.jpg" },
  { id: 24, name: "Florence Edwards", age: 34, city: "Bath", image: "https://randomuser.me/api/portraits/women/24.jpg" },
  { id: 25, name: "Sophia Wilson", age: 21, city: "Stoke-on-Trent", image: "https://randomuser.me/api/portraits/women/25.jpg" },
  { id: 26, name: "Lily White", age: 20, city: "Blackpool", image: "https://randomuser.me/api/portraits/women/26.jpg" },
  { id: 27, name: "Ava Brown", age: 38, city: "Milton Keynes", image: "https://randomuser.me/api/portraits/women/27.jpg" },
  { id: 28, name: "Daisy Lewis", age: 20, city: "Basingstoke", image: "https://randomuser.me/api/portraits/women/28.jpg" },
  { id: 29, name: "Ava Walker", age: 29, city: "Slough", image: "https://randomuser.me/api/portraits/women/29.jpg" },
  { id: 30, name: "Jessica Brown", age: 35, city: "Newport", image: "https://randomuser.me/api/portraits/women/30.jpg" },
  { id: 31, name: "Daisy Smith", age: 19, city: "Belfast", image: "https://randomuser.me/api/portraits/women/31.jpg" },
  { id: 32, name: "Mia Wright", age: 24, city: "Dundee", image: "https://randomuser.me/api/portraits/women/32.jpg" },
  { id: 33, name: "Isla Thompson", age: 34, city: "Leeds", image: "https://randomuser.me/api/portraits/women/33.jpg" },
  { id: 34, name: "Olivia Johnson", age: 40, city: "Newport", image: "https://randomuser.me/api/portraits/women/34.jpg" },
  { id: 35, name: "Sophie Thompson", age: 37, city: "Belfast", image: "https://randomuser.me/api/portraits/women/35.jpg" },
  { id: 36, name: "Amelia Lewis", age: 19, city: "Bath", image: "https://randomuser.me/api/portraits/women/36.jpg" },
  { id: 37, name: "Grace White", age: 37, city: "Oxford", image: "https://randomuser.me/api/portraits/women/37.jpg" },
  { id: 38, name: "Ella Evans", age: 27, city: "Slough", image: "https://randomuser.me/api/portraits/women/38.jpg" },
  { id: 39, name: "Sophie Edwards", age: 18, city: "Reading", image: "https://randomuser.me/api/portraits/women/39.jpg" },
  { id: 40, name: "Charlotte Wilson", age: 23, city: "Luton", image: "https://randomuser.me/api/portraits/women/40.jpg" },
  { id: 41, name: "Daisy White", age: 40, city: "Swindon", image: "https://randomuser.me/api/portraits/women/41.jpg" },
  { id: 42, name: "Poppy White", age: 40, city: "Exeter", image: "https://randomuser.me/api/portraits/women/42.jpg" },
  { id: 43, name: "Amelia Evans", age: 32, city: "Slough", image: "https://randomuser.me/api/portraits/women/43.jpg" },
  { id: 44, name: "Ella Johnson", age: 34, city: "Milton Keynes", image: "https://randomuser.me/api/portraits/women/44.jpg" },
  { id: 45, name: "Mia Johnson", age: 22, city: "Middlesbrough", image: "https://randomuser.me/api/portraits/women/45.jpg" },
  { id: 46, name: "Charlotte Walker", age: 40, city: "Kingston upon Hull", image: "https://randomuser.me/api/portraits/women/46.jpg" },
  { id: 47, name: "Emily Johnson", age: 24, city: "Telford", image: "https://randomuser.me/api/portraits/women/47.jpg" },
  { id: 48, name: "Freya Brown", age: 29, city: "Peterborough", image: "https://randomuser.me/api/portraits/women/48.jpg" },
  { id: 49, name: "Charlotte White", age: 39, city: "Nottingham", image: "https://randomuser.me/api/portraits/women/49.jpg" },
  { id: 50, name: "Florence Evans", age: 19, city: "Nottingham", image: "https://randomuser.me/api/portraits/women/50.jpg" },
  { id: 51, name: "Evie Wilson", age: 27, city: "Cardiff", image: "https://randomuser.me/api/portraits/women/51.jpg" },
  { id: 52, name: "Lily Thomas", age: 25, city: "Newcastle", image: "https://randomuser.me/api/portraits/women/52.jpg" },
  { id: 53, name: "Daisy Hughes", age: 34, city: "London", image: "https://randomuser.me/api/portraits/women/53.jpg" },
  { id: 54, name: "Emily Wilson", age: 24, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/54.jpg" },
  { id: 55, name: "Isla Brown", age: 21, city: "Colchester", image: "https://randomuser.me/api/portraits/women/55.jpg" },
  { id: 56, name: "Poppy Taylor", age: 25, city: "Manchester", image: "https://randomuser.me/api/portraits/women/56.jpg" },
  { id: 57, name: "Daisy Smith", age: 28, city: "Stockport", image: "https://randomuser.me/api/portraits/women/57.jpg" },
  { id: 58, name: "Isabella Walker", age: 40, city: "Bolton", image: "https://randomuser.me/api/portraits/women/58.jpg" },
  { id: 59, name: "Isla Williams", age: 21, city: "Inverness", image: "https://randomuser.me/api/portraits/women/59.jpg" },
  { id: 60, name: "Isabella Wright", age: 39, city: "Preston", image: "https://randomuser.me/api/portraits/women/60.jpg" },
  { id: 61, name: "Charlotte Davies", age: 35, city: "Ipswich", image: "https://randomuser.me/api/portraits/women/61.jpg" },
  { id: 62, name: "Amelia Davies", age: 26, city: "Newcastle", image: "https://randomuser.me/api/portraits/women/62.jpg" },
  { id: 63, name: "Isla Wilson", age: 25, city: "Peterborough", image: "https://randomuser.me/api/portraits/women/63.jpg" },
  { id: 64, name: "Isabella Hall", age: 21, city: "Liverpool", image: "https://randomuser.me/api/portraits/women/64.jpg" },
  { id: 65, name: "Poppy Brown", age: 37, city: "Kingston upon Hull", image: "https://randomuser.me/api/
];

const firstMessages = {
  1: "hey what you up to rn? feel like bein a bit naughty 😉",
  2: "u look trouble... in a good way 😏",
  3: "sooo bored… fancy entertaining me?",
  4: "hiya stranger, wanna keep me company 2nite?",
  5: "not gonna lie, i’m kinda in a mood rn 🙈"
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
  const { plan } = req.body;
  const priceMap = {
    "10": "price_1RsLy5CVovIV0BJMYTTwTnEr",        // £5
    "50": "price_1RsLz3CVovIV0BJMmoMBkE2F",        // £20
    "unlimited": "price_1RsM0LCVovIV0BJMbz2hArkY"  // £99
  };

  const selectedPrice = priceMap[plan];
  if (!selectedPrice) {
    return res.status(400).json({ error: "Invalid plan selected" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [
        {
          price: selectedPrice,
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
