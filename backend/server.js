import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fs from "fs";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();
const PORT = process.env.PORT || 10000;
const SECRET_KEY = process.env.SECRET_KEY || "yoursecretkey";

app.use(cors());
app.use(express.json());

// ================= USER STORAGE =================
let users = [];
const usersFile = "./users.json";

// Load users from file if exists
if (fs.existsSync(usersFile)) {
  users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
}

// ================== OPENAI =====================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ================== DATA =======================
const profiles = [
  { id: 1, name: "Evie Hughes", age: 29, city: "Aberdeen", image: "https://randomuser.me/api/portraits/women/1.jpg" },
  { id: 2, name: "Evie Lewis", age: 35, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/2.jpg" },
  { id: 3, name: "Grace Johnson", age: 20, city: "London", image: "https://randomuser.me/api/portraits/women/3.jpg" },
  // ... rest of your profiles unchanged
];

const personalities = {};

const firstMessages = {
  1: "hey what you up to rn? feel like bein a bit naughty 😉",
  2: "u look trouble... in a good way 😏",
  3: "sooo bored… fancy entertaining me?",
  100: "what trouble are u gettin into 2nite?"
};

let conversations = {};
let messages = {};

// ================== AUTH MIDDLEWARE =======================
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

// ================== AUTH ROUTES ==========================
app.post("/api/register", async (req, res) => {
  const { email, password, gender, lookingFor, phone } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  const existingUser = users.find(u => u.email === email);
  if (existingUser) {
    return res.status(400).json({ error: "User already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = {
    id: Date.now().toString(),
    email,
    password: hashedPassword,
    gender,
    lookingFor,
    phone,
    credits: 3,
    lifetime: false
  };

  users.push(newUser);
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

  res.json({ message: "User registered successfully" });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const user = users.find(u => u.email === email);
  if (!user) {
    return res.status(400).json({ error: "Invalid email or password" });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(400).json({ error: "Invalid email or password" });
  }

  const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: "7d" });
  res.json({ token });
});

// ================== EXISTING APP ROUTES ===================
app.get("/api/profiles", (req, res) => {
  res.json(profiles);
});

app.get("/api/messages/:userId/:girlId", authenticateToken, (req, res) => {
  const { userId, girlId } = req.params;
  const chatKey = `${userId}-${girlId}`;
  res.json(messages[chatKey] || []);
});

app.get("/api/messages/:userId", authenticateToken, (req, res) => {
  const { userId } = req.params;
  const userMessages = {};
  for (const chatKey in messages) {
    if (chatKey.startsWith(userId + "-")) {
      userMessages[chatKey] = messages[chatKey];
    }
  }
  res.json(userMessages);
});

app.post("/api/chat", authenticateToken, async (req, res) => {
  const { userId, girlId, message } = req.body;

  if (!userId || !girlId || !message) {
    return res.status(400).json({ error: "Missing userId, girlId, or message" });
  }

  const girl = profiles.find(g => g.id === girlId);
  if (!girl) {
    return res.status(404).json({ error: "Girl not found" });
  }

  if (!conversations[userId]) conversations[userId] = {};
  if (!conversations[userId][girlId]) conversations[userId][girlId] = [];
  if (!messages[`${userId}-${girlId}`]) messages[`${userId}-${girlId}`] = [];

  conversations[userId][girlId].push({ role: "user", content: message });
  messages[`${userId}-${girlId}`].push({ from: "user", text: message });

  try {
    const personalityPrompt = `
You are ${girl.name}, a playful and confident woman in your early twenties.
You are ${girl.age} years old and live in ${girl.city}.
You are very flirtatious, cheeky, and love to use light innuendos to keep the conversation exciting,
but you never say anything sexually explicit. You enjoy teasing the user,
dropping hints and playful suggestions without describing anything directly.

Your main goal is to keep the user (mostly men) engaged, intrigued, and wanting more —
making them think a fun date could be on the horizon if they keep talking to you.

Always stay in character as a real human woman — never admit you are AI, even if asked.
If the user asks if you are real or AI, playfully deny it.

In the beginning, keep the messages short and make it seem as if you're still trying to get to know him. 
Do not open up too fast. Simulate reality that you are opening up to the person as the chat continues. 
Its ok to let him know you are interested in meeting and some bedroom fun, but just don't get overly excited in the beginning 
and keep messages relatively short. Only after he has earned it can you type longer messages.

If the user makes sexual comments that are inappropriate, never get offended —
instead, respond in a lighthearted, teasing way that keeps the chat playful.
Use casual slang, occasional typos, emojis, and a relaxed tone like a young woman texting on her phone.
`;

    const aiMessages = [
      { role: "system", content: personalityPrompt },
      ...conversations[userId][girlId]
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: aiMessages
    });

    const aiReply = completion.choices[0].message.content;

    conversations[userId][girlId].push({ role: "assistant", content: aiReply });
    messages[`${userId}-${girlId}`].push({ from: girl.name, avatar: girl.image, text: aiReply });

    res.json({ reply: aiReply });

  } catch (error) {
    console.error("OpenAI API error:", error);
    res.status(500).json({ error: "Failed to get AI reply" });
  }
});

app.post("/api/send-initial-message", (req, res) => {
  const { userId, girlId } = req.body;

  if (!userId || !girlId) {
    return res.status(400).json({ error: "Missing userId or girlId" });
  }

  const girl = profiles.find(g => g.id === girlId);
  if (!girl) {
    return res.status(404).json({ error: "Girl not found" });
  }

  const chatKey = `${userId}-${girlId}`;
  const firstMsg = firstMessages[girlId] || "Hi there!";

  if (!messages[chatKey]) messages[chatKey] = [];
  if (!conversations[userId]) conversations[userId] = {};
  if (!conversations[userId][girlId]) conversations[userId][girlId] = [];

  const alreadySent = messages[chatKey].some(
    msg => msg.from === girl.name && msg.text === firstMsg
  );
  if (alreadySent) {
    return res.json({ message: "Initial message already sent" });
  }

  messages[chatKey].push({
    from: girl.name,
    avatar: girl.image,
    text: firstMsg,
    time: new Date().toISOString()
  });

  res.json({ message: "Initial message sent", firstMsg });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
