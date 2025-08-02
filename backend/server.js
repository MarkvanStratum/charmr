const express = require('express');
const cors = require('cors');
const { Configuration, OpenAIApi } = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// === OPENAI SETUP ===
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY, // set this in Render environment variables
});
const openai = new OpenAIApi(configuration);

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
  sendRandomMessageToUser("user1"); // Replace with real logged-in user ID
}, 60000);

// === OPENAI CHAT ENDPOINT ===
app.post('/api/chat', async (req, res) => {
  const { userMessage, chatWithUserId } = req.body;

  if (!userMessage || !chatWithUserId) {
    return res.status(400).json({ error: "Missing userMessage or chatWithUserId" });
  }

  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a flirtatious girl chatting with a guy." },
        { role: "user", content: userMessage }
      ],
      max_tokens: 150,
      temperature: 0.8,
    });

    const reply = completion.data.choices[0].message.content.trim();

    // Save AI's reply into messages list
    const randomGirl = girls.find(g => g.id === parseInt(chatWithUserId)) || girls[0];
    const aiMsg = {
      id: messageIdCounter++,
      from: randomGirl.name,
      avatar: randomGirl.image,
      text: reply,
      time: new Date().toISOString(),
      read: false
    };
    if (!messages["user1"]) messages["user1"] = [];
    messages["user1"].push(aiMsg);

    res.json({ reply });

  } catch (error) {
    console.error("OpenAI error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to get response from AI" });
  }
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
