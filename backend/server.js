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
4: "hiya stranger, wanna keep me company 2nite?",
5: "not gonna lie, i’m kinda in a mood rn 🙈",
6: "u awake? got something cheeky in mind 👀",
7: "feel like gettin into mischief, u in?",
8: "can tell by ur pics ur a bad influence 😜",
9: "sat here thinkin bout you… dangerous 😂",
10: "oi… you free later or what?",
11: "bit lonely over here, need some fun x",
12: "not tryna be subtle… i like ur vibe",
13: "any plans 2nite? i might have an idea…",
14: "u always look this fit or just online?",
15: "god ur smile’s killin me rn",
16: "mmm you look like you’d be a laugh",
17: "what u doin later, handsome?",
18: "fancy makin my night more interesting?",
19: "hope ur not shy 😉",
20: "you look like trouble and i like it",
21: "literally can’t stop lookin at ur pics",
22: "hey you… fancy a lil adventure?",
23: "was just thinking… u + me = good time",
24: "tell me ur not busy later 👀",
25: "bet you’re fun when no one’s watchin",
26: "gimme a reason not to be bored rn",
27: "ur eyes… wow, had to say hi",
28: "u around? i’ve got a cheeky idea",
29: "omg i shouldn’t message this late… oops",
30: "feel like causin a bit of chaos 2nite?",
31: "free now? i am 😏",
32: "lol ur profile’s makin me think naughty",
33: "need someone to distract me… u game?",
34: "what’s the worst trouble we could get in?",
35: "lookin at you makes my mind wander…",
36: "so… u always this hot or just online?",
37: "oi cheeky, text me back quick",
38: "was hopin you’d msg me first…",
39: "bet i could make u blush 😉",
40: "need a partner in crime for later",
41: "feel like talkin to someone fit rn",
42: "promise i’m not always this forward…",
43: "where u from? u look familiar…",
44: "god i’m bored… entertain me pls",
45: "u strike me as someone fun after dark",
46: "had to say hi… couldn’t help myself",
47: "hey, don’t make me double text u",
48: "u look cheeky, prove me right?",
49: "my head’s in the gutter… help",
50: "sooo… what u wearin? 👀",
51: "think we’d get along too well…",
52: "oi fit boy, chat to me",
53: "how’s ur night goin so far?",
54: "feelin flirty, u busy?",
55: "bet u get messages like this all the time",
56: "wanna hear a secret? 😉",
57: "hmm, ur profile gave me ideas",
58: "can’t stop smilin lookin at ur pics",
59: "hey, u seem my type tbh",
60: "u look like u know how to have fun",
61: "free later? i might be trouble",
62: "fancy keepin me warm 2nite?",
63: "my brain says no, but my heart says msg him",
64: "ur arms… wow 😳",
65: "so how naughty are u really?",
66: "bored out my mind… u?",
67: "could do with a laugh rn",
68: "u online? i’ve got mischief planned",
69: "swear i’ve seen u somewhere before",
70: "can we skip the small talk? 😉",
71: "i’m bein cheeky but… hi",
72: "was stalkin ur pics, had to say hi",
73: "what’s ur type? bet i’m close",
74: "u got plans or can i steal u?",
75: "bet u can’t guess what i’m thinkin",
76: "oi you, stop lookin so good",
77: "my bf’s away so i’m bored af",
78: "feel like havin a late night chat?",
79: "not gonna lie, i’m curious bout u",
80: "so how much trouble can we get in?",
81: "ur smile’s a killer…",
82: "u look like a bad idea… i like it",
83: "fancy makin me laugh 2nite?",
84: "my friends say i’m trouble, u in?",
85: "ur pics made me blush tbh",
86: "what’s a guy like u doin single?",
87: "havin a glass of wine… join me?",
88: "think i’d like ur company rn",
89: "u awake? i’m not sleepy yet",
90: "free to chat or u busy?",
91: "god i’m restless…",
92: "u seem fun… let’s test that",
93: "would u keep me company if i asked?",
94: "oi cheeky grin, how are ya?",
95: "ur profile’s dangerous for my thoughts",
96: "i feel like bein bad rn",
97: "bet we’d get on too well 😉",
98: "sooo… u flirt much?",
99: "hey cutie, talk to me",
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

// ✅ FIXED: Group messages by girlId for frontend compatibility
app.get("/api/messages", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      "SELECT * FROM messages WHERE user_id = $1 ORDER BY created_at ASC",
      [userId]
    );

    // Group messages into { "userId-girlId": [messages] }
    const grouped = {};
    for (const msg of result.rows) {
      const chatKey = `${userId}-${msg.girl_id}`;
      if (!grouped[chatKey]) grouped[chatKey] = [];
      grouped[chatKey].push({
        from: msg.from_user ? "user" : profiles.find(g => g.id === msg.girl_id)?.name || "Unknown",
        avatar: msg.from_user ? null : profiles.find(g => g.id === msg.girl_id)?.image || null,
        text: msg.text,
        time: msg.created_at
      });
    }

    res.json(grouped);
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

// === NEW: Notifications endpoint for profile page ===
app.get("/api/notifications", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // For each girl, get the last AI message (from_user = false)
    // This query gets last message per girl for the user
    const result = await pool.query(
      `
      SELECT DISTINCT ON (girl_id) girl_id, text, created_at
      FROM messages
      WHERE user_id = $1 AND from_user = false
      ORDER BY girl_id, created_at DESC
      `,
      [userId]
    );

    // Map results with profiles data
    const notifications = result.rows.map(row => {
      const girlProfile = profiles.find(g => g.id === row.girl_id);
      return {
        girlId: row.girl_id,
        name: girlProfile?.name || "Unknown",
        image: girlProfile?.image || null,
        lastMessage: row.text,
        time: row.created_at,
      };
    });

    res.json(notifications);
  } catch (err) {
    console.error("Notifications error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
