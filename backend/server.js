const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Dummy profile data
const girls = [
  { id: 1, name: "Amelia White", age: 26, city: "London", image: "https://randomuser.me/api/portraits/women/1.jpg" },
  { id: 2, name: "Olivia Smith", age: 24, city: "Manchester", image: "https://randomuser.me/api/portraits/women/2.jpg" },
  { id: 3, name: "Sophia Taylor", age: 29, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/3.jpg" }
];

// Dummy messages for a user
const messages = {
  "user1": [
    { from: "Amelia White", message: "Hey you, how's your day?", time: "2025-08-01T10:00:00Z" },
    { from: "Olivia Smith", message: "Can't wait to chat more ;)", time: "2025-08-01T11:15:00Z" }
  ]
};

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Backend is running!' });
});

// API to get profiles
app.get('/api/profiles', (req, res) => {
  res.json(girls);
});

// API to get messages for a specific user
app.get('/api/messages/:userId', (req, res) => {
  const userId = req.params.userId;
  res.json(messages[userId] || []);
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
