import express from "express";
import cors from "cors";
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 10000;
const SECRET_KEY = process.env.SECRET_KEY || "yoursecretkey";

app.use(cors());
app.use(express.json());

// =============== POSTGRESQL SETUP ================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Create tables if they don't exist
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

// =============== OPENAI ==========================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =============== DATA =============================
const profiles = [
  { id: 1, name: "Evie Hughes", age: 29, city: "Aberdeen", image: "https://randomuser.me/api/portraits/women/1.jpg" },
  { id: 2, name: "Evie Lewis", age: 35, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/2.jpg" },
  { id: 3, name: "Grace Johnson", age: 20, city: "London", image: "https://randomuser.me/api/portraits/women/3.jpg" },
  // ... rest unchanged
];

const firstMessages = {
  1: "hey what you up to rn? feel like bein a bit naughty 😉",
  2: "u look trouble... in a good way 😏",
  3: "sooo bored… fancy entertaining me?",
  100: "what trouble are u gettin into 2nite?"
};

// =============== AUTH MIDDLEWARE ==================
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

// =============== AUTH ROUTES ======================
app.post("/api/register", async (req, res) => {
  const { email, password, gender, lookingFor, phone } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  try {
    const userCheck = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (email, password, gender, lookingfor, phone, credits, lifetime) 
       VALUES ($1, $2, $3, $4, $5, 3, false)`,
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
    const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: "7d" });
    res.json({ token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============== APP ROUTES ========================
app.get("/api/profiles", (req, res) => {
  res.json(profiles);
});

// Get all messages for logged-in user
app.get("/api/messages", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query("SELECT * FROM messages WHERE user_id = $1 ORDER BY created_at ASC", [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get messages for a specific girl
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
    console.error("Get girl messages error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/chat", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { girlId, message } = req.body;

  if (!girlId || !message) {
    return res.status(400).json({ error: "Missing girlId or message" });
  }

  const girl = profiles.find(g => g.id === Number(girlId));
  if (!girl) {
    return res.status(404).json({ error: "Girl not found" });
  }

  try {
    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text, created_at) 
       VALUES ($1, $2, true, $3, NOW())`,
      [userId, girlId, message]
    );

    const personalityPrompt = `
You are ${girl.name}, a playful and confident woman in your early twenties.
You are ${girl.age} years old and live in ${girl.city}.
You are very flirtatious, cheeky, and love to use light innuendos to keep the conversation exciting,
but you never say anything sexually explicit. You enjoy teasing the user,
dropping hints and playful suggestions without describing anything directly.
    `;

    const pastMessagesResult = await pool.query(
      `SELECT from_user, text FROM messages WHERE user_id = $1 AND girl_id = $2 ORDER BY created_at ASC`,
      [userId, girlId]
    );

    const aiMessages = [{ role: "system", content: personalityPrompt }];
    for (const msg of pastMessagesResult.rows) {
      aiMessages.push({
        role: msg.from_user ? "user" : "assistant",
        content: msg.text,
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: aiMessages,
    });

    const aiReply = completion.choices[0].message.content;

    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text, created_at) 
       VALUES ($1, $2, false, $3, NOW())`,
      [userId, girlId, aiReply]
    );

    res.json({ reply: aiReply });

  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Failed to get AI reply" });
  }
});

app.post("/api/send-initial-message", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { girlId } = req.body;

  if (!girlId) {
    return res.status(400).json({ error: "Missing girlId" });
  }

  const girl = profiles.find(g => g.id === Number(girlId));
  if (!girl) {
    return res.status(404).json({ error: "Girl not found" });
  }

  try {
    const firstMsg = firstMessages[girlId] || "Hi there!";

    const checkMsg = await pool.query(
      `SELECT * FROM messages WHERE user_id = $1 AND girl_id = $2 AND from_user = false AND text = $3`,
      [userId, girlId, firstMsg]
    );

    if (checkMsg.rows.length > 0) {
      return res.json({ message: "Initial message already sent" });
    }

    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text, created_at) 
       VALUES ($1, $2, false, $3, NOW())`,
      [userId, girlId, firstMsg]
    );

    res.json({ message: "Initial message sent", firstMsg });
  } catch (err) {
    console.error("Initial message error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
