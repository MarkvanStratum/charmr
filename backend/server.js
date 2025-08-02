const express = require('express');
const cors = require('cors');
const OpenAI = require('openai'); // ✅ v4 import

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// === OPENAI SETUP ===
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // Make sure this is set in Render
});

// === PROFILES (short version for now) ===
const girls = [
  { id: 1, name: "Evie Hughes", age: 29, city: "Aberdeen", image: "https://randomuser.me/api/portraits/women/1.jpg" },
  { id: 2, name: "Evie Lewis", age: 35, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/2.jpg" },
  { id: 3, name: "Grace Johnson", age: 20, city: "London", image: "https://randomuser.me/api/portraits/women/3.jpg" }
];

// === MESSAGES STORAGE ===
let messages = { "user1": [] };
let messageIdCounter = 1;

// === FLIRTY MESSAGE LIST ===
const flirtyMessages = [
  "Hey you 😉 What are you doing right now?",
  "I was just thinking about you 😘",
  "Wanna have a little chat? 😏",
  "Miss me yet? 😜",
  "You looked cute in your profile picture 😍",
  "I can't stop smiling when I think about you ❤️",
  "So… what are you wearing? 😉",
  "You seem like trouble… I like trouble 😈"
];

// === API: Get profiles ===
app.get('/api/profiles', (req, res) => {
  res.json(girls);
});

// === API: Get messages for a user ===
app.get('/api/messages/:userId', (req, res) => {
  const userId = req.params.userId;
  res.json(messages[userId] || []);
});

// === API: Get unread messages count for a user ===
app.get('/api/messages/unreadCount', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: "Missing or invalid userId" });

  const userMessages = messages[userId] || [];
  const unreadCount = userMessages.filter(msg => !msg.read).length;
  res.json({ unreadCount });
});

// === API: Mark messages as read ===
app.post('/api/messages/markRead', (req, res) => {
  const { userId, messageIds } = req.body;
  if (!userId || !Array.isArray(messageIds)) {
    return res.status(400).json({ error: "Missing userId or messageIds" });
  }
  if (!messages[userId]) messages[userId] = [];

  messages[userId].forEach(msg => {
    if (messageIds.includes(msg.id)) {
      msg.read = true;
    }
  });
  res.json({ success: true });
});

// === Function: Random girl sends message ===
function sendRandomMessageToUser(userId) {
  const randomGirl = girls[Math.floor(Math.random() * girls.length)];
  const randomMessage = flirtyMessages[Math.floor(Math.random() * flirtyMessages.length)];

  const newMsg = {
    id: messageIdCounter++,
    from: randomGirl.name,
    avatar: randomGirl.image,
    text: randomMessage,
    time: new Date().toISOString(),
    read: false
  };

  if (!messages[userId]) messages[userId] = [];
  messages[userId].push(newMsg);

  console.log(`New message from ${randomGirl.name} to ${userId}: ${randomMessage}`);
}

// === Simulate new message every 60 seconds ===
setInterval(() => {
  sendRandomMessageToUser("user1");
}, 60000);

app.post('/api/chat', async (req, res) => {
  const { userId, girlId, message } = req.body;

  if (!userId || !girlId || !message) {
    return res.status(400).json({ error: "Missing userId, girlId, or message" });
  }

  const personality = personalities[girlId] || "You are a friendly and flirty woman.";

  if (!conversations[userId]) conversations[userId] = {};
  if (!conversations[userId][girlId]) conversations[userId][girlId] = [];

  conversations[userId][girlId].push({ role: "user", content: message });

  try {
    const messages = [
      { role: "system", content: personality },
      ...conversations[userId][girlId]
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages
    });

    const aiReply = completion.choices[0].message.content;

    conversations[userId][girlId].push({ role: "assistant", content: aiReply });

    res.json({ reply: aiReply });
  } catch (error) {
    console.error("OpenAI API error:", error);
    res.status(500).json({ error: "Failed to get AI reply" });
  }
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
