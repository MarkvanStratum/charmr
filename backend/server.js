import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Example profiles (3 for now)
const profiles = [
  { id: 1, name: "Evie Hughes", age: 29, city: "Aberdeen", image: "https://randomuser.me/api/portraits/women/1.jpg" },
  { id: 2, name: "Evie Lewis", age: 35, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/2.jpg" },
  { id: 3, name: "Grace Johnson", age: 20, city: "London", image: "https://randomuser.me/api/portraits/women/3.jpg" }
];

const personalities = {};

const firstMessages = {
  1: "Hey! I'm Amelia, love music festivals. What about you?",
  2: "Hello! Olivia here. Fancy a chat about art or wine?",
  3: "Hi! Sophia loves adventures. Got any spontaneous plans?"
};

let conversations = {};
let messages = {};

app.get("/api/profiles", (req, res) => {
  res.json(profiles);
});

app.get("/api/messages/:userId/:girlId", (req, res) => {
  const { userId, girlId } = req.params;
  const chatKey = `${userId}-${girlId}`;
  res.json(messages[chatKey] || []);
});

// Get all messages for a user across all girls
app.get("/api/messages/:userId", (req, res) => {
  const { userId } = req.params;
  const userMessages = {};
  for (const chatKey in messages) {
    if (chatKey.startsWith(userId + "-")) {
      userMessages[chatKey] = messages[chatKey];
    }
  }
  res.json(userMessages);
});

app.post("/api/chat", async (req, res) => {
  const { userId, girlId, message } = req.body;

  if (!userId || !girlId || !message) {
    return res.status(400).json({ error: "Missing userId, girlId, or message" });
  }

  const personality = personalities[girlId] || "You are a friendly and flirty woman.";

  if (!conversations[userId]) conversations[userId] = {};
  if (!conversations[userId][girlId]) conversations[userId][girlId] = [];
  if (!messages[`${userId}-${girlId}`]) messages[`${userId}-${girlId}`] = [];

  // HYBRID LOGIC: if no convo yet, send hardcoded first message from AI before user message
  if (conversations[userId][girlId].length === 0) {
    const firstMsg = firstMessages[girlId] || "Hi there!";

    conversations[userId][girlId].push({ role: "assistant", content: firstMsg });
    messages[`${userId}-${girlId}`].push({ from: "assistant", text: firstMsg });

    conversations[userId][girlId].push({ role: "user", content: message });
    messages[`${userId}-${girlId}`].push({ from: "user", text: message });

    return res.json({ reply: firstMsg });
  }

  // Normal AI chat flow after first message
  conversations[userId][girlId].push({ role: "user", content: message });
  messages[`${userId}-${girlId}`].push({ from: "user", text: message });

  try {
    const aiMessages = [
      { role: "system", content: personality },
      ...conversations[userId][girlId]
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: aiMessages
    });

    const aiReply = completion.choices[0].message.content;

    conversations[userId][girlId].push({ role: "assistant", content: aiReply });
    messages[`${userId}-${girlId}`].push({ from: "assistant", text: aiReply });

    res.json({ reply: aiReply });

  } catch (error) {
    console.error("OpenAI API error:", error);
    res.status(500).json({ error: "Failed to get AI reply" });
  }
});

/**
 * NEW: Completely separate endpoint to send hardcoded initial messages to a user
 * This does NOT affect OpenAI chat flow
 */
app.post("/api/send-initial-message", (req, res) => {
  const { userId, girlId } = req.body;

  if (!userId || !girlId) {
    return res.status(400).json({ error: "Missing userId or girlId" });
  }

  const chatKey = `${userId}-${girlId}`;
  const firstMsg = firstMessages[girlId] || "Hi there!";

  // Ensure storage exists
  if (!messages[chatKey]) messages[chatKey] = [];
  if (!conversations[userId]) conversations[userId] = {};
  if (!conversations[userId][girlId]) conversations[userId][girlId] = [];

  // Prevent duplicates
  const alreadySent = messages[chatKey].some(
    msg => msg.from === "assistant" && msg.text === firstMsg
  );
  if (alreadySent) {
    return res.json({ message: "Initial message already sent" });
  }

  // Add message
  messages[chatKey].push({
    from: "assistant",
    text: firstMsg,
    time: new Date().toISOString()
  });

  res.json({ message: "Initial message sent", firstMsg });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
