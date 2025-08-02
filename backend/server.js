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
  { id: 1, name: "Amelia White", age: 26, city: "London", image: "https://randomuser.me/api/portraits/women/1.jpg" },
  { id: 2, name: "Olivia Smith", age: 24, city: "Manchester", image: "https://randomuser.me/api/portraits/women/2.jpg" },
  { id: 3, name: "Sophia Taylor", age: 29, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/3.jpg" }
];

const personalities = {
  1: "You are Amelia White, a playful and flirty British woman from London who loves music festivals and teasing banter.",
  2: "You are Olivia Smith, a sophisticated woman from Manchester who enjoys art galleries, wine, and intelligent conversations.",
  3: "You are Sophia Taylor, a cheeky and adventurous woman from Birmingham who loves spontaneous plans and travel."
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

app.post("/api/chat", async (req, res) => {
  const { userId, girlId, message } = req.body;

  if (!userId || !girlId || !message) {
    return res.status(400).json({ error: "Missing userId, girlId, or message" });
  }

  const personality = personalities[girlId] || "You are a friendly and flirty woman.";

  if (!conversations[userId]) conversations[userId] = {};
  if (!conversations[userId][girlId]) conversations[userId][girlId] = [];
  if (!messages[`${userId}-${girlId}`]) messages[`${userId}-${girlId}`] = [];

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
